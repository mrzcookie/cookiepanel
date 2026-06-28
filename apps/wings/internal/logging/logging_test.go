package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestResolveLevel(t *testing.T) {
	cases := []struct {
		name     string
		debug    bool
		explicit string
		envDebug string
		envLevel string
		want     slog.Level
	}{
		{name: "default is info", want: slog.LevelInfo},
		{name: "debug flag wins", debug: true, want: slog.LevelDebug},
		{name: "WINGS_DEBUG truthy", envDebug: "1", want: slog.LevelDebug},
		{name: "explicit warn", explicit: "warn", want: slog.LevelWarn},
		{name: "env level error", envLevel: "error", want: slog.LevelError},
		{name: "flag beats env level", debug: true, envLevel: "error", want: slog.LevelDebug},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("WINGS_DEBUG", tc.envDebug)
			t.Setenv("WINGS_LOG_LEVEL", tc.envLevel)
			if got := resolveLevel(tc.debug, tc.explicit); got != tc.want {
				t.Fatalf("resolveLevel = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestResolveFormat(t *testing.T) {
	t.Setenv("WINGS_LOG_FORMAT", "")
	if got := resolveFormat(""); got != FormatText {
		t.Fatalf("default format = %v, want text", got)
	}
	if got := resolveFormat(FormatJSON); got != FormatJSON {
		t.Fatalf("explicit json = %v, want json", got)
	}
	t.Setenv("WINGS_LOG_FORMAT", "JSON")
	if got := resolveFormat(""); got != FormatJSON {
		t.Fatalf("env json = %v, want json", got)
	}
}

func TestRedactAttrScrubsSecretKeys(t *testing.T) {
	secret := "super-secret-node-key"
	for _, key := range []string{"nodeKey", "node_key", "Authorization", "signingSecret", "password", "api_token"} {
		got := redactAttr(nil, slog.String(key, secret))
		if got.Value.String() != Redacted {
			t.Errorf("key %q not redacted: got %q", key, got.Value.String())
		}
		if strings.Contains(got.Value.String(), secret) {
			t.Errorf("key %q leaked the secret", key)
		}
	}
	// A non-secret key passes through untouched.
	if got := redactAttr(nil, slog.String("nodeId", "node-123")); got.Value.String() != "node-123" {
		t.Errorf("non-secret key was altered: %q", got.Value.String())
	}
}

// TestHandlerRedactsAndCorrelates is the end-to-end check: a JSON line must carry
// the context's correlation attrs and must never contain a secret value, even
// when the secret is logged under a secret-named key.
func TestHandlerRedactsAndCorrelates(t *testing.T) {
	var buf bytes.Buffer
	base := slog.NewJSONHandler(&buf, &slog.HandlerOptions{
		Level:       slog.LevelDebug,
		ReplaceAttr: redactAttr,
	})
	logger := slog.New(&contextHandler{Handler: base})

	ctx := WithAttrs(context.Background(),
		slog.String("request_id", "req-abc"),
		slog.String("node_id", "node-1"),
	)
	logger.DebugContext(ctx, "handled", slog.String("nodeKey", "leak-me"))

	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatalf("log line is not valid json: %v\n%s", err, buf.String())
	}
	if line["request_id"] != "req-abc" || line["node_id"] != "node-1" {
		t.Errorf("correlation attrs missing: %v", line)
	}
	if line["nodeKey"] != Redacted {
		t.Errorf("secret not redacted: %v", line["nodeKey"])
	}
	if strings.Contains(buf.String(), "leak-me") {
		t.Errorf("secret leaked into the log line: %s", buf.String())
	}
}

func TestWithAttrsAccumulates(t *testing.T) {
	ctx := WithAttrs(context.Background(), slog.String("a", "1"))
	ctx = WithAttrs(ctx, slog.String("b", "2"))
	attrs, ok := ctx.Value(fieldsKey{}).([]slog.Attr)
	if !ok || len(attrs) != 2 {
		t.Fatalf("expected 2 accumulated attrs, got %v", attrs)
	}
}
