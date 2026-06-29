// Package remote is the daemon -> panel HTTP client. Two endpoints:
//
//   - POST /api/daemon/v1/nodes/activate  (exchange a single-use bootstrap token
//     for the durable node key + signing secret)
//   - POST /api/daemon/v1/heartbeat       (Bearer node key; live system info)
//
// Panel-cert pinning and retry/backoff land alongside the HTTPS control channel.
package remote

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	HTTP    *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: 10 * time.Second},
	}
}

type ActivateRequest struct {
	NodeID          string `json:"nodeId"`
	BootstrapToken  string `json:"bootstrapToken"`
	FQDN            string `json:"fqdn,omitempty"`
	CertFingerprint string `json:"certFingerprint,omitempty"`
}

type ActivateResponse struct {
	NodeKey       string `json:"nodeKey"`
	SigningSecret string `json:"signingSecret"`
}

func (c *Client) Activate(ctx context.Context, req ActivateRequest) (*ActivateResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.BaseURL+"/api/daemon/v1/nodes/activate",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("activate: %s: %s", resp.Status, strings.TrimSpace(string(raw)))
	}
	var out ActivateResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode activate response: %w", err)
	}
	if out.NodeKey == "" || out.SigningSecret == "" {
		return nil, errors.New("activate: panel returned empty credentials")
	}
	return &out, nil
}

type HeartbeatBody struct {
	SystemInfo map[string]any `json:"systemInfo,omitempty"`
}

func (c *Client) Heartbeat(ctx context.Context, nodeKey string, hb HeartbeatBody) error {
	body, err := json.Marshal(hb)
	if err != nil {
		return err
	}
	httpReq, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.BaseURL+"/api/daemon/v1/heartbeat",
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+nodeKey)
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("heartbeat: %s: %s", resp.Status, strings.TrimSpace(string(raw)))
	}
	return nil
}
