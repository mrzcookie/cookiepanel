// Package tui is cookied's offline operator console: a local terminal UI to list
// and start/stop/delete servers and tail their logs when the panel is down. It
// talks ONLY to the box-local IPC socket (see internal/ipc) — never the panel.
//
// The look echoes the panel's "Console" design language: azure-on-ink, mono as
// the chassis, [ STATUS ] bracket chips, // section eyebrows, hairline rules
// instead of heavy boxes, and a single accent (azure) that's the only thing that
// lights up — color carries state, never decoration.
package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/cookiepanel/cookied/internal/ipc"
	"github.com/cookiepanel/cookied/internal/store"
)

// Run starts the TUI against the daemon's local control socket.
func Run(socketPath string) error {
	p := tea.NewProgram(initialModel(socketPath), tea.WithAltScreen())
	_, err := p.Run()
	return err
}

type screen int

const (
	screenList screen = iota
	screenLogs
)

type model struct {
	client *ipc.Client

	width, height int
	screen        screen
	frame         int // spinner animation frame

	status     store.Status
	statusErr  error
	servers    []ipc.ServerSummary
	serversErr error
	cursor     int
	pendingOp  string // a control op in flight, or ""
	confirming bool   // a delete is awaiting y/n confirmation
	flash      string // transient status line at the bottom
	flashErr   bool

	logs    string
	logsErr error
}

func initialModel(socketPath string) model {
	return model{client: ipc.NewClient(socketPath), screen: screenList}
}

// ─── messages + commands ─────────────────────────────────────────────────────

type statusMsg struct {
	st  store.Status
	err error
}
type serversMsg struct {
	list []ipc.ServerSummary
	err  error
}
type opDoneMsg struct {
	op  string
	err error
}
type logsMsg struct {
	text string
	err  error
}
type (
	dataTickMsg time.Time
	spinTickMsg time.Time
)

func fetchStatus(c *ipc.Client) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		st, err := c.Status(ctx)
		return statusMsg{st: st, err: err}
	}
}

func fetchServers(c *ipc.Client) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		list, err := c.ListServers(ctx)
		return serversMsg{list: list, err: err}
	}
}

func runOp(c *ipc.Client, op, id string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		defer cancel()
		var err error
		switch op {
		case "start":
			_, err = c.StartServer(ctx, id)
		case "stop":
			_, err = c.StopServer(ctx, id)
		case "delete":
			err = c.DeleteServer(ctx, id)
		default:
			err = fmt.Errorf("unknown op %s", op)
		}
		return opDoneMsg{op: op, err: err}
	}
}

func fetchLogs(c *ipc.Client, id string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		text, err := c.ServerLogs(ctx, id, 200)
		return logsMsg{text: text, err: err}
	}
}

func dataTick() tea.Cmd {
	return tea.Tick(5*time.Second, func(t time.Time) tea.Msg { return dataTickMsg(t) })
}

func spinTick() tea.Cmd {
	return tea.Tick(110*time.Millisecond, func(t time.Time) tea.Msg { return spinTickMsg(t) })
}

// ─── bubbletea model ─────────────────────────────────────────────────────────

func (m model) Init() tea.Cmd {
	return tea.Batch(fetchStatus(m.client), fetchServers(m.client), dataTick(), spinTick())
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case tea.KeyMsg:
		return m.onKey(msg)
	case spinTickMsg:
		m.frame++
		return m, spinTick()
	case dataTickMsg:
		if m.screen == screenList {
			return m, tea.Batch(fetchStatus(m.client), fetchServers(m.client), dataTick())
		}
		return m, dataTick()
	case statusMsg:
		m.status, m.statusErr = msg.st, msg.err
		return m, nil
	case serversMsg:
		m.servers, m.serversErr = msg.list, msg.err
		if m.cursor >= len(m.servers) {
			m.cursor = max(0, len(m.servers)-1)
		}
		return m, nil
	case opDoneMsg:
		m.pendingOp = ""
		if msg.err != nil {
			m.flash, m.flashErr = fmt.Sprintf("%s failed: %s", msg.op, msg.err), true
		} else {
			m.flash, m.flashErr = fmt.Sprintf("%s succeeded", msg.op), false
		}
		return m, fetchServers(m.client)
	case logsMsg:
		m.logs, m.logsErr = msg.text, msg.err
		return m, nil
	}
	return m, nil
}

func (m model) onKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()

	// A pending delete confirmation captures input until resolved.
	if m.confirming {
		switch key {
		case "y", "enter":
			m.confirming = false
			return m.startOp("delete")
		case "n", "esc", "q", "ctrl+c":
			m.confirming = false
			m.flash, m.flashErr = "", false
		}
		return m, nil
	}

	if m.screen == screenLogs {
		switch key {
		case "q", "ctrl+c":
			return m, tea.Quit
		case "esc", "b", "l":
			m.screen, m.logs, m.logsErr = screenList, "", nil
		case "r":
			if id := m.selectedID(); id != "" {
				m.logs, m.logsErr = "", nil
				return m, fetchLogs(m.client, id)
			}
		}
		return m, nil
	}

	switch key {
	case "q", "ctrl+c":
		return m, tea.Quit
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down", "j":
		if m.cursor < len(m.servers)-1 {
			m.cursor++
		}
	case "g", "home":
		m.cursor = 0
	case "G", "end":
		m.cursor = max(0, len(m.servers)-1)
	case "r":
		m.flash = ""
		return m, tea.Batch(fetchStatus(m.client), fetchServers(m.client))
	case "s":
		return m.startOp("start")
	case "x":
		return m.startOp("stop")
	case "d":
		if m.selectedID() != "" && m.pendingOp == "" {
			m.confirming = true
		}
	case "l", "enter":
		if id := m.selectedID(); id != "" {
			m.screen, m.logs, m.logsErr = screenLogs, "", nil
			return m, fetchLogs(m.client, id)
		}
	}
	return m, nil
}

func (m model) startOp(op string) (tea.Model, tea.Cmd) {
	id := m.selectedID()
	if id == "" || m.pendingOp != "" {
		return m, nil
	}
	m.pendingOp = op
	m.flash = ""
	return m, runOp(m.client, op, id)
}

func (m model) selectedID() string {
	if m.cursor >= 0 && m.cursor < len(m.servers) {
		return m.servers[m.cursor].ServerID
	}
	return ""
}

func (m model) selectedName() string {
	if m.cursor >= 0 && m.cursor < len(m.servers) {
		return m.servers[m.cursor].Name
	}
	return ""
}

func (m model) spinner() string {
	return spinnerFrames[m.frame%len(spinnerFrames)]
}

// ─── views ───────────────────────────────────────────────────────────────────

func (m model) View() string {
	if m.screen == screenLogs {
		return m.viewLogs()
	}
	return m.viewList()
}

func (m model) viewList() string {
	w, _ := m.dims()
	var b strings.Builder

	b.WriteString(titleBar("local control", w) + "\n")
	b.WriteString(m.statusEyebrow() + "\n\n")
	b.WriteString(styleEyebrow.Render("// servers") + "\n")

	cw := computeCols(w)
	switch {
	case m.serversErr != nil:
		b.WriteString(styleDanger.Render("  ✗ "+m.serversErr.Error()) + "\n")
	case len(m.servers) == 0:
		b.WriteString(styleDim.Render("  no servers on this box.") + "\n")
	default:
		header := "  " + place(cw.name, "NAME") + "  " + place(cw.status, "STATE") +
			"  " + place(cw.cid, "CONTAINER") + "  " + place(cw.uptime, "STATUS")
		b.WriteString(styleColHead.Render(header) + "\n")
		for i, s := range m.servers {
			b.WriteString(m.renderRow(s, i == m.cursor, cw, w) + "\n")
		}
	}

	// Pin the footer to the bottom so the layout doesn't jump as rows change.
	body := b.String()
	footer := m.footer(w)
	if pad := m.height - lipgloss.Height(body) - lipgloss.Height(footer); pad > 0 {
		body += strings.Repeat("\n", pad)
	}
	return body + footer
}

func (m model) renderRow(s ipc.ServerSummary, selected bool, c cols, w int) string {
	name := truncate(s.Name, c.name)

	chipCell := place(c.status, chip(s.State))
	cidCell := place(c.cid, styleDim.Render(shortID(s.ContainerID)))
	upCell := place(c.uptime, m.statusCell(s, c.uptime))

	nameStyle, prefix := styleRowName, "  "
	if selected {
		nameStyle, prefix = styleSelName, styleAccent.Render("▌")+" "
	}
	nameCell := place(c.name, nameStyle.Render(name))
	row := prefix + nameCell + "  " + chipCell + "  " + cidCell + "  " + upCell
	if selected {
		return styleSelRow.Width(w).Render(row)
	}
	return row
}

// shortID renders the operator's docker handle: the 12-char short container id,
// or a dash when the server has no container yet.
func shortID(id string) string {
	if id == "" {
		return "—"
	}
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

// statusCell shows docker's status line (e.g. "Up 3 minutes", "Exited (0) 5
// minutes ago"), a spinner while a lifecycle op is in flight, or a dash.
func (m model) statusCell(s ipc.ServerSummary, w int) string {
	switch strings.ToLower(s.State) {
	case "installing", "starting", "restarting", "stopping", "removing":
		return styleAccent.Render(m.spinner())
	default:
		if s.Status == "" {
			return styleDim.Render("—")
		}
		return styleDim.Render(truncate(s.Status, w))
	}
}

func (m model) viewLogs() string {
	w, h := m.dims()
	var b strings.Builder
	b.WriteString(titleBar("logs", w) + "\n")
	b.WriteString(styleEyebrow.Render("// "+m.selectedName()) + "\n\n")

	innerW := w - 4
	boxH := max(h-7, 3)
	var content string
	switch {
	case m.logsErr != nil:
		content = styleDanger.Render("✗ " + m.logsErr.Error())
	case m.logs == "":
		content = styleDim.Render(m.spinner() + " loading…")
	default:
		lines := strings.Split(strings.TrimRight(m.logs, "\n"), "\n")
		if len(lines) > boxH {
			lines = lines[len(lines)-boxH:]
		}
		for i, ln := range lines {
			lines[i] = truncate(ln, innerW)
		}
		content = strings.Join(lines, "\n")
	}
	box := styleBox.Width(innerW).Height(boxH).Render(content)
	b.WriteString(box + "\n")

	body := b.String()
	footer := rule(w) + "\n" + helpLine([][2]string{{"r", "refresh"}, {"b/esc", "back"}, {"q", "quit"}})
	if pad := m.height - lipgloss.Height(body) - lipgloss.Height(footer); pad > 0 {
		body += strings.Repeat("\n", pad)
	}
	return body + footer
}

// ─── chrome helpers ──────────────────────────────────────────────────────────

func titleBar(section string, w int) string {
	head := styleBrand.Render("COOKIED") + styleDim.Render("  ·  "+section)
	return head + "\n" + rule(w)
}

func (m model) statusEyebrow() string {
	node := m.status.NodeID
	if node == "" {
		node = "unenrolled"
	}
	ver := m.status.DaemonVersion
	if ver == "" {
		ver = "dev"
	}
	running := 0
	for _, s := range m.servers {
		if strings.EqualFold(s.State, "running") {
			running++
		}
	}
	parts := fmt.Sprintf("// node %s · cookied %s · %d server%s, %d running",
		node, ver, len(m.servers), plural(len(m.servers)), running)
	return styleEyebrow.Render(parts) + "  " + m.beatChip()
}

// beatChip reflects the daemon↔panel heartbeat freshness as a bracket chip.
func (m model) beatChip() string {
	switch {
	case m.statusErr != nil:
		return chipColor("DAEMON?", styleDanger)
	case m.status.LastHeartbeatAt.IsZero():
		return chipColor("PENDING", styleDim)
	case time.Since(m.status.LastHeartbeatAt) < 90*time.Second && m.status.LastHeartbeatOK:
		return chipColor("ONLINE", styleOK)
	default:
		return chipColor("STALE", styleWarn)
	}
}

func (m model) footer(w int) string {
	bottom := helpLine([][2]string{
		{"↑/↓", "move"}, {"s", "start"}, {"x", "stop"},
		{"d", "delete"}, {"l", "logs"}, {"r", "refresh"}, {"q", "quit"},
	})
	switch {
	case m.confirming:
		bottom = styleDanger.Render(" delete "+m.selectedName()+"? ") +
			styleKey.Render("y") + styleDim.Render(" confirm   ") +
			styleKey.Render("n") + styleDim.Render(" cancel")
	case m.pendingOp != "":
		bottom += "\n " + styleAccent.Render(m.spinner()) + " " + styleDim.Render(m.pendingOp+"…")
	case m.flash != "":
		mark, st := "✓", styleOK
		if m.flashErr {
			mark, st = "✗", styleDanger
		}
		bottom += "\n " + st.Render(mark+" "+m.flash)
	}
	return rule(w) + "\n" + bottom
}

func helpLine(pairs [][2]string) string {
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, styleKey.Render(p[0])+" "+styleDim.Render(p[1]))
	}
	return " " + strings.Join(parts, styleDim.Render("   "))
}

// chip renders a [ STATE ] bracket chip colored by lifecycle state.
func chip(state string) string {
	switch strings.ToLower(state) {
	case "running":
		return chipColor("RUNNING", styleOK)
	case "installing":
		return chipColor("INSTALLING", styleWarn)
	case "starting", "restarting", "stopping", "removing", "paused":
		return chipColor(strings.ToUpper(state), styleWarn)
	case "failed", "dead":
		return chipColor(strings.ToUpper(state), styleDanger)
	default: // exited, created, stopped, ""
		label := state
		if label == "" {
			label = "unknown"
		}
		return chipColor(strings.ToUpper(label), styleDim)
	}
}

func chipColor(label string, st lipgloss.Style) string {
	return st.Render("[ " + label + " ]")
}

func rule(w int) string {
	return styleHair.Render(strings.Repeat("─", max(w, 1)))
}

// place left-aligns s into a w-wide cell (ANSI-aware), padding with spaces.
func place(w int, s string) string {
	if w < 0 {
		w = 0
	}
	return lipgloss.PlaceHorizontal(w, lipgloss.Left, s)
}

func (m model) dims() (int, int) {
	w, h := m.width, m.height
	if w < 40 {
		w = 90
	}
	if h < 10 {
		h = 28
	}
	return w, h
}

// cols holds the computed column widths for the server table.
type cols struct{ name, status, cid, uptime int }

func computeCols(w int) cols {
	const (
		statusW = 14 // fits "[ INSTALLING ]"
		cidW    = 12 // a docker short id
		uptimeW = 20 // "Exited (0) 5 minutes ago"
		gaps    = 6  // three 2-space gaps
		prefix  = 2  // selection bar + space
	)
	// The name column absorbs whatever's left — it's the thing operators scan by.
	name := clampi(w-prefix-statusW-cidW-uptimeW-gaps-1, 16, 44)
	return cols{name: name, status: statusW, cid: cidW, uptime: uptimeW}
}

func truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if lipgloss.Width(s) <= n {
		return s
	}
	if n == 1 {
		return "…"
	}
	r := []rune(s)
	if len(r) > n-1 {
		r = r[:n-1]
	}
	return string(r) + "…"
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func clampi(v, lo, hi int) int {
	return min(max(v, lo), hi)
}

// ─── palette + styles ────────────────────────────────────────────────────────
//
// "The Console": azure-on-ink. One accent (azure) that's the only thing that
// lights up; semantic colors carry state, hairlines (not boxes) carry structure.

var spinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

var (
	colAccent = lipgloss.Color("#5ea1ff") // azure
	colDim    = lipgloss.Color("#7b8190")
	colHair   = lipgloss.Color("#363a44")
	colBright = lipgloss.Color("#e7ebf2")
	colOK     = lipgloss.Color("#56d196")
	colWarn   = lipgloss.Color("#e7b75f")
	colDanger = lipgloss.Color("#ec6a6a")
	colSelBg  = lipgloss.Color("#16243a")

	styleBrand   = lipgloss.NewStyle().Bold(true).Foreground(colAccent)
	styleAccent  = lipgloss.NewStyle().Foreground(colAccent)
	styleDim     = lipgloss.NewStyle().Foreground(colDim)
	styleEyebrow = lipgloss.NewStyle().Foreground(colDim).Italic(true)
	styleColHead = lipgloss.NewStyle().Foreground(colDim).Bold(true)
	styleHair    = lipgloss.NewStyle().Foreground(colHair)
	styleKey     = lipgloss.NewStyle().Foreground(colAccent).Bold(true)
	styleOK      = lipgloss.NewStyle().Foreground(colOK)
	styleWarn    = lipgloss.NewStyle().Foreground(colWarn)
	styleDanger  = lipgloss.NewStyle().Foreground(colDanger)

	styleRowName = lipgloss.NewStyle().Foreground(colBright)
	styleSelName = lipgloss.NewStyle().Bold(true).Foreground(colBright)
	styleSelRow  = lipgloss.NewStyle().Background(colSelBg)

	styleBox = lipgloss.NewStyle().
			Border(lipgloss.NormalBorder()).
			BorderForeground(colHair).
			Padding(0, 1)
)
