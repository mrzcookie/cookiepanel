package link

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestDispatchRoundTrip(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/servers/{id}/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer testkey" {
			http.Error(w, "no bearer", http.StatusUnauthorized)
			return
		}
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":   r.PathValue("id"), // proves path params survive
			"sent": json.RawMessage(body),
		})
	})

	d := NewDispatcher(mux, "testkey")
	resp := d.Dispatch(context.Background(), ControlRequest{
		Method: http.MethodPost,
		Path:   "/api/v1/servers/abc/start",
		Body:   `{"x":1}`,
	})

	if resp.Status != http.StatusOK {
		t.Fatalf("status: got %d, body %s", resp.Status, resp.Body)
	}
	var got struct {
		ID   string          `json:"id"`
		Sent json.RawMessage `json:"sent"`
	}
	if err := json.Unmarshal([]byte(resp.Body), &got); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if got.ID != "abc" {
		t.Fatalf("path param lost: got id %q", got.ID)
	}
	if string(got.Sent) != `{"x":1}` {
		t.Fatalf("request body lost: got %s", got.Sent)
	}
}

func TestDispatchPropagatesHandlerStatus(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/missing", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"nope"}`, http.StatusNotFound)
	})
	d := NewDispatcher(mux, "k")

	// A 404 from a handler is a normal response (the panel maps the status) —
	// not a transport error.
	resp := d.Dispatch(context.Background(), ControlRequest{
		Method: http.MethodGet,
		Path:   "/api/v1/missing",
	})
	if resp.Status != http.StatusNotFound {
		t.Fatalf("status: got %d", resp.Status)
	}

	// An unregistered route falls through to the mux's own 404.
	resp = d.Dispatch(context.Background(), ControlRequest{
		Method: http.MethodGet,
		Path:   "/api/v1/does-not-exist",
	})
	if resp.Status != http.StatusNotFound {
		t.Fatalf("unmatched route status: got %d", resp.Status)
	}
}
