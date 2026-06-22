// Command cookied is the CookiePanel daemon that runs on each managed Linux box.
//
// It is built in vertical slices: enrollment + heartbeat first (this slice),
// then the HTTPS control API, Docker, networking, the firewall, the scheduler,
// and the local IPC socket. See .claude/rules/daemon.md for the target runtime.
package main

import (
	"os"

	"github.com/cookiepanel/cookied/internal/cli"
)

func main() {
	os.Exit(cli.Run(os.Args[1:]))
}
