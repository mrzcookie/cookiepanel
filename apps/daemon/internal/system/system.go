// Package system reports the host's slow-changing info (hostname, OS, kernel,
// CPU model, totals) and fast-changing live stats (CPU%, memory/disk used, load)
// via gopsutil. Mutating host maintenance (hostname, reboot, OS updates) lands in
// a later slice.
package system

import (
	"context"
	"os"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
)

// Info is the slow-changing host snapshot.
type Info struct {
	Hostname     string `json:"hostname"`
	OS           string `json:"os"`
	Platform     string `json:"platform"`
	PlatformVer  string `json:"platformVersion"`
	Kernel       string `json:"kernel"`
	Arch         string `json:"arch"`
	CPUModel     string `json:"cpuModel"`
	CPUCount     int    `json:"cpuCount"`
	MemTotal     uint64 `json:"memTotalBytes"`
	UptimeSecond uint64 `json:"uptimeSeconds"`
}

// Stats is the fast-changing live snapshot.
type Stats struct {
	CPUPct    float64 `json:"cpuPct"`
	MemUsed   uint64  `json:"memUsedBytes"`
	MemTotal  uint64  `json:"memTotalBytes"`
	DiskUsed  uint64  `json:"diskUsedBytes"`
	DiskTotal uint64  `json:"diskTotalBytes"`
	Load1     float64 `json:"load1"`
	Load5     float64 `json:"load5"`
	Load15    float64 `json:"load15"`
}

// GatherInfo collects the host info snapshot. Best-effort: a failing subsystem
// leaves its fields zero rather than failing the whole call.
func GatherInfo(ctx context.Context) (Info, error) {
	info := Info{Arch: runtime.GOARCH, OS: runtime.GOOS}
	if hi, err := host.InfoWithContext(ctx); err == nil {
		info.Hostname = hi.Hostname
		info.Platform = hi.Platform
		info.PlatformVer = hi.PlatformVersion
		info.Kernel = hi.KernelVersion
		info.UptimeSecond = hi.Uptime
	} else if hn, herr := os.Hostname(); herr == nil {
		info.Hostname = hn
	}
	if cs, err := cpu.InfoWithContext(ctx); err == nil && len(cs) > 0 {
		info.CPUModel = cs[0].ModelName
	}
	info.CPUCount = runtime.NumCPU()
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		info.MemTotal = vm.Total
	}
	return info, nil
}

// GatherStats samples live utilization. The CPU sample blocks for ~200ms to
// produce a meaningful percentage.
func GatherStats(ctx context.Context) (Stats, error) {
	var s Stats
	if pcts, err := cpu.PercentWithContext(ctx, 200*time.Millisecond, false); err == nil && len(pcts) > 0 {
		s.CPUPct = pcts[0]
	}
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		s.MemUsed = vm.Used
		s.MemTotal = vm.Total
	}
	if du, err := disk.UsageWithContext(ctx, "/"); err == nil {
		s.DiskUsed = du.Used
		s.DiskTotal = du.Total
	}
	if avg, err := load.AvgWithContext(ctx); err == nil {
		s.Load1, s.Load5, s.Load15 = avg.Load1, avg.Load5, avg.Load15
	}
	return s, nil
}
