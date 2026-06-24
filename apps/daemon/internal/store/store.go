// Package store is the daemon's embedded local state (bbolt) under
// /var/lib/cookied, 0600. It persists the daemon's status snapshot — the last
// heartbeat result, the system info, and the start time — so a freshly-started
// daemon can answer status queries immediately and stays the authoritative
// record of the box while the panel is unreachable. The panel reconciles on
// reconnect. It also persists the server **schedules**, so the scheduler keeps
// firing automations across restarts and while the panel is offline.
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	dbFileName  = "state.db"
	systemBkt   = "system"
	scheduleBkt = "schedules"
	statusKey   = "status"
	openTimeout = 5 * time.Second
)

// Store wraps a bbolt database. Safe for concurrent use by multiple goroutines.
type Store struct {
	db *bolt.DB
}

// Status is the snapshot persisted across restarts so a freshly-started daemon
// can answer status queries immediately (and, later, serve them over the local
// IPC socket).
type Status struct {
	NodeID           string         `json:"nodeId"`
	PanelURL         string         `json:"panelUrl"`
	DaemonVersion    string         `json:"daemonVersion"`
	DaemonStartedAt  time.Time      `json:"daemonStartedAt"`
	LastHeartbeatAt  time.Time      `json:"lastHeartbeatAt,omitempty"`
	LastHeartbeatOK  bool           `json:"lastHeartbeatOk"`
	LastHeartbeatErr string         `json:"lastHeartbeatErr,omitempty"`
	SystemInfo       map[string]any `json:"systemInfo,omitempty"`
}

// Open creates dir (0700) if needed and opens <dir>/state.db with 0600 perms.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create state dir: %w", err)
	}
	db, err := bolt.Open(filepath.Join(dir, dbFileName), 0o600, &bolt.Options{
		Timeout: openTimeout,
	})
	if err != nil {
		return nil, fmt.Errorf("open state db: %w", err)
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		for _, b := range []string{systemBkt, scheduleBkt} {
			if _, err := tx.CreateBucketIfNotExists([]byte(b)); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init buckets: %w", err)
	}
	return &Store{db: db}, nil
}

// Close releases the underlying bbolt file lock.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// Path is the full path to the bbolt file under dir.
func Path(dir string) string {
	return filepath.Join(dir, dbFileName)
}

// PutStatus persists the full status snapshot.
func (s *Store) PutStatus(st Status) error {
	raw, err := json.Marshal(st)
	if err != nil {
		return fmt.Errorf("encode status: %w", err)
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte(systemBkt)).Put([]byte(statusKey), raw)
	})
}

// GetStatus returns the last persisted snapshot. A missing record is not an
// error; the returned Status is zero-valued and ok=false.
func (s *Store) GetStatus() (Status, bool, error) {
	var (
		st  Status
		raw []byte
	)
	err := s.db.View(func(tx *bolt.Tx) error {
		if v := tx.Bucket([]byte(systemBkt)).Get([]byte(statusKey)); v != nil {
			raw = append(raw, v...)
		}
		return nil
	})
	if err != nil {
		return Status{}, false, err
	}
	if raw == nil {
		return Status{}, false, nil
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		return Status{}, false, fmt.Errorf("decode status: %w", err)
	}
	return st, true, nil
}

// UpdateStatus mutates the persisted Status under a single write transaction.
// fn receives the current snapshot (zero-valued if none) and returns the new one.
func (s *Store) UpdateStatus(fn func(Status) Status) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(systemBkt))
		var cur Status
		if v := b.Get([]byte(statusKey)); v != nil {
			if err := json.Unmarshal(v, &cur); err != nil {
				return fmt.Errorf("decode status: %w", err)
			}
		}
		next := fn(cur)
		raw, err := json.Marshal(next)
		if err != nil {
			return fmt.Errorf("encode status: %w", err)
		}
		return b.Put([]byte(statusKey), raw)
	})
}

// ─── schedules ───────────────────────────────────────────────────────────────

// Schedule is a daemon-side automation: a script run against a server on a cron
// expression. Persisted here so it keeps firing while the panel is offline — the
// panel is the editing UI; the daemon is the runtime.
type Schedule struct {
	ID       string `json:"id"`
	ServerID string `json:"serverId"`
	Name     string `json:"name"`
	Cron     string `json:"cron"`
	// Steps is the ordered script the schedule runs.
	Steps      []ScheduleStep `json:"steps"`
	Enabled    bool           `json:"enabled"`
	LastRunAt  time.Time      `json:"lastRunAt,omitempty"`
	LastError  string         `json:"lastError,omitempty"`
	LastStatus string         `json:"lastStatus,omitempty"` // ok | error
}

// ScheduleStep is one action in a schedule's script, executed in order.
type ScheduleStep struct {
	// Type is "command" (send console input), "wait" (sleep), or "power"
	// (start/stop/restart the server). "backup" is reserved for the backups slice.
	Type    string `json:"type"`
	Command string `json:"command,omitempty"` // type=command
	Seconds int    `json:"seconds,omitempty"` // type=wait
	Power   string `json:"power,omitempty"`   // type=power: start|stop|restart
}

// PutSchedule upserts a schedule by id.
func (s *Store) PutSchedule(sc Schedule) error {
	raw, err := json.Marshal(sc)
	if err != nil {
		return fmt.Errorf("encode schedule: %w", err)
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte(scheduleBkt)).Put([]byte(sc.ID), raw)
	})
}

// DeleteSchedule removes a schedule by id (idempotent).
func (s *Store) DeleteSchedule(id string) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte(scheduleBkt)).Delete([]byte(id))
	})
}

// GetSchedule returns one schedule; ok=false if absent.
func (s *Store) GetSchedule(id string) (Schedule, bool, error) {
	var (
		sc  Schedule
		raw []byte
	)
	err := s.db.View(func(tx *bolt.Tx) error {
		if v := tx.Bucket([]byte(scheduleBkt)).Get([]byte(id)); v != nil {
			raw = append(raw, v...)
		}
		return nil
	})
	if err != nil {
		return Schedule{}, false, err
	}
	if raw == nil {
		return Schedule{}, false, nil
	}
	if err := json.Unmarshal(raw, &sc); err != nil {
		return Schedule{}, false, fmt.Errorf("decode schedule: %w", err)
	}
	return sc, true, nil
}

// ListSchedules returns all persisted schedules.
func (s *Store) ListSchedules() ([]Schedule, error) {
	var out []Schedule
	err := s.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte(scheduleBkt)).ForEach(func(_, v []byte) error {
			var sc Schedule
			if err := json.Unmarshal(v, &sc); err != nil {
				return fmt.Errorf("decode schedule: %w", err)
			}
			out = append(out, sc)
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
