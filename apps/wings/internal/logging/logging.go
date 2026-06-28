// Package logging configures wings's process-wide slog logger and provides the
// secret-redaction helper every debug log path relies on. Debug mode is OFF by
// default (level Info); when on, logs drop to debug level with source locations
// attached. Secrets — the node key / Bearer token, the per-node signing secret,
// any Authorization header value — are NEVER logged: callers run them through
// RedactToken, and the API request logger drops headers/bodies entirely (see
// security.md §2).
package logging

import (
	"log/slog"
	"os"
	"strings"
)

const (
	// EnvDebug, when truthy ("1"/"true"/"yes"), forces debug level.
	EnvDebug = "WINGS_DEBUG"
	// EnvLogLevel names an explicit level ("debug"/"info"/"warn"/"error").
	EnvLogLevel = "WINGS_LOG_LEVEL"
)

// redactedPlaceholder is what every redacted secret renders as in a log line.
const redactedPlaceholder = "<redacted>"

// ResolveLevel picks the active log level by precedence, highest first:
//
//  1. the --debug flag (debug wins when set)
//  2. WINGS_DEBUG truthy → debug
//  3. WINGS_LOG_LEVEL ("debug"/"info"/"warn"/"error")
//  4. default: Info
func ResolveLevel(debugFlag bool) slog.Level {
	if debugFlag {
		return slog.LevelDebug
	}
	if truthy(os.Getenv(EnvDebug)) {
		return slog.LevelDebug
	}
	if lvl, ok := ParseLevel(os.Getenv(EnvLogLevel)); ok {
		return lvl
	}
	return slog.LevelInfo
}

// ParseLevel maps a level name to a slog.Level. ok is false for an empty or
// unrecognized value, so the caller can fall back to its own default.
func ParseLevel(s string) (slog.Level, bool) {
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

// Configure installs a text slog handler on stderr at the given level as the
// process-wide default. Source locations are attached only at debug level, where
// they're useful and the volume is opt-in.
func Configure(level slog.Level) {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level:     level,
		AddSource: level <= slog.LevelDebug,
	})))
}

// RedactToken returns a fixed placeholder for any secret string (the node key /
// Bearer token, the signing secret, an Authorization header value). It never
// echoes any portion of its input — not even a prefix — so a secret can't leak
// into a log line even at debug level, and a present secret is indistinguishable
// from a missing one.
func RedactToken(string) string {
	return redactedPlaceholder
}

func truthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}
