package scheduler

import (
	"context"
	"errors"
	"testing"

	"github.com/cookiepanel/cookied/internal/server"
	"github.com/cookiepanel/cookied/internal/store"
)

// fakeServers records the calls a fired schedule makes, and can be told to fail
// a given power action to exercise the early-abort path.
type fakeServers struct {
	commands []string
	powers   []string
	failOn   string // power action to fail ("" = none)
}

func (f *fakeServers) SendCommand(_ context.Context, _, command string) error {
	f.commands = append(f.commands, command)
	return nil
}

func (f *fakeServers) power(action string) (*server.Server, error) {
	f.powers = append(f.powers, action)
	if action == f.failOn {
		return nil, errors.New("boom")
	}
	return &server.Server{}, nil
}

func (f *fakeServers) Start(_ context.Context, _ string) (*server.Server, error) {
	return f.power(ActionStart)
}
func (f *fakeServers) Stop(_ context.Context, _ string) (*server.Server, error) {
	return f.power(ActionStop)
}
func (f *fakeServers) Restart(_ context.Context, _ string) (*server.Server, error) {
	return f.power(ActionRestart)
}

func newTestScheduler(t *testing.T, srv Servers) *Scheduler {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, srv)
}

func TestValidateCron(t *testing.T) {
	if err := ValidateCron("0 4 * * *"); err != nil {
		t.Fatalf("valid 5-field cron rejected: %v", err)
	}
	for _, bad := range []string{"0 4 * * * *", "nonsense", ""} {
		if err := ValidateCron(bad); err == nil {
			t.Fatalf("cron %q: want error", bad)
		}
	}
}

func TestValidateStep(t *testing.T) {
	ok := []store.ScheduleStep{
		{Type: StepCommand, Command: "say hi"},
		{Type: StepWait, Seconds: 30},
		{Type: StepPower, Power: ActionRestart},
	}
	for _, st := range ok {
		if err := validateStep(st); err != nil {
			t.Fatalf("step %+v rejected: %v", st, err)
		}
	}
	bad := []store.ScheduleStep{
		{Type: StepCommand},                  // no command
		{Type: StepWait, Seconds: 0},         // out of range
		{Type: StepWait, Seconds: 100_000},   // out of range
		{Type: StepPower, Power: "sideways"}, // bad action
		{Type: StepBackup},                   // reserved (backups slice)
		{Type: "mystery"},                    // unknown
	}
	for _, st := range bad {
		if err := validateStep(st); err == nil {
			t.Fatalf("step %+v: want error", st)
		}
	}
}

func TestUpsertPersistsAndLists(t *testing.T) {
	s := newTestScheduler(t, &fakeServers{})
	sc := store.Schedule{
		ID:       "sched-1",
		ServerID: "srv-1",
		Name:     "Nightly restart",
		Cron:     "0 4 * * *",
		Enabled:  true,
		Steps:    []store.ScheduleStep{{Type: StepPower, Power: ActionRestart}},
	}
	if err := s.Upsert(sc); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	list, err := s.List()
	if err != nil || len(list) != 1 || list[0].ID != "sched-1" {
		t.Fatalf("list = %+v, err %v", list, err)
	}

	// Rejections: no steps, bad cron, a backup step.
	if err := s.Upsert(store.Schedule{ID: "x", ServerID: "y", Cron: "0 4 * * *"}); err == nil {
		t.Fatal("upsert with no steps: want error")
	}
	if err := s.Upsert(store.Schedule{ID: "x", ServerID: "y", Cron: "bad", Steps: sc.Steps}); err == nil {
		t.Fatal("upsert with bad cron: want error")
	}
	if err := s.Upsert(store.Schedule{
		ID: "x", ServerID: "y", Cron: "0 4 * * *",
		Steps: []store.ScheduleStep{{Type: StepBackup}},
	}); err == nil {
		t.Fatal("upsert with backup step: want error")
	}
}

func TestFireRunsStepsInOrderAndRecords(t *testing.T) {
	srv := &fakeServers{}
	s := newTestScheduler(t, srv)
	sc := store.Schedule{
		ID: "sched-1", ServerID: "srv-1", Cron: "0 4 * * *", Enabled: true,
		Steps: []store.ScheduleStep{
			{Type: StepPower, Power: ActionRestart},
			{Type: StepCommand, Command: "say back up"},
		},
	}
	if err := s.Upsert(sc); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := s.fireCtx(context.Background(), sc); err != nil {
		t.Fatalf("fire: %v", err)
	}
	if len(srv.powers) != 1 || srv.powers[0] != ActionRestart {
		t.Fatalf("powers = %v", srv.powers)
	}
	if len(srv.commands) != 1 || srv.commands[0] != "say back up" {
		t.Fatalf("commands = %v", srv.commands)
	}
	got, _, _ := s.store.GetSchedule("sched-1")
	if got.LastStatus != "ok" || got.LastRunAt.IsZero() {
		t.Fatalf("last run not recorded ok: %+v", got)
	}
}

func TestFireAbortsOnStepError(t *testing.T) {
	srv := &fakeServers{failOn: ActionStop}
	s := newTestScheduler(t, srv)
	sc := store.Schedule{
		ID: "sched-1", ServerID: "srv-1", Cron: "0 4 * * *", Enabled: true,
		Steps: []store.ScheduleStep{
			{Type: StepPower, Power: ActionStop},          // fails
			{Type: StepCommand, Command: "never reached"}, // must not run
		},
	}
	_ = s.Upsert(sc)
	if err := s.fireCtx(context.Background(), sc); err == nil {
		t.Fatal("fire: want error")
	}
	if len(srv.commands) != 0 {
		t.Fatalf("steps continued after a failure: %v", srv.commands)
	}
	got, _, _ := s.store.GetSchedule("sched-1")
	if got.LastStatus != "error" || got.LastError == "" {
		t.Fatalf("error not recorded: %+v", got)
	}
}

func TestRunNowMissing(t *testing.T) {
	s := newTestScheduler(t, &fakeServers{})
	if err := s.RunNow("nope"); err == nil {
		t.Fatal("run-now on missing schedule: want error")
	}
}
