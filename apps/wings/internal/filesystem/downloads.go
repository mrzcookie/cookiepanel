package filesystem

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/xena-studios/raptorpanel/apps/wings/internal/safe"
)

// JobState is the lifecycle of a URL-download job.
type JobState string

const (
	JobRunning   JobState = "running"
	JobDone      JobState = "done"
	JobError     JobState = "error"
	JobCancelled JobState = "cancelled"
)

// Job is the public snapshot of a URL download. Total is -1 when the upstream
// didn't advertise Content-Length (HTTP/1.0 servers, chunked transfers).
type Job struct {
	ID        string    `json:"id"`
	ServerID  string    `json:"serverId"`
	Path      string    `json:"path"`
	URL       string    `json:"url"`
	Total     int64     `json:"total"`
	Done      int64     `json:"done"`
	State     JobState  `json:"state"`
	Error     string    `json:"error,omitempty"`
	StartedAt time.Time `json:"startedAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Jobs is an in-memory registry of running URL downloads. State doesn't survive
// a daemon restart; the panel can re-trigger a pull if needed. Finished jobs are
// kept until their UpdatedAt is older than retainCompleted so the panel has a
// window to read the final status.
type Jobs struct {
	mu       sync.RWMutex
	jobs     map[string]*Job
	cancels  map[string]context.CancelFunc
	retainFn func() time.Duration
}

const defaultRetainCompleted = 10 * time.Minute

// NewJobs constructs an empty registry. The defaults are fine for v1.
func NewJobs() *Jobs {
	return &Jobs{
		jobs:     make(map[string]*Job),
		cancels:  make(map[string]context.CancelFunc),
		retainFn: func() time.Duration { return defaultRetainCompleted },
	}
}

// newJobID returns a 12-byte hex id; collisions are astronomically unlikely for
// an in-memory map sized by what one node can pull.
func newJobID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "dl_" + hex.EncodeToString(b[:]), nil
}

// validateURL rejects schemes other than http/https. The actual SSRF defense is
// the dial Control hook below (it sees the resolved IP) — this is just an early,
// friendly reject of obvious foot-guns like file:// or a missing host.
func validateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("url scheme must be http or https, got %q", scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("url is missing a host")
	}
	return nil
}

// isPublicIP reports whether ip is a routable public address. The daemon runs as
// root in the host network namespace, so a URL pull must not be steerable at the
// host's own loopback/private services or the cloud metadata endpoint
// (169.254.169.254 — link-local). With panel RBAC deferred, any org member can
// trigger a pull, so this is deny-by-default for every non-public range; a
// private-mirror allowlist would be a future opt-in.
func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return !(ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() || // 169.254/16 + fe80::/10 (incl. metadata)
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsPrivate() || // 10/8, 172.16/12, 192.168/16, fc00::/7
		ip.IsUnspecified())
}

// dialGuard is the dial Control hook the URL-download client uses. It defaults to
// the real public-IP check; tests override it (with restore) to reach a loopback
// httptest server. Production never touches it.
var dialGuard = safeDialControl

// safeDialControl runs after DNS resolution, before connect, on every dial — the
// initial request AND every redirect hop — so it closes the DNS-rebinding TOCTOU
// a pre-resolve check would leave open. address is the resolved "ip:port".
func safeDialControl(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("bad dial address %q: %w", address, err)
	}
	ip := net.ParseIP(host)
	if !isPublicIP(ip) {
		return fmt.Errorf("refusing to fetch from non-public address %s", host)
	}
	return nil
}

// Start kicks off a download in a background goroutine and returns the new job
// id. The goroutine updates the job entry as it makes progress and again when it
// finishes (or errors / is cancelled).
func (j *Jobs) Start(m *Manager, serverID, path, target string) (string, error) {
	if err := validateURL(target); err != nil {
		return "", err
	}
	id, err := newJobID()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	job := &Job{
		ID:        id,
		ServerID:  serverID,
		Path:      path,
		URL:       target,
		Total:     -1,
		State:     JobRunning,
		StartedAt: now,
		UpdatedAt: now,
	}
	ctx, cancel := context.WithCancel(context.Background())
	j.mu.Lock()
	j.jobs[id] = job
	j.cancels[id] = cancel
	j.mu.Unlock()

	go j.run(ctx, m, job)
	return id, nil
}

func (j *Jobs) run(ctx context.Context, m *Manager, job *Job) {
	defer safe.Recover("filesystem:download:" + job.ID)
	err := m.WriteStreamFromURL(ctx, job.ServerID, job.Path, job.URL,
		func(total int64) { j.update(job.ID, func(jj *Job) { jj.Total = total }) },
		func(done int64) { j.update(job.ID, func(jj *Job) { jj.Done = done }) },
	)
	j.update(job.ID, func(jj *Job) {
		switch {
		case errors.Is(err, context.Canceled):
			jj.State = JobCancelled
			jj.Error = "cancelled"
		case err != nil:
			jj.State = JobError
			jj.Error = err.Error()
		default:
			jj.State = JobDone
		}
	})
	j.mu.Lock()
	delete(j.cancels, job.ID)
	j.mu.Unlock()
}

// update applies fn under the registry lock and bumps UpdatedAt. The bump gives
// the panel something to detect that progress is alive vs. stuck.
func (j *Jobs) update(id string, fn func(*Job)) {
	j.mu.Lock()
	defer j.mu.Unlock()
	jj, ok := j.jobs[id]
	if !ok {
		return
	}
	fn(jj)
	jj.UpdatedAt = time.Now().UTC()
}

// Get returns a copy of the job snapshot if it exists. We return a copy so the
// caller can serialise without holding the lock.
func (j *Jobs) Get(id string) (Job, bool) {
	j.mu.RLock()
	defer j.mu.RUnlock()
	jj, ok := j.jobs[id]
	if !ok {
		return Job{}, false
	}
	return *jj, true
}

// Cancel signals the goroutine via its context. Cancelling a finished job is a
// no-op; the next Get reflects the eventual final state.
func (j *Jobs) Cancel(id string) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	cancel, ok := j.cancels[id]
	if !ok {
		return nil
	}
	cancel()
	delete(j.cancels, id)
	return nil
}

// StartSweeper runs Sweep on a ticker until ctx is cancelled, keeping the
// finished-jobs map bounded over a long-lived daemon. Launches its own goroutine.
func (j *Jobs) StartSweeper(ctx context.Context) {
	interval := j.retainFn() / 2
	if interval < time.Minute {
		interval = time.Minute
	}
	go func() {
		defer safe.Recover("filesystem:download-sweeper")
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				j.Sweep()
			}
		}
	}()
}

// Sweep evicts terminal jobs older than retainFn(). Call periodically to keep
// the map bounded; not strictly required for correctness.
func (j *Jobs) Sweep() {
	j.mu.Lock()
	defer j.mu.Unlock()
	cutoff := time.Now().UTC().Add(-j.retainFn())
	for id, jj := range j.jobs {
		if jj.State == JobRunning {
			continue
		}
		if jj.UpdatedAt.Before(cutoff) {
			delete(j.jobs, id)
		}
	}
}

// ─── HTTP plumbing for URL downloads ───────────────────────────────────────
//
// A dedicated client with a tight handshake timeout (so a black-hole DNS or
// firewall surfaces fast) but no overall request timeout (long downloads must
// not hit a wall clock — cancellation flows through ctx).

var urlDownloadClient = &http.Client{
	Transport: &http.Transport{
		// The Control hook rejects non-public IPs on every dial (initial + each
		// redirect), so an attacker-supplied URL can't reach host loopback/private
		// services or the metadata endpoint — even via a redirect or DNS rebind.
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
			Control:   func(n, a string, c syscall.RawConn) error { return dialGuard(n, a, c) },
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          16,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	},
}

func newURLDownloadRequest(ctx context.Context, target string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "wings/url-download")
	return req, nil
}

// copyWithProgress is io.Copy with a per-iteration cancellation check and a
// callback after each chunk. The 64 KiB buffer keeps syscall churn down on slow
// disks.
func copyWithProgress(ctx context.Context, dst io.Writer, src io.Reader, onProgress func(int64)) (int64, error) {
	buf := make([]byte, 64*1024)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, rerr := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return total, werr
			}
			total += int64(n)
			if onProgress != nil {
				onProgress(total)
			}
		}
		if rerr == io.EOF {
			return total, nil
		}
		if rerr != nil {
			return total, rerr
		}
	}
}
