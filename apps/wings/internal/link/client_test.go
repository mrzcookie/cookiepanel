package link

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/xena-studios/raptor/apps/wings/internal/rpc"
)

func TestWSURL(t *testing.T) {
	cases := map[string]string{
		"https://panel.example.com":  "wss://panel.example.com" + LinkPath,
		"http://localhost:3000/":     "ws://localhost:3000" + LinkPath,
		"https://panel.example.com/": "wss://panel.example.com" + LinkPath,
	}
	for in, want := range cases {
		if got := WSURL(in); got != want {
			t.Errorf("WSURL(%q) = %q, want %q", in, got, want)
		}
	}
}

// The full loop: the client dials the panel, the panel sends a control request,
// the client dispatches it in process and replies, and — when the panel drops
// the connection — the client reconnects and serves again.
func TestClientConnectsDispatchesAndReconnects(t *testing.T) {
	// The stub "API handler" the dispatcher tunnels into.
	apiHandler := http.NewServeMux()
	apiHandler.HandleFunc("GET /api/v1/system", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	})

	var conns atomic.Int32
	responses := make(chan rpc.Frame, 4)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer nk" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		n := conns.Add(1)
		ctx := r.Context()

		req, _ := rpc.Request("r1", "getSystem", ControlRequest{
			Method: http.MethodGet, Path: "/api/v1/system",
		})
		data, _ := req.Encode()
		if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
			conn.CloseNow()
			return
		}
		if _, raw, rerr := conn.Read(ctx); rerr == nil {
			if f, derr := rpc.Decode(raw); derr == nil {
				responses <- f
			}
		}
		if n == 1 {
			// Drop the first session to force a reconnect.
			conn.CloseNow()
			return
		}
		<-ctx.Done()
		conn.CloseNow()
	}))
	defer srv.Close()

	c := NewClient(Config{
		URL:        WSURL(srv.URL),
		NodeKey:    "nk",
		Dispatcher: NewDispatcher(apiHandler, "nk"),
		MinBackoff: 5 * time.Millisecond,
		MaxBackoff: 50 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()

	assertSystemResponse(t, waitFrame(t, ctx, responses, "first"))
	assertSystemResponse(t, waitFrame(t, ctx, responses, "second (after reconnect)"))

	if got := conns.Load(); got < 2 {
		t.Fatalf("expected the client to reconnect (>= 2 sessions), got %d", got)
	}
}

func waitFrame(t *testing.T, ctx context.Context, ch <-chan rpc.Frame, which string) rpc.Frame {
	t.Helper()
	select {
	case f := <-ch:
		return f
	case <-ctx.Done():
		t.Fatalf("timed out waiting for the %s response", which)
		return rpc.Frame{}
	}
}

func assertSystemResponse(t *testing.T, f rpc.Frame) {
	t.Helper()
	if f.Kind != rpc.KindResult || f.ID != "r1" {
		t.Fatalf("unexpected frame: %+v", f)
	}
	var cr ControlResponse
	if err := f.Bind(&cr); err != nil {
		t.Fatalf("bind response: %v", err)
	}
	if cr.Status != http.StatusOK {
		t.Fatalf("status: got %d", cr.Status)
	}
	if cr.Body != `{"ok":true}` {
		t.Fatalf("body: got %s", cr.Body)
	}
}
