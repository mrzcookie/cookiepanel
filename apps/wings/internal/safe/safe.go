// Package safe guards the daemon's background goroutines. The HTTP server
// recovers panics per request, but anything spawned with `go` (the scheduler's
// fires, the console-WS pumps, the download/install/sftp/backup workers) runs
// outside that net — an unrecovered panic there would crash the whole control
// plane, which the daemon must never let a single task do. Recover/Go log the
// panic with a stack trace and let the box keep running.
package safe

import (
	"fmt"
	"log/slog"
	"runtime/debug"
)

// Recover is deferred at the top of a background goroutine so a panic is logged
// (with a stack trace) instead of taking down the daemon.
func Recover(task string) {
	if r := recover(); r != nil {
		slog.Error("recovered panic in background task",
			"task", task, "panic", r, "stack", string(debug.Stack()))
	}
}

// Guard runs fn, recovering and logging a panic and returning it as an error so a
// goroutine that reports completion through a channel can tear down cleanly
// instead of crashing the daemon.
func Guard(task string, fn func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("recovered panic in background task",
				"task", task, "panic", r, "stack", string(debug.Stack()))
			err = fmt.Errorf("%s: panic: %v", task, r)
		}
	}()
	return fn()
}

// Go runs fn in a new goroutine guarded by Recover.
func Go(task string, fn func()) {
	go func() {
		defer Recover(task)
		fn()
	}()
}
