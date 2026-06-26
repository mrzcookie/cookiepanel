package sftp

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"sync"
	"time"
)

// credAlphabet excludes visually ambiguous characters (0/O, 1/l/I) so a user can
// retype the credentials without confusion.
const credAlphabet = "abcdefghijkmnpqrstuvwxyz23456789"

// session is one minted SFTP credential: a username/password pair bound to a
// server's data volume, valid until expiry or revocation. The password is only
// ever held hashed.
type session struct {
	serverID  string
	passHash  [32]byte
	expiresAt time.Time
}

// Session is the freshly-minted credential returned to the panel exactly once
// (the password is not recoverable afterward).
type Session struct {
	Username  string    `json:"username"`
	Password  string    `json:"password"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// Info is the non-secret view of the active session for a server (the password
// is never included).
type Info struct {
	Active    bool      `json:"active"`
	Username  string    `json:"username,omitempty"`
	ExpiresAt time.Time `json:"expiresAt,omitempty"`
}

// store holds active SFTP sessions in memory (lost on daemon restart, which is
// fine — the panel re-mints on demand). At most one session per server: minting
// a new one revokes the old.
type store struct {
	mu       sync.Mutex
	byUser   map[string]*session // username → session
	byServer map[string]string   // serverID → username
	ttl      time.Duration
}

func newStore(ttl time.Duration) *store {
	return &store{
		byUser:   make(map[string]*session),
		byServer: make(map[string]string),
		ttl:      ttl,
	}
}

func randString(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = credAlphabet[int(b[i])%len(credAlphabet)]
	}
	return string(b), nil
}

// Mint creates a fresh credential for serverID, replacing any existing one.
func (s *store) Mint(serverID string) (Session, error) {
	user, err := randString(12)
	if err != nil {
		return Session{}, err
	}
	pass, err := randString(24)
	if err != nil {
		return Session{}, err
	}
	username := "srv-" + user
	expiresAt := time.Now().Add(s.ttl).UTC()

	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.byServer[serverID]; ok {
		delete(s.byUser, old)
	}
	s.byUser[username] = &session{
		serverID:  serverID,
		passHash:  sha256.Sum256([]byte(pass)),
		expiresAt: expiresAt,
	}
	s.byServer[serverID] = username
	return Session{Username: username, Password: pass, ExpiresAt: expiresAt}, nil
}

// Authenticate validates a username/password and returns the bound server id.
// Constant-time password comparison; expired sessions are rejected (and reaped).
func (s *store) Authenticate(username, password string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.byUser[username]
	if !ok {
		return "", false
	}
	if time.Now().After(sess.expiresAt) {
		s.removeLocked(username, sess.serverID)
		return "", false
	}
	got := sha256.Sum256([]byte(password))
	if subtle.ConstantTimeCompare(got[:], sess.passHash[:]) != 1 {
		return "", false
	}
	return sess.serverID, true
}

// Active reports the non-secret session info for a server (none / expired → not
// active).
func (s *store) Active(serverID string) Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	username, ok := s.byServer[serverID]
	if !ok {
		return Info{Active: false}
	}
	sess := s.byUser[username]
	if sess == nil || time.Now().After(sess.expiresAt) {
		s.removeLocked(username, serverID)
		return Info{Active: false}
	}
	return Info{Active: true, Username: username, ExpiresAt: sess.expiresAt}
}

// Revoke drops any session for a server.
func (s *store) Revoke(serverID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if username, ok := s.byServer[serverID]; ok {
		s.removeLocked(username, serverID)
	}
}

func (s *store) removeLocked(username, serverID string) {
	delete(s.byUser, username)
	delete(s.byServer, serverID)
}

// sweep reaps expired sessions; call periodically to bound the maps.
func (s *store) sweep() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for username, sess := range s.byUser {
		if now.After(sess.expiresAt) {
			s.removeLocked(username, sess.serverID)
		}
	}
}
