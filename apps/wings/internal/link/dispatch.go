// Package link is the daemon's outbound dial-home transport: a persistent
// WebSocket the daemon opens TO the panel, over which the panel drives the box
// (instead of reaching an inbound HTTPS port). Control requests are tunnelled as
// RPC frames (see internal/rpc) and replayed in process against the existing API
// handler — so every handler, path param, and the bearer middleware are reused
// verbatim with no per-operation wiring.
//
// This is additive: the inbound HTTPS API keeps running. The link is opt-in
// behind `wings run --link` during the cutover.
package link

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
)

// LinkPath is the panel endpoint the daemon dials for the control channel.
const LinkPath = "/api/daemon/v1/link"

// ControlRequest is the payload of a `req` frame on the control channel: a
// daemon-relative HTTP request the panel wants executed. The daemon replays it
// in process against the API handler, so routing, path params, and the bearer
// middleware all behave exactly as they do for an inbound call.
type ControlRequest struct {
	Method string          `json:"method"`
	Path   string          `json:"path"`
	Body   json.RawMessage `json:"body,omitempty"`
}

// ControlResponse is the payload of the matching `res` frame: the handler's
// status + body. A 4xx/5xx is still a `res` (the panel maps the status the same
// way it maps an inbound HTTP status today) — `err` frames are reserved for
// transport-level failures (a malformed frame, a dispatch panic).
type ControlResponse struct {
	Status int             `json:"status"`
	Body   json.RawMessage `json:"body,omitempty"`
}

// Dispatcher executes ControlRequests against the daemon's API handler in
// process. The node key is set as the bearer so the handler's existing auth
// middleware passes — the authenticated WebSocket connection is the real trust
// boundary, this just satisfies the unchanged middleware.
type Dispatcher struct {
	handler http.Handler
	nodeKey string
}

// NewDispatcher wraps an API handler (from api.Server.Handler()).
func NewDispatcher(handler http.Handler, nodeKey string) *Dispatcher {
	return &Dispatcher{handler: handler, nodeKey: nodeKey}
}

// Dispatch replays one control request and captures the response. It never
// returns an error: a handler failure is an HTTP status in the response, which
// the panel maps just like an inbound call.
func (d *Dispatcher) Dispatch(ctx context.Context, cr ControlRequest) ControlResponse {
	method := cr.Method
	if method == "" {
		method = http.MethodGet
	}
	path := cr.Path
	if path == "" || !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	var body io.Reader
	if len(cr.Body) > 0 {
		body = bytes.NewReader(cr.Body)
	}
	req := httptest.NewRequest(method, path, body).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+d.nodeKey)
	if len(cr.Body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}

	rec := httptest.NewRecorder()
	d.handler.ServeHTTP(rec, req)

	resp := ControlResponse{Status: rec.Code}
	if b := rec.Body.Bytes(); len(b) > 0 {
		resp.Body = json.RawMessage(b)
	}
	return resp
}
