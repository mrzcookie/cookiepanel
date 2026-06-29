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
	// MaxConcurrent bounds in-flight dispatches so a slow op can't starve reads.
	MaxConcurrent int
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
		connected, err := c.serveOnce(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if connected {
			// The link was up and then dropped — start the next retry fresh.
			backoff = c.cfg.MinBackoff
			slog.Warn("link disconnected; reconnecting", "err", err)
		} else {
			slog.Warn("link dial failed; retrying", "err", err, "backoff", backoff)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		if !connected {
			backoff = min(backoff*2, c.cfg.MaxBackoff)
		}
	}
}

// serveOnce dials once and serves until the connection drops. The bool reports
// whether the dial succeeded (so Run can reset backoff after a real session).
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
	// Generous read limit: file ops and listings can be large.
	conn.SetReadLimit(32 << 20)
	slog.Info("link connected", "url", c.cfg.URL)

	connCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	out := make(chan rpc.Frame, 64)
	var inflight sync.Map // frame id -> context.CancelFunc
	sem := make(chan struct{}, c.cfg.MaxConcurrent)

	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		c.writeLoop(connCtx, conn, out)
	}()

	if c.cfg.Heartbeat != nil && c.cfg.HeartbeatInterval > 0 {
		go c.heartbeatLoop(connCtx, out)
	}

	readErr := c.readLoop(connCtx, conn, out, &inflight, sem)
	cancel()
	<-writerDone
	return true, readErr
}

func (c *Client) readLoop(
	ctx context.Context,
	conn *websocket.Conn,
	out chan<- rpc.Frame,
	inflight *sync.Map,
	sem chan struct{},
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
				c.handleStream(ctx, frame, h, out, inflight, sem)
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

// handleRequest dispatches one control request in its own goroutine (bounded by
// sem) so a slow operation can't head-of-line-block the read loop.
func (c *Client) handleRequest(
	ctx context.Context,
	frame rpc.Frame,
	out chan<- rpc.Frame,
	inflight *sync.Map,
	sem chan struct{},
) {
	select {
	case sem <- struct{}{}:
	case <-ctx.Done():
		return
	}
	reqCtx, cancel := context.WithCancel(ctx)
	inflight.Store(frame.ID, cancel)

	go func() {
		defer func() {
			inflight.Delete(frame.ID)
			cancel()
			<-sem
			if r := recover(); r != nil {
				c.send(ctx, out, rpc.Errorf(frame.ID, rpc.CodeInternal, "dispatch panic: %v", r))
			}
		}()

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
