// Package credentials persists the durable node credentials the panel issues at
// activation: panel URL, node id, node key, and signing secret. The file lives
// at <dataDir>/credentials with 0600 perms (root-only).
package credentials

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Credentials struct {
	PanelURL      string `yaml:"panel_url"`
	NodeID        string `yaml:"node_id"`
	NodeKey       string `yaml:"node_key"`
	SigningSecret string `yaml:"signing_secret"`
	// FQDN is the hostname the daemon advertises to the panel and uses as the
	// SAN of its self-signed TLS cert. Set during `wings configure`.
	FQDN string `yaml:"fqdn,omitempty"`
}

// Path returns the credentials file path under dataDir.
func Path(dataDir string) string {
	return filepath.Join(dataDir, "credentials")
}

// Load reads and parses the credentials file.
func Load(dataDir string) (*Credentials, error) {
	data, err := os.ReadFile(Path(dataDir))
	if err != nil {
		return nil, err
	}
	var c Credentials
	if err := yaml.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("parse credentials: %w", err)
	}
	return &c, nil
}

// Save writes the credentials file with restrictive perms, creating dataDir
// (also 0700) if needed.
func Save(dataDir string, c Credentials) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	data, err := yaml.Marshal(c)
	if err != nil {
		return fmt.Errorf("encode credentials: %w", err)
	}
	if err := os.WriteFile(Path(dataDir), data, 0o600); err != nil {
		return fmt.Errorf("write credentials: %w", err)
	}
	return nil
}
