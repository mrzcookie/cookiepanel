// Command cookied is the CookiePanel daemon that runs on each managed Linux box.
//
// This is a bare-minimal scaffold: it builds, runs, and reports its version.
// The real agent (HTTPS/WS API, Docker, networking, firewall, scheduler,
// heartbeat) is implemented in a later phase, once the panel is matured.
package main

import (
	"os"

	"github.com/cookiepanel/cookied/internal/cli"
)

func main() {
	os.Exit(cli.Run(os.Args[1:]))
}
