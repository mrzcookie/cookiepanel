// Package cli is the cookied command-line entrypoint.
//
// For now it only knows how to print its version and accept a stub `run`
// command. Kept dependency-free (stdlib only) on purpose; a richer CLI
// (cobra) and the daemon runtime land in a later phase.
package cli

import (
	"fmt"
	"os"

	"github.com/cookiepanel/cookied/internal/version"
)

// Run dispatches the cookied subcommand and returns a process exit code.
func Run(args []string) int {
	cmd := ""
	if len(args) > 0 {
		cmd = args[0]
	}

	switch cmd {
	case "version", "--version", "-v":
		fmt.Println(version.String())
		return 0
	case "run":
		// The daemon runtime is not implemented yet. It will start the HTTPS
		// API, Docker manager, scheduler, and heartbeat loop in a later phase.
		fmt.Fprintln(os.Stderr, "cookied: `run` is not implemented yet")
		return 0
	case "", "help", "--help", "-h":
		usage()
		return 0
	default:
		fmt.Fprintf(os.Stderr, "cookied: unknown command %q\n\n", cmd)
		usage()
		return 2
	}
}

func usage() {
	fmt.Print(`cookied — the CookiePanel daemon

Usage:
  cookied <command>

Commands:
  run        Start the daemon (not implemented yet)
  version    Print version information
  help       Show this help
`)
}
