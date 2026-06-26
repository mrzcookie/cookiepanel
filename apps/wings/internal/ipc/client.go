package ipc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/xena-studios/raptorpanel/apps/wings/internal/store"
)

// Client dials the local control socket over HTTP-over-Unix. The on-box TUI and
// the `status` command use it; it never talks to the panel.
type Client struct {
	http *http.Client
}

// ServerSummary is the IPC view of a server (mirrors server.Server's wire shape).
type ServerSummary struct {
	ServerID    string `json:"serverId"`
	Name        string `json:"name"`
	ContainerID string `json:"containerId"`
	Image       string `json:"image"`
	State       string `json:"state"`
	Status      string `json:"status"`
	Error       string `json:"error,omitempty"`
}

// NewClient builds a client that dials the given Unix socket path. The host in
// the request URL is ignored (the transport always dials the socket).
func NewClient(socketPath string) *Client {
	return &Client{
		http: &http.Client{
			Timeout: 35 * time.Second,
			Transport: &http.Transport{
				DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
					var d net.Dialer
					return d.DialContext(ctx, "unix", socketPath)
				},
			},
		},
	}
}

// Ping checks the daemon is up and serving the socket.
func (c *Client) Ping(ctx context.Context) error {
	return c.do(ctx, http.MethodGet, "/v1/ping", nil)
}

// Status returns the daemon's last persisted status snapshot.
func (c *Client) Status(ctx context.Context) (store.Status, error) {
	var st store.Status
	err := c.do(ctx, http.MethodGet, "/v1/status", &st)
	return st, err
}

// ListServers returns every managed server on the box.
func (c *Client) ListServers(ctx context.Context) ([]ServerSummary, error) {
	var list []ServerSummary
	err := c.do(ctx, http.MethodGet, "/v1/servers", &list)
	return list, err
}

// StartServer starts a server by id.
func (c *Client) StartServer(ctx context.Context, id string) (*ServerSummary, error) {
	var srv ServerSummary
	if err := c.do(ctx, http.MethodPost, "/v1/servers/"+url.PathEscape(id)+"/start", &srv); err != nil {
		return nil, err
	}
	return &srv, nil
}

// StopServer stops a server by id.
func (c *Client) StopServer(ctx context.Context, id string) (*ServerSummary, error) {
	var srv ServerSummary
	if err := c.do(ctx, http.MethodPost, "/v1/servers/"+url.PathEscape(id)+"/stop", &srv); err != nil {
		return nil, err
	}
	return &srv, nil
}

// DeleteServer removes a server by id.
func (c *Client) DeleteServer(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/v1/servers/"+url.PathEscape(id), nil)
}

// ServerLogs returns the tail of a server's logs as plain text.
func (c *Client) ServerLogs(ctx context.Context, id string, tail int) (string, error) {
	path := fmt.Sprintf("/v1/servers/%s/logs?tail=%d", url.PathEscape(id), tail)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://unix"+path, nil)
	if err != nil {
		return "", err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("ipc: %s (is `wings run` active?)", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("ipc: %s", decodeErr(body, res.StatusCode))
	}
	return string(body), nil
}

// do performs a request and, when out is non-nil, decodes a JSON body into it.
func (c *Client) do(ctx context.Context, method, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, "http://unix"+path, nil)
	if err != nil {
		return err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("ipc: %s (is `wings run` active?)", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("ipc: %s", decodeErr(body, res.StatusCode))
	}
	if out != nil && len(body) > 0 {
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("ipc: decode response: %w", err)
		}
	}
	return nil
}

// decodeErr pulls the {"error":...} message out of a non-2xx body, falling back
// to the status code.
func decodeErr(body []byte, code int) string {
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &e) == nil && e.Error != "" {
		return e.Error
	}
	return fmt.Sprintf("HTTP %d", code)
}
