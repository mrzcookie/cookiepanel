// Package scheduler is the daemon's cron runtime for server automations. A
// schedule is a named script (command / wait / power / backup steps) run on a
// 5-field cron expression. Definitions live in the local store (bbolt), so the
// scheduler keeps firing across restarts and while the panel is offline; the
// panel is just the editing UI.
package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/xena-studios/raptor/apps/wings/internal/safe"
	"github.com/xena-studios/raptor/apps/wings/internal/server"
	"github.com/xena-studios/raptor/apps/wings/internal/store"
)

// Step types in a schedule's script.
const (
	StepCommand = "command" // send a console command to the server process
	StepWait    = "wait"    // sleep for Seconds
	StepPower   = "power"   // start/stop/restart the server
	StepBackup  = "backup"  // create a backup of the server's data volume
)

// Power actions the scheduler can run against a server.
const (
	ActionStart   = "start"
	ActionStop    = "stop"
	ActionRestart = "restart"
)

// stdParser matches the 5-field cron the panel exposes (min hour dom mon dow).
var stdParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow,
)

// ValidateCron returns an error if spec isn't a valid 5-field cron expression.
func ValidateCron(spec string) error {
	_, err := stdParser.Parse(spec)
	return err
}

// validateStep checks one step is well-formed for its type.
func validateStep(st store.ScheduleStep) error {
	switch st.Type {
	case StepCommand:
		if st.Command == "" {
			return fmt.Errorf("command step requires a command")
		}
	case StepWait:
		if st.Seconds < 1 || st.Seconds > 86_400 {
			return fmt.Errorf("wait step seconds must be 1..86400")
		}
	case StepPower:
		switch st.Power {
		case ActionStart, ActionStop, ActionRestart:
		default:
			return fmt.Errorf("power step must be start|stop|restart")
		}
	case StepBackup:
		// no parameters
	default:
		return fmt.Errorf("unknown step type %q", st.Type)
	}
	return nil
}

// Servers is the slice of the server manager the scheduler drives — kept as an
// interface so step execution is testable without docker. *server.Manager
// satisfies it.
type Servers interface {
	SendCommand(ctx context.Context, serverID, command string) error
	Start(ctx context.Context, serverID string) (*server.Server, error)
	Stop(ctx context.Context, serverID string) (*server.Server, error)
	Restart(ctx context.Context, serverID string) (*server.Server, error)
}

// Backups is what a backup step needs. *backup.Manager satisfies it; may be nil
// when backups are unavailable (a backup step then fails at fire time).
type Backups interface {
	RunBackup(ctx context.Context, serverID, name string) error
}

// Scheduler owns the cron runner. It's rebuilt wholesale from the store on any
// change (simpler + race-free than surgically patching the runner).
type Scheduler struct {
	store   *store.Store
	servers Servers
	backups Backups

	mu   sync.Mutex
	cron *cron.Cron
}

// New constructs a Scheduler. Call Start to build + run the cron.
func New(st *store.Store, servers Servers, backups Backups) *Scheduler {
	return &Scheduler{store: st, servers: servers, backups: backups}
}

// Start builds the cron runner from persisted schedules and begins firing.
func (s *Scheduler) Start() error { return s.reload() }

// Stop halts the cron runner, waiting for any in-flight job to finish.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cron != nil {
		<-s.cron.Stop().Done()
		s.cron = nil
	}
}

// List returns every persisted schedule.
func (s *Scheduler) List() ([]store.Schedule, error) {
	return s.store.ListSchedules()
}

// Upsert validates + persists a schedule, then reloads the runner.
func (s *Scheduler) Upsert(sc store.Schedule) error {
	if sc.ID == "" || sc.ServerID == "" {
		return fmt.Errorf("id and serverId are required")
	}
	if len(sc.Steps) == 0 {
		return fmt.Errorf("a schedule needs at least one step")
	}
	for i, st := range sc.Steps {
		if err := validateStep(st); err != nil {
			return fmt.Errorf("step %d: %w", i+1, err)
		}
	}
	if err := ValidateCron(sc.Cron); err != nil {
		return fmt.Errorf("invalid cron %q: %w", sc.Cron, err)
	}
	if err := s.store.PutSchedule(sc); err != nil {
		return err
	}
	return s.reload()
}

// Remove deletes a schedule, then reloads the runner.
func (s *Scheduler) Remove(id string) error {
	if err := s.store.DeleteSchedule(id); err != nil {
		return err
	}
	return s.reload()
}

// RunNow fires a schedule's script immediately (the panel's "run now"). Because a
// script can include long waits, it runs in the background on its own bounded
// context rather than blocking the caller; the result lands in LastStatus.
func (s *Scheduler) RunNow(id string) error {
	sc, ok, err := s.store.GetSchedule(id)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("schedule %s not found", id)
	}
	go s.fire(sc)
	return nil
}

// reload rebuilds the cron runner from the current store snapshot.
func (s *Scheduler) reload() error {
	schedules, err := s.store.ListSchedules()
	if err != nil {
		return err
	}
	c := cron.New(cron.WithParser(stdParser))
	for _, sc := range schedules {
		if !sc.Enabled {
			continue
		}
		sc := sc // capture
		if _, err := c.AddFunc(sc.Cron, func() { s.fire(sc) }); err != nil {
			// A bad cron shouldn't sink the whole runner; skip + log.
			slog.Error("schedule skipped", "id", sc.ID, "err", err)
		}
	}
	c.Start()

	s.mu.Lock()
	old := s.cron
	s.cron = c
	s.mu.Unlock()
	if old != nil {
		old.Stop()
	}
	slog.Info("scheduler reloaded", "count", len(schedules))
	return nil
}

// scriptTimeout sizes the bounded context for a run: a base budget for the
// power/command steps plus the sum of all waits, capped so nothing runs away.
func scriptTimeout(steps []store.ScheduleStep) time.Duration {
	total := 1 * time.Minute
	for _, st := range steps {
		switch st.Type {
		case StepWait:
			total += time.Duration(st.Seconds) * time.Second
		case StepBackup:
			// Backups can run long on big volumes; give them room.
			total += 30 * time.Minute
		default:
			total += 30 * time.Second
		}
	}
	if total > 6*time.Hour {
		total = 6 * time.Hour
	}
	return total
}

// fire runs a schedule's whole script with its own bounded context. It's the
// single entry point for both cron-triggered and RunNow runs, so the panic guard
// here covers every background fire — a panic in one schedule can't crash the box.
func (s *Scheduler) fire(sc store.Schedule) {
	defer safe.Recover("schedule:" + sc.ID)
	ctx, cancel := context.WithTimeout(context.Background(), scriptTimeout(sc.Steps))
	defer cancel()
	if err := s.fireCtx(ctx, sc); err != nil {
		slog.Error("schedule fire failed", "id", sc.ID, "err", err)
	}
}

// fireCtx runs every step in order, stopping at the first failure, and records
// the outcome on the schedule so the panel can surface the last run.
func (s *Scheduler) fireCtx(ctx context.Context, sc store.Schedule) error {
	var runErr error
	for i, st := range sc.Steps {
		if err := s.runStep(ctx, sc.ServerID, st); err != nil {
			runErr = fmt.Errorf("step %d (%s): %w", i+1, st.Type, err)
			break
		}
	}

	sc.LastRunAt = time.Now().UTC()
	if runErr != nil {
		sc.LastStatus = "error"
		sc.LastError = runErr.Error()
	} else {
		sc.LastStatus = "ok"
		sc.LastError = ""
		slog.Info("schedule fired", "id", sc.ID, "server", sc.ServerID, "steps", len(sc.Steps))
	}
	if perr := s.store.PutSchedule(sc); perr != nil {
		slog.Error("persist schedule result failed", "id", sc.ID, "err", perr)
	}
	return runErr
}

// runStep executes one script step against the server.
func (s *Scheduler) runStep(ctx context.Context, serverID string, st store.ScheduleStep) error {
	switch st.Type {
	case StepCommand:
		return s.servers.SendCommand(ctx, serverID, st.Command)
	case StepWait:
		t := time.NewTimer(time.Duration(st.Seconds) * time.Second)
		defer t.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			return nil
		}
	case StepPower:
		var err error
		switch st.Power {
		case ActionStart:
			_, err = s.servers.Start(ctx, serverID)
		case ActionStop:
			_, err = s.servers.Stop(ctx, serverID)
		case ActionRestart:
			_, err = s.servers.Restart(ctx, serverID)
		default:
			err = fmt.Errorf("unknown power action %q", st.Power)
		}
		return err
	case StepBackup:
		if s.backups == nil {
			return fmt.Errorf("backups are unavailable on this node")
		}
		return s.backups.RunBackup(ctx, serverID, "Scheduled backup")
	default:
		return fmt.Errorf("unknown step type %q", st.Type)
	}
}
