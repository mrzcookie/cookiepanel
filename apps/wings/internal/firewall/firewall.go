// Package firewall manages host firewall rules with pluggable backends, selected
// at runtime: ufw if present, else iptables, else an "unsupported" no-op (dev on
// macOS, or a box with neither tool). Ports are opened/closed in lockstep with
// the panel's port allocations.
//
// Every rule we add carries a comment tag (RuleComment) so List/Close only ever
// see ours — the daemon never touches the operator's own rules. And a hard guard
// refuses to close SSH (22) or the daemon's own port, so a click can never lock
// the operator out (enforced here, authoritatively server-side; see security.md).
package firewall

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// RuleComment tags every rule we add, so list/remove only ever see ours.
const RuleComment = "raptor"

// SSHPort is never closeable — closing it could lock the operator off the box.
const SSHPort = 22

// ErrUnsupported is returned by mutating ops when no firewall backend exists.
var ErrUnsupported = errors.New("no firewall backend available on this host")

// ErrProtectedPort is returned when a close would target SSH or the daemon port.
var ErrProtectedPort = errors.New("refusing to close a protected port (SSH or the daemon's own port)")

// Rule is one allowed inbound port.
type Rule struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"` // "tcp" | "udp"
}

func (r Rule) normalize() (Rule, error) {
	if r.Port < 1 || r.Port > 65535 {
		return r, fmt.Errorf("port %d out of range", r.Port)
	}
	p := strings.ToLower(r.Protocol)
	if p == "" {
		p = "tcp"
	}
	if p != "tcp" && p != "udp" {
		return r, fmt.Errorf("protocol %q must be tcp or udp", r.Protocol)
	}
	return Rule{Port: r.Port, Protocol: p}, nil
}

// Backend is a concrete firewall implementation.
type Backend interface {
	Name() string
	Open(ctx context.Context, r Rule) error
	Close(ctx context.Context, r Rule) error
	List(ctx context.Context) ([]Rule, error)
}

// Status is the snapshot the panel reads.
type Status struct {
	Backend string `json:"backend"`
	Active  bool   `json:"active"`
	Rules   []Rule `json:"rules"`
}

// Manager wraps the selected backend and the self-lockout guard.
type Manager struct {
	backend    Backend
	daemonPort int
}

// NewManager selects a backend by probing for ufw, then iptables, falling back
// to the unsupported no-op. `daemonPort` is the port the panel-facing API listens
// on; it (and SSH) can never be closed.
func NewManager(daemonPort int) *Manager {
	var backend Backend
	if _, err := exec.LookPath("ufw"); err == nil {
		backend = &ufwBackend{}
	} else if _, err := exec.LookPath("iptables"); err == nil {
		backend = &iptablesBackend{}
	} else {
		backend = unsupportedBackend{}
	}
	return &Manager{backend: backend, daemonPort: daemonPort}
}

func (m *Manager) BackendName() string { return m.backend.Name() }

func (m *Manager) Status(ctx context.Context) (Status, error) {
	st := Status{
		Backend: m.backend.Name(),
		Active:  m.backend.Name() != "unsupported",
	}
	rules, err := m.backend.List(ctx)
	if err != nil {
		return st, err
	}
	st.Rules = rules
	return st, nil
}

func (m *Manager) Open(ctx context.Context, r Rule) error {
	rule, err := r.normalize()
	if err != nil {
		return err
	}
	return m.backend.Open(ctx, rule)
}

func (m *Manager) Close(ctx context.Context, r Rule) error {
	rule, err := r.normalize()
	if err != nil {
		return err
	}
	// Hard guard: never close the ports that keep the box reachable. Authoritative
	// here, not just in the UI.
	if rule.Port == SSHPort || rule.Port == m.daemonPort {
		return ErrProtectedPort
	}
	return m.backend.Close(ctx, rule)
}

// run is a small shared exec helper for the shell backends — arg vectors, never
// a shell string.
func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf(
			"%s %s: %w: %s",
			name,
			strings.Join(args, " "),
			err,
			strings.TrimSpace(string(out)),
		)
	}
	return string(out), nil
}
