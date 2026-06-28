// Package logging configures wings's structured logger and the cross-cutting
// concerns a production service is expected to provide:
//
//   - leveled logging with a debug switch (--debug / WINGS_DEBUG /
//     WINGS_LOG_LEVEL), off by default;
//   - a selectable output format — text for a terminal or journald, JSON for a
//     log aggregator (--log-format / WINGS_LOG_FORMAT);
//   - request/node correlation carried on the context, so every line emitted
//     while handling one request shares a request_id (and node_id) without each
//     call site threading it by hand;
//   - defense-in-depth secret redaction: the handler scrubs any attribute whose
//     key names a secret (the node key, signing secret, an Authorization header,
//     a password/token), so a secret can't reach a log sink even if a future
//     call site logs one carelessly (see security.md §2).
//
// Setup installs a process-wide slog default; subsystems just call the package
// slog functions (preferring the *Context variants so correlation flows).
package logging

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

// Redacted is what a scrubbed secret renders as in a log line. It echoes none of
// the original bytes, so a present secret is indistinguishable from an absent one.
const Redacted = "<redacted>"

// Format selects the log encoding.
type Format string

const (
	FormatText Format = "text" // human-readable; for a terminal / journalctl
	FormatJSON Format = "json" // one JSON object per line; for log aggregation
)

// Options configures Setup. The zero value is production-sane: info level, text.
type Options struct {
	Debug  bool   // the --debug flag; forces debug level when set
	Format Format // "" → WINGS_LOG_FORMAT → text
	Level  string // "" → WINGS_LOG_LEVEL → info (ignored when Debug is set)
}

// enabled records whether debug logging is active, for callers (e.g. `run`,
// deciding whether to expose pprof) that need to branch on it after Setup.
var enabled bool

// Setup installs the process-wide logger from opts + environment and reports
// whether debug is active. Call it once, early, before any subsystem starts so
// every later log line uses the chosen level and format.
func Setup(opts Options) bool {
	level := resolveLevel(opts.Debug, opts.Level)
	enabled = level <= slog.LevelDebug

	handlerOpts := &slog.HandlerOptions{
		Level:       level,
		AddSource:   enabled, // file:line is worth the noise only at debug
		ReplaceAttr: redactAttr,
	}
	var base slog.Handler
	switch resolveFormat(opts.Format) {
	case FormatJSON:
		base = slog.NewJSONHandler(os.Stderr, handlerOpts)
	default:
		base = slog.NewTextHandler(os.Stderr, handlerOpts)
	}
	slog.SetDefault(slog.New(&contextHandler{Handler: base}))
	return enabled
}

// Enabled reports whether debug logging is active (as resolved by the last Setup).
func Enabled() bool { return enabled }

// Component returns a logger tagged with a subsystem name for structured
// filtering (e.g. component=firewall). Call it after Setup — it binds the
// current default handler.
func Component(name string) *slog.Logger {
	return slog.Default().With(slog.String("component", name))
}

// Redact returns the placeholder for a secret value at a call site that logs a
// field by value (e.g. a credentials struct). The handler's key-based scrub is
// the backstop; this is the explicit, intent-revealing form.
func Redact(string) string { return Redacted }

func resolveLevel(debug bool, explicit string) slog.Level {
	if debug || truthy(os.Getenv("WINGS_DEBUG")) {
		return slog.LevelDebug
	}
	if lvl, ok := parseLevel(explicit); ok {
		return lvl
	}
	if lvl, ok := parseLevel(os.Getenv("WINGS_LOG_LEVEL")); ok {
		return lvl
	}
	return slog.LevelInfo
}

func resolveFormat(explicit Format) Format {
	if explicit != "" {
		return explicit
	}
	if strings.EqualFold(os.Getenv("WINGS_LOG_FORMAT"), string(FormatJSON)) {
		return FormatJSON
	}
	return FormatText
}

func parseLevel(s string) (slog.Level, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug, true
	case "info":
		return slog.LevelInfo, true
	case "warn", "warning":
		return slog.LevelWarn, true
	case "error":
		return slog.LevelError, true
	default:
		return 0, false
	}
}

func truthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// secretSubstrings are matched (case-insensitive, as substrings) against every
// attribute key; a hit redacts the value. Substring matching fails safe — it
// over-redacts a stray "tokenCount" rather than risk leaking a real token.
var secretSubstrings = []string{
	"authorization", "bearer", "nodekey", "node_key",
	"signingsecret", "signing_secret", "password", "passwd",
	"token", "secret", "apikey", "api_key", "credential",
}

// redactAttr is the handler ReplaceAttr hook: it scrubs the value of any
// secret-named attribute at any nesting depth, leaving the key in place so the
// shape of the log line is preserved.
func redactAttr(_ []string, a slog.Attr) slog.Attr {
	if isSecretKey(a.Key) {
		return slog.String(a.Key, Redacted)
	}
	return a
}

func isSecretKey(key string) bool {
	k := strings.ToLower(key)
	for _, s := range secretSubstrings {
		if strings.Contains(k, s) {
			return true
		}
	}
	return false
}

// fieldsKey is the context key under which correlation attributes are stored.
type fieldsKey struct{}

// WithAttrs returns a context carrying attrs that the handler stamps onto every
// record logged with it via slog's *Context methods (InfoContext, DebugContext,
// …). Thread a request_id / node_id through it so all logs for one request
// correlate. Repeated calls accumulate.
func WithAttrs(ctx context.Context, attrs ...slog.Attr) context.Context {
	if len(attrs) == 0 {
		return ctx
	}
	existing, _ := ctx.Value(fieldsKey{}).([]slog.Attr)
	merged := make([]slog.Attr, 0, len(existing)+len(attrs))
	merged = append(merged, existing...)
	merged = append(merged, attrs...)
	return context.WithValue(ctx, fieldsKey{}, merged)
}

// contextHandler wraps a slog.Handler so records logged with a correlation
// context (see WithAttrs) carry those attributes automatically. Enabled is
// promoted from the embedded handler; WithAttrs/WithGroup re-wrap so the
// behavior survives logger.With(...).
type contextHandler struct{ slog.Handler }

func (h *contextHandler) Handle(ctx context.Context, r slog.Record) error {
	if attrs, ok := ctx.Value(fieldsKey{}).([]slog.Attr); ok {
		r.AddAttrs(attrs...)
	}
	return h.Handler.Handle(ctx, r)
}

func (h *contextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithAttrs(attrs)}
}

func (h *contextHandler) WithGroup(name string) slog.Handler {
	return &contextHandler{Handler: h.Handler.WithGroup(name)}
}
