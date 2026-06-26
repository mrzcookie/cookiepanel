package tui

import (
	"strings"
	"testing"
	"time"

	"github.com/xena-studios/raptorpanel/apps/wings/internal/ipc"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/store"
)

func demoModel() model {
	m := initialModel("/tmp/x.sock")
	m.width, m.height = 92, 22
	m.status = store.Status{
		NodeID:          "atlas-7f3c",
		DaemonVersion:   "0.9.0",
		LastHeartbeatOK: true,
		LastHeartbeatAt: time.Now().Add(-12 * time.Second),
	}
	m.servers = []ipc.ServerSummary{
		{ServerID: "1", Name: "minecraft-survival", State: "running", ContainerID: "a1b2c3d4e5f6aa", Status: "Up 3 minutes"},
		{ServerID: "2", Name: "valheim-dedicated", State: "exited", ContainerID: "9f8e7d6c5b4a11", Status: "Exited (0) 5 minutes ago"},
		{ServerID: "3", Name: "postgres-main", State: "running", ContainerID: "4b3a2c1d0e9f22", Status: "Up 2 hours"},
		{ServerID: "4", Name: "rust-modded", State: "installing", ContainerID: ""},
	}
	return m
}

func TestRenderList(t *testing.T) {
	m := demoModel()
	out := m.View()
	for _, want := range []string{"WINGS", "// servers", "[ RUNNING ]", "minecraft-survival", "move"} {
		if !strings.Contains(out, want) {
			t.Errorf("list view missing %q", want)
		}
	}
	t.Logf("\n%s", out)
}

func TestRenderConfirm(t *testing.T) {
	m := demoModel()
	m.confirming = true
	out := m.View()
	if !strings.Contains(out, "delete minecraft-survival?") {
		t.Error("confirm prompt missing")
	}
	t.Logf("\n%s", out)
}

func TestRenderLogs(t *testing.T) {
	m := demoModel()
	m.screen = screenLogs
	m.logs = "[14:21:58] [Server thread/INFO]: Starting minecraft server 1.20.4\n" +
		"[14:22:01] [Server thread/INFO]: Default game type: SURVIVAL\n" +
		"[14:22:14] [Server thread/INFO]: Done (11.281s)! For help, type \"help\""
	out := m.View()
	if !strings.Contains(out, "Done") {
		t.Error("logs view missing content")
	}
	t.Logf("\n%s", out)
}
