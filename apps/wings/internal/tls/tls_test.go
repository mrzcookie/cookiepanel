package tls

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
)

var hexRE = regexp.MustCompile(`^[0-9a-f]{64}$`)

func TestEnsureSelfSignedStableFingerprint(t *testing.T) {
	dir := t.TempDir()
	first, err := EnsureSelfSigned(dir, "node.example.com")
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if first.Mode != ModeSelfSigned {
		t.Errorf("mode = %q, want %q", first.Mode, ModeSelfSigned)
	}
	if !hexRE.MatchString(first.Fingerprint) {
		t.Errorf("fingerprint %q is not 64 hex chars", first.Fingerprint)
	}
	if len(first.ServerTLSConfig().Certificates) == 0 {
		t.Error("self-signed config has no certificate")
	}
	if first.ChallengeHandler() != nil {
		t.Error("self-signed mode must not have a challenge handler")
	}

	// A restart reloads the persisted pair — the pin must stay stable.
	second, err := EnsureSelfSigned(dir, "node.example.com")
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if second.Fingerprint != first.Fingerprint {
		t.Errorf("fingerprint changed across reload: %s -> %s", first.Fingerprint, second.Fingerprint)
	}
}

func TestEnsureAutocert(t *testing.T) {
	cache := filepath.Join(t.TempDir(), "acme")
	mat, err := EnsureAutocert(AutocertConfig{
		CacheDir: cache,
		FQDN:     "node.example.com",
		Email:    "ops@example.com",
	})
	if err != nil {
		t.Fatalf("EnsureAutocert: %v", err)
	}
	if mat.Mode != ModeACME {
		t.Errorf("mode = %q, want %q", mat.Mode, ModeACME)
	}
	// The fingerprint slot carries the "acme" sentinel (must match the panel's
	// daemon-client) so the panel uses the trust store instead of pinning.
	if mat.Fingerprint != "acme" {
		t.Errorf("fingerprint = %q, want the \"acme\" sentinel", mat.Fingerprint)
	}
	if mat.ChallengeHandler() == nil {
		t.Error("acme mode must expose an HTTP-01 challenge handler")
	}
	cfg := mat.ServerTLSConfig()
	if cfg == nil || cfg.GetCertificate == nil {
		t.Fatal("acme config must carry a GetCertificate callback")
	}
	if !slices.Contains(cfg.NextProtos, "acme-tls/1") {
		t.Errorf("acme config NextProtos %v missing acme-tls/1 (TLS-ALPN-01)", cfg.NextProtos)
	}
	// The cache dir is created root-only so the account key + certs stay private.
	info, err := os.Stat(cache)
	if err != nil {
		t.Fatalf("cache dir not created: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o700 {
		t.Errorf("cache dir perms = %o, want 0700", perm)
	}
}

func TestEnsureAutocertValidation(t *testing.T) {
	if _, err := EnsureAutocert(AutocertConfig{CacheDir: t.TempDir(), FQDN: ""}); err == nil {
		t.Error("expected an error for an empty FQDN")
	}
	if _, err := EnsureAutocert(AutocertConfig{CacheDir: "", FQDN: "node.example.com"}); err == nil {
		t.Error("expected an error for an empty cache dir")
	}
}
