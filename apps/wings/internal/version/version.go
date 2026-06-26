// Package version holds build-time version metadata, injected via -ldflags.
package version

import (
	"fmt"
	"runtime"
)

var (
	// Version is the semantic version, set at build time.
	Version = "0.0.0-dev"
	// Commit is the git short SHA, set at build time.
	Commit = "none"
	// Date is the RFC3339 build timestamp, set at build time.
	Date = "unknown"
)

// String returns a human-readable, single-line version banner.
func String() string {
	return fmt.Sprintf("wings %s (commit %s, built %s, %s/%s, %s)",
		Version, Commit, Date, runtime.GOOS, runtime.GOARCH, runtime.Version())
}
