// Package sftp is the daemon's SFTP front door: an embedded SSH server that lets
// a user manage one server's files in bulk with any SFTP client. Access is via
// short-lived, per-session credentials the panel mints (username/password, no
// shell) — never the operator's own SSH. Each session is sandboxed to that
// server's data volume (the same containment the HTTP file manager enforces);
// shells, exec, port-forwarding, and symlinks are all refused.
package sftp

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"

	"github.com/cookiepanel/cookied/internal/safe"
)

// DefaultPort is the TCP port the SFTP server listens on. Fixed (not advertised
// in the heartbeat) so the panel can build the host:port without extra state.
const DefaultPort = 2022

// volumePrefix must match filesystem.VolumePrefix / server.DataVolumeName — the
// name of a server's data volume, whose host mountpoint roots the SFTP session.
const volumePrefix = "cookied-srv-"

// defaultTTL is how long a minted credential stays valid before auto-expiring.
const defaultTTL = 12 * time.Hour

// Inspector is the docker surface the manager needs to find a server's volume.
type Inspector interface {
	VolumeMountpoint(ctx context.Context, name string) (string, error)
}

// Manager owns the session store + the embedded SSH/SFTP server.
type Manager struct {
	store     *store
	docker    Inspector
	signer    ssh.Signer
	sshConfig *ssh.ServerConfig
	listener  net.Listener
	quit      chan struct{}
}

// NewManager loads (or generates + persists) the host key and prepares the SSH
// server config. Call Serve to start listening.
func NewManager(docker Inspector, stateDir string) (*Manager, error) {
	signer, err := loadOrCreateHostKey(filepath.Join(stateDir, "sftp"))
	if err != nil {
		return nil, err
	}
	m := &Manager{
		store:  newStore(defaultTTL),
		docker: docker,
		signer: signer,
		quit:   make(chan struct{}),
	}
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			serverID, ok := m.store.Authenticate(c.User(), string(pass))
			if !ok {
				return nil, fmt.Errorf("authentication failed")
			}
			return &ssh.Permissions{
				Extensions: map[string]string{"serverID": serverID},
			}, nil
		},
	}
	cfg.AddHostKey(signer)
	m.sshConfig = cfg
	return m, nil
}

// Mint creates a fresh credential for a server (replacing any existing one).
func (m *Manager) Mint(serverID string) (Session, error) {
	return m.store.Mint(serverID)
}

// Active reports the (non-secret) live session for a server.
func (m *Manager) Active(serverID string) Info { return m.store.Active(serverID) }

// Revoke drops a server's session.
func (m *Manager) Revoke(serverID string) { m.store.Revoke(serverID) }

// Serve binds the listener and accepts connections in the background.
func (m *Manager) Serve(addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("sftp: listen %s: %w", addr, err)
	}
	m.listener = ln
	go m.acceptLoop()
	go m.sweepLoop()
	return nil
}

// Shutdown stops accepting new connections.
func (m *Manager) Shutdown() {
	select {
	case <-m.quit:
	default:
		close(m.quit)
	}
	if m.listener != nil {
		_ = m.listener.Close()
	}
}

func (m *Manager) acceptLoop() {
	defer safe.Recover("sftp:acceptLoop")
	for {
		conn, err := m.listener.Accept()
		if err != nil {
			select {
			case <-m.quit:
				return
			default:
				slog.Debug("sftp accept failed", "err", err)
				return
			}
		}
		go m.handleConn(conn)
	}
}

func (m *Manager) sweepLoop() {
	defer safe.Recover("sftp:sweepLoop")
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-m.quit:
			return
		case <-t.C:
			m.store.sweep()
		}
	}
}

func (m *Manager) handleConn(nConn net.Conn) {
	defer safe.Recover("sftp:handleConn")
	defer nConn.Close()
	sshConn, chans, reqs, err := ssh.NewServerConn(nConn, m.sshConfig)
	if err != nil {
		// Failed handshake / bad credentials — expected noise, debug only.
		slog.Debug("sftp handshake failed", "remote", nConn.RemoteAddr(), "err", err)
		return
	}
	defer sshConn.Close()
	serverID := sshConn.Permissions.Extensions["serverID"]
	go ssh.DiscardRequests(reqs)

	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			_ = newChan.Reject(ssh.UnknownChannelType, "only session channels are supported")
			continue
		}
		ch, requests, err := newChan.Accept()
		if err != nil {
			continue
		}
		go m.handleSession(ch, requests, serverID)
	}
}

func (m *Manager) handleSession(ch ssh.Channel, requests <-chan *ssh.Request, serverID string) {
	defer safe.Recover("sftp:handleSession")
	defer ch.Close()
	for req := range requests {
		// Only the "sftp" subsystem is allowed — no shell, exec, pty, etc.
		ok := req.Type == "subsystem" && len(req.Payload) >= 4 &&
			string(req.Payload[4:]) == "sftp"
		_ = req.Reply(ok, nil)
		if ok {
			m.serveSFTP(ch, serverID)
			return
		}
	}
}

func (m *Manager) serveSFTP(ch ssh.Channel, serverID string) {
	root, err := m.docker.VolumeMountpoint(context.Background(), volumePrefix+serverID)
	if err != nil {
		slog.Warn("sftp: cannot resolve server volume", "server", serverID, "err", err)
		return
	}
	server := sftp.NewRequestServer(ch, newHandlers(root))
	if err := server.Serve(); err != nil && !errors.Is(err, io.EOF) {
		slog.Debug("sftp session ended", "server", serverID, "err", err)
	}
	_ = server.Close()
}

// loadOrCreateHostKey returns a stable ed25519 host key, generating + persisting
// one (0600) on first run so clients' known_hosts stays valid across restarts.
func loadOrCreateHostKey(dir string) (ssh.Signer, error) {
	keyPath := filepath.Join(dir, "host_ed25519")
	if data, err := os.ReadFile(keyPath); err == nil {
		return ssh.ParsePrivateKey(data)
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate host key: %w", err)
	}
	block, err := ssh.MarshalPrivateKey(priv, "cookied-sftp")
	if err != nil {
		return nil, fmt.Errorf("marshal host key: %w", err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(block), 0o600); err != nil {
		return nil, fmt.Errorf("persist host key: %w", err)
	}
	return ssh.NewSignerFromKey(priv)
}
