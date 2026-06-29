package link

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/xena-studios/raptor/apps/wings/internal/rpc"
)

// A streaming op: the panel opens it, the daemon emits chunk frames, then a
// terminal res. This drives the real client through a fake panel socket.
func TestClientStreamsChunksThenResult(t *testing.T) {
	frames := make(chan rpc.Frame, 16)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		ctx := r.Context()
		req, _ := rpc.Request("s1", "console", map[string]string{"serverId": "srv-1"})
		data, _ := req.Encode()
		_ = conn.Write(ctx, websocket.MessageText, data)
		for {
			_, raw, rerr := conn.Read(ctx)
			if rerr != nil {
				return
			}
			f, derr := rpc.Decode(raw)
			if derr != nil {
				continue
			}
			frames <- f
			if f.Kind == rpc.KindResult {
				conn.Close(websocket.StatusNormalClosure, "")
				return
			}
		}
	}))
	defer srv.Close()

	emitted := 0
	c := NewClient(Config{
		URL:        WSURL(srv.URL),
		NodeKey:    "nk",
		Dispatcher: NewDispatcher(http.NewServeMux(), "nk"),
		MinBackoff: 5 * time.Millisecond,
		StreamHandlers: map[string]StreamHandler{
			"console": func(_ context.Context, req rpc.Frame, emit func(any) error) error {
				// The handler sees the request params.
				var p struct {
					ServerID string `json:"serverId"`
				}
				_ = req.Bind(&p)
				if p.ServerID != "srv-1" {
					t.Errorf("stream handler got serverId %q", p.ServerID)
				}
				for i := 0; i < 2; i++ {
					emitted++
					if err := emit(map[string]any{"kind": "log", "data": "line"}); err != nil {
						return err
					}
				}
				return nil
			},
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()

	var chunks, results int
	for chunks < 2 || results < 1 {
		select {
		case f := <-frames:
			switch f.Kind {
			case rpc.KindChunk:
				chunks++
				if f.ID != "s1" {
					t.Fatalf("chunk id: %s", f.ID)
				}
			case rpc.KindResult:
				results++
			}
		case <-ctx.Done():
			t.Fatalf("timed out: got %d chunks, %d results", chunks, results)
		}
	}
	if chunks != 2 || results != 1 {
		t.Fatalf("expected 2 chunks + 1 result, got %d + %d", chunks, results)
	}
}

// A cancel frame stops an in-flight stream.
func TestClientStreamCancelled(t *testing.T) {
	var handlerExited atomic.Bool
	started := make(chan struct{}, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		ctx := r.Context()
		req, _ := rpc.Request("s2", "console", nil)
		data, _ := req.Encode()
		_ = conn.Write(ctx, websocket.MessageText, data)
		<-started
		cancelFrame := rpc.Cancel("s2")
		cd, _ := cancelFrame.Encode()
		_ = conn.Write(ctx, websocket.MessageText, cd)
		<-ctx.Done()
	}))
	defer srv.Close()

	c := NewClient(Config{
		URL:        WSURL(srv.URL),
		NodeKey:    "nk",
		Dispatcher: NewDispatcher(http.NewServeMux(), "nk"),
		MinBackoff: 5 * time.Millisecond,
		StreamHandlers: map[string]StreamHandler{
			"console": func(ctx context.Context, _ rpc.Frame, _ func(any) error) error {
				started <- struct{}{}
				<-ctx.Done() // block until cancelled
				handlerExited.Store(true)
				return ctx.Err()
			},
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { _ = c.Run(ctx) }()

	deadline := time.After(3 * time.Second)
	for !handlerExited.Load() {
		select {
		case <-deadline:
			t.Fatal("stream handler was not cancelled")
		case <-time.After(10 * time.Millisecond):
		}
	}
}
