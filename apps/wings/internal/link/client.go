package link

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/xena-studios/raptor/apps/wings/internal/rpc"
)

const (
	// maxFrameBytes is the hard cap on a single inbound frame (the WebSocket read
	// limit). It sits above the base64-inflated file-transfer cap the panel
	// enforces, so legitimate traffic never trips it.
	maxFrameBytes = 96 << 20 // 96 MiB
	// stableSession is how long a session must last to count as "stable" — only
	// then does a reconnect reset the backoff (so a flapping panel backs off).
	stableSession = 30 * time.Second
)

// DialFunc opens the WebSocket. It defaults to websocket.Dial; tests override it.
type DialFunc func(ctx context.Context, url string, opts *websocket.DialOptions) (*websocket.Conn, *http.Response, error)

// Config configures the dial-home client.
type Config struct {
	// URL is the panel WebSocket endpoint (wss://panel/api/daemon/v1/link).
	URL string
	// NodeKey is presented as the bearer on the upgrade (the panel authenticates
	// the daemon) and on each dispatched request (the API's own middleware).
	NodeKey string
	// Dispatcher executes inbound control (unary) requests in process.
	Dispatcher *Dispatcher
	// StreamHandlers serve long-lived streaming ops (e.g. "console"): the handler
	// emits chunk frames until it returns or the request is cancelled. Keyed by
	// the frame's op; an op with no entry here is dispatched as a unary control
	// request instead.
	StreamHandlers map[string]StreamHandler
	// Heartbeat builds the periodic heartbeat payload; nil disables heartbeats.
	Heartbeat func() (any, error)
	// HeartbeatInterval is how often to send a heartbeat event.
	HeartbeatInterval time.Duration
	// MaxConcurrent bounds in-flight unary dispatches.
	MaxConcurrent int
	// MaxStreams bounds concurrent streaming ops (the console), separately from
	// MaxConcurrent so long-lived streams can't starve unary requests.
	MaxStreams int
	// MinBackoff / MaxBackoff bound the reconnect delay.
	MinBackoff, MaxBackoff time.Duration
	// Dial overrides the WebSocket dialer (tests).
	Dial DialFunc
}

// Client maintains the outbound link to the panel.
type Client struct {
	cfg Config
}

// NewClient applies defaults and returns a client.
func NewClient(cfg Config) *Client {
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = 16
	}
	if cfg.MaxStreams <= 0 {
		cfg.MaxStreams = 64
	}
	if cfg.MinBackoff <= 0 {
		cfg.MinBackoff = time.Second
	}
	if cfg.MaxBackoff <= 0 {
		cfg.MaxBackoff = 30 * time.Second
	}
	if cfg.Dial == nil {
		cfg.Dial = websocket.Dial
	}
	return &Client{cfg: cfg}
}

// WSURL turns the panel's base URL (http/https) into the link's ws/wss URL.
func WSURL(panelURL string) string {
	u := strings.TrimRight(panelURL, "/")
	switch {
	case strings.HasPrefix(u, "https://"):
		u = "wss://" + strings.TrimPrefix(u, "https://")
	case strings.HasPrefix(u, "http://"):
		u = "ws://" + strings.TrimPrefix(u, "http://")
	}
	return u + LinkPath
}

// Run dials the panel and serves frames until ctx is cancelled, reconnecting
// with exponential backoff across drops. It only returns when ctx is done.
func (c *Client) Run(ctx context.Context) error {
	backoff := c.cfg.MinBackoff
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		stable, err := c.serveOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if stable {
			// The link was up for a real session and then dropped — retry fresh.
			backoff = c.cfg.MinBackoff
			slog.Warn("link disconnected; reconnecting", "err", err)
		} else {
			// Dial failed, or the panel accepted and immediately dropped us — back
			// off so a flapping panel can't trigger a fleet-wide reconnect storm.
			slog.Warn("link down; retrying", "err", err, "backoff", backoff)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		if !stable {
			backoff = min(backoff*2, c.cfg.MaxBackoff)
		}
	}
}

// serveOnce dials once and serves until the connection drops. The bool reports
// whether the session was *stable* (up at least stableSession) — Run only resets
// its backoff for a stable session, so a panel that drops us immediately doesn't.
func (c *Client) serveOnce(ctx context.Context) (bool, error) {
	dialCtx, cancelDial := context.WithTimeout(ctx, 30*time.Second)
	conn, _, err := c.cfg.Dial(dialCtx, c.cfg.URL, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + c.cfg.NodeKey}},
	})
	cancelDial()
	if err != nil {
		return false, err
	}
	defer conn.CloseNow()
	// Hard cap on a single inbound frame. File transfers above the documented
	// limit are rejected by the panel before they reach this, so legitimate
	// traffic never trips it; an oversized frame still drops only this link.
	conn.SetReadLimit(maxFrameBytes)
	slog.Info("link connected", "url", c.cfg.URL)
	start := time.Now()

	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	out := make(chan rpc.Frame, 64)
	var inflight sync.Map // frame id -> context.CancelFunc
	sem := make(chan struct{}, c.cfg.MaxConcurrent)
	// Long-lived streams (the console) get a separate budget so they can't
	// exhaust the unary one — and neither acquire blocks the read loop.
	streamSem := make(chan struct{}, c.cfg.MaxStreams)

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		c.writeLoop(connCtx, conn, out)
	}()

	if c.cfg.Heartbeat != nil && c.cfg.HeartbeatInterval > 0 {
		go c.heartbeatLoop(connCtx, out)
	}

	readErr := c.readLoop(connCtx, conn, out, &inflight, sem, streamSem)
	cancel()
	<-writerDone
	return time.Since(start) >= stableSession, readErr
}

func (c *Client) readLoop(
	ctx context.Context,
	conn *websocket.Conn,
	out chan<- rpc.Frame,
	inflight *sync.Map,
	sem chan struct{},
	streamSem chan struct{},
) error {
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		if typ != websocket.MessageText {
			continue
		}
		frame, err := rpc.Decode(data)
		if err != nil {
			slog.Warn("link: dropping malformed frame", "err", err)
			continue
		}
		switch frame.Kind {
		case rpc.KindRequest:
			if h, ok := c.cfg.StreamHandlers[frame.Op]; ok {
				c.handleStream(ctx, frame, h, out, inflight, streamSem)
			} else {
				c.handleRequest(ctx, frame, out, inflight, sem)
			}
		case rpc.KindCancel:
			if cancel, ok := inflight.Load(frame.ID); ok {
				cancel.(context.CancelFunc)()
			}
		default:
			// The daemon is the responder on this channel, not a requester, so
			// res/chunk/err/event frames inbound here are unexpected — ignore.
		}
	}
}

// handleRequest dispatches one control request in its own goroutine. The cancel
// func is registered synchronously (so a racing `cancel` frame finds it), but the
// concurrency semaphore is acquired *inside* the goroutine — never in the read
// loop — so a full queue can't block reads (including the very cancel frames that
// would free slots). A cancelled op releases its slot via reqCtx.
func (c *Client) handleRequest(
	ctx context.Context,
	frame rpc.Frame,
	out chan<- rpc.Frame,
	inflight *sync.Map,
	sem chan struct{},
) {
	reqCtx, cancel := context.WithCancel(ctx)
	inflight.Store(frame.ID, cancel)

	go func() {
		defer func() {
			inflight.Delete(frame.ID)
			cancel()
			if r := recover(); r != nil {
				c.send(ctx, out, rpc.Errorf(frame.ID, rpc.CodeInternal, "dispatch panic: %v", r))
			}
		}()

		select {
		case sem <- struct{}{}:
		case <-reqCtx.Done():
			return
		}
		defer func() { <-sem }()

		var cr ControlRequest
		if err := frame.Bind(&cr); err != nil {
			c.send(ctx, out, rpc.Errorf(frame.ID, rpc.CodeBadRequest, "bad control request: %v", err))
			return
		}
		resp := c.cfg.Dispatcher.Dispatch(reqCtx, cr)
		f, err := rpc.Result(frame.ID, resp)
		if err != nil {
			c.send(ctx, out, rpc.Errorf(frame.ID, rpc.CodeInternal, "encode response: %v", err))
			return
		}
		c.send(ctx, out, f)
	}()
}

func (c *Client) writeLoop(ctx context.Context, conn *websocket.Conn, out <-chan rpc.Frame) {
	for {
		select {
		case <-ctx.Done():
			return
		case frame := <-out:
			data, err := frame.Encode()
			if err != nil {
				slog.Warn("link: dropping unencodable frame", "err", err)
				continue
			}
			wctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			err = conn.Write(wctx, websocket.MessageText, data)
			cancel()
			if err != nil {
				// The connection is gone; serveOnce's read loop will see it too.
				return
			}
		}
	}
}

func (c *Client) heartbeatLoop(ctx context.Context, out chan<- rpc.Frame) {
	t := time.NewTicker(c.cfg.HeartbeatInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			payload, err := c.cfg.Heartbeat()
			if err != nil {
				slog.Warn("link: heartbeat payload failed", "err", err)
				continue
			}
			f, err := rpc.Event("heartbeat", payload)
			if err != nil {
				slog.Warn("link: heartbeat encode failed", "err", err)
				continue
			}
			c.send(ctx, out, f)
		}
	}
}

// send queues a frame for the writer, abandoning it if the connection is gone.
func (c *Client) send(ctx context.Context, out chan<- rpc.Frame, frame rpc.Frame) {
	select {
	case out <- frame:
	case <-ctx.Done():
	}
}
