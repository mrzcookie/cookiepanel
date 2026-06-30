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
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"unicode/utf8"
)

// LinkPath is the panel endpoint the daemon dials for the control channel.
const LinkPath = "/api/daemon/v1/link"

// ControlRequest is the payload of a `req` frame on the control channel: a
// daemon-relative HTTP request the panel wants executed. The daemon replays it
// in process against the API handler, so routing, path params, and the bearer
// middleware all behave exactly as they do for an inbound call.
type ControlRequest struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	// Body is the raw request body (a JSON string for the API's JSON ops, base64
	// for a binary upload — see Encoding). A plain string rather than
	// json.RawMessage so a non-JSON body never breaks framing.
	Body string `json:"body,omitempty"`
	// Encoding is "base64" when Body is base64-encoded binary (a file upload),
	// empty for a plain (UTF-8) body.
	Encoding string `json:"encoding,omitempty"`
}

// ControlResponse is the payload of the matching `res` frame: the handler's
// status + body. A 4xx/5xx is still a `res` (the panel maps the status the same
// way it maps an inbound HTTP status today) — `err` frames are reserved for
// transport-level failures (a malformed frame, a dispatch panic).
type ControlResponse struct {
	Status int `json:"status"`
	// Body is the verbatim handler output: a plain string when it's valid UTF-8,
	// base64 otherwise (see Encoding) — so a binary download round-trips intact.
	Body string `json:"body,omitempty"`
	// Encoding is "base64" when Body is base64-encoded binary, empty otherwise.
	Encoding string `json:"encoding,omitempty"`
	// Headers carries the response headers the panel needs (e.g. content-type,
	// content-disposition, content-length for a download).
	Headers map[string]string `json:"headers,omitempty"`
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
	contentType := "application/json"
	if cr.Body != "" {
		if cr.Encoding == "base64" {
			raw, err := base64.StdEncoding.DecodeString(cr.Body)
			if err != nil {
				return ControlResponse{
					Status: http.StatusBadRequest,
					Body:   `{"error":"invalid base64 request body"}`,
				}
			}
			body = bytes.NewReader(raw)
			contentType = "application/octet-stream"
		} else {
			body = strings.NewReader(cr.Body)
		}
	}
	req := httptest.NewRequest(method, path, body).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+d.nodeKey)
	if body != nil {
		req.Header.Set("Content-Type", contentType)
	}

	rec := httptest.NewRecorder()
	d.handler.ServeHTTP(rec, req)

	resp := ControlResponse{Status: rec.Code}
	if h := rec.Header(); len(h) > 0 {
		resp.Headers = make(map[string]string, len(h))
		for k := range h {
			resp.Headers[strings.ToLower(k)] = h.Get(k)
		}
	}
	// Plain string for UTF-8 output (JSON, text); base64 for binary (a download),
	// so the body always round-trips through the JSON frame intact.
	raw := rec.Body.Bytes()
	if utf8.Valid(raw) {
		resp.Body = string(raw)
	} else {
		resp.Body = base64.StdEncoding.EncodeToString(raw)
		resp.Encoding = "base64"
	}
	return resp
}
