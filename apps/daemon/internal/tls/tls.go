// Package tls provisions and serves the daemon's panel-facing API certificate, in
// one of two modes:
//
//   - self-signed (default): a persisted keypair whose SHA-256 leaf fingerprint
//     the panel pins (reported on every heartbeat). The cert is regenerated only
//     when missing or corrupt, so the fingerprint stays stable across restarts and
//     the panel never has to re-pin.
//   - ACME (Let's Encrypt): a publicly-trusted cert for the box's FQDN, obtained +
//     auto-renewed via autocert. There's nothing stable to pin, so the daemon
//     reports an "acme" sentinel and the panel verifies against the system trust
//     store. A publicly-trusted cert is also what lets the browser console connect
//     straight to the daemon (browsers can't pin a self-signed leaf).
package tls

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	cryptotls "crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

const (
	certFile     = "cert.pem"
	keyFile      = "key.pem"
	certValidity = 10 * 365 * 24 * time.Hour

	// ModeSelfSigned is the default TLS strategy (panel pins the leaf).
	ModeSelfSigned = "self-signed"
	// ModeACME serves a publicly-trusted Let's Encrypt cert for the FQDN.
	ModeACME = "acme"
	// ACMEFingerprint is the sentinel the daemon reports in the fingerprint slot
	// in ACME mode, telling the panel to use the system trust store, not a pin.
	// Must match the panel's daemon-client ACME sentinel.
	ACMEFingerprint = ModeACME
)

// Material is the daemon's serving TLS strategy. ServerTLSConfig is what the API
// listener serves; Fingerprint is what the daemon advertises to the panel on
// heartbeat (the self-signed leaf's hash, or the "acme" sentinel).
type Material struct {
	// Fingerprint is the SHA-256 of the self-signed leaf's DER (lower-case hex),
	// or ACMEFingerprint when Mode is ModeACME.
	Fingerprint string
	// Mode is ModeSelfSigned or ModeACME.
	Mode string

	tlsConfig *cryptotls.Config
	challenge http.Handler // ACME HTTP-01 responder; nil for self-signed
}

// ServerTLSConfig returns the *tls.Config the API listener should serve.
func (m *Material) ServerTLSConfig() *cryptotls.Config { return m.tlsConfig }

// ChallengeHandler is the ACME HTTP-01 responder to serve on :80, or nil in
// self-signed mode (no challenge to answer).
func (m *Material) ChallengeHandler() http.Handler { return m.challenge }

// AutocertConfig configures ACME issuance for a single FQDN.
type AutocertConfig struct {
	// CacheDir persists issued certs + the ACME account key across restarts
	// (created 0700). Without it every restart re-issues and hits rate limits.
	CacheDir string
	// FQDN is the one hostname the cert is issued for (the host allow-list).
	FQDN string
	// Email is the optional ACME account contact (renewal/expiry notices).
	Email string
}

// EnsureAutocert returns Material backed by Let's Encrypt for the FQDN. Issuance
// is lazy: autocert fetches (and later renews) the cert on the first TLS
// handshake for the host, answering the HTTP-01 challenge via ChallengeHandler on
// :80 (or TLS-ALPN-01 on the API listener). Reports the "acme" sentinel.
func EnsureAutocert(c AutocertConfig) (*Material, error) {
	if c.FQDN == "" {
		return nil, fmt.Errorf("tls: fqdn is required for acme")
	}
	if c.CacheDir == "" {
		return nil, fmt.Errorf("tls: cache dir is required for acme")
	}
	if err := os.MkdirAll(c.CacheDir, 0o700); err != nil {
		return nil, fmt.Errorf("create acme cache dir: %w", err)
	}
	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(c.FQDN),
		Cache:      autocert.DirCache(c.CacheDir),
		Email:      c.Email,
	}
	cfg := m.TLSConfig() // sets GetCertificate + NextProtos (incl. acme-tls/1)
	cfg.MinVersion = cryptotls.VersionTLS12
	return &Material{
		Fingerprint: ACMEFingerprint,
		Mode:        ModeACME,
		tlsConfig:   cfg,
		challenge:   m.HTTPHandler(nil),
	}, nil
}

// EnsureSelfSigned returns the persisted self-signed cert under dir, generating
// it on first call. Idempotent: a restart loads the existing PEM pair, so the
// fingerprint stays stable. The cert is valid for fqdn plus localhost and
// 127.0.0.1/::1, so dev/test dialers that don't use the FQDN still match the SANs.
func EnsureSelfSigned(dir, fqdn string) (*Material, error) {
	if fqdn == "" {
		return nil, fmt.Errorf("tls: fqdn is required to generate the cert")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create tls dir: %w", err)
	}
	certPath := filepath.Join(dir, certFile)
	keyPath := filepath.Join(dir, keyFile)

	if _, err := os.Stat(certPath); err == nil {
		if mat, err := load(certPath, keyPath); err == nil {
			return mat, nil
		}
		// Fall through and regenerate on parse errors (corrupt pair).
	}

	cert, err := mint(fqdn)
	if err != nil {
		return nil, err
	}
	if err := writePEM(certPath, "CERTIFICATE", cert.Certificate[0], 0o644); err != nil {
		return nil, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(cert.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("marshal key: %w", err)
	}
	if err := writePEM(keyPath, "PRIVATE KEY", keyDER, 0o600); err != nil {
		return nil, err
	}
	return materialize(cert)
}

func mint(fqdn string) (cryptotls.Certificate, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return cryptotls.Certificate{}, fmt.Errorf("ecdsa keygen: %w", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return cryptotls.Certificate{}, fmt.Errorf("serial: %w", err)
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: fqdn, Organization: []string{"CookiePanel"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(certValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              dnsSANs(fqdn),
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		return cryptotls.Certificate{}, fmt.Errorf("create cert: %w", err)
	}
	return cryptotls.Certificate{Certificate: [][]byte{derBytes}, PrivateKey: priv}, nil
}

func dnsSANs(fqdn string) []string {
	out := []string{fqdn}
	if !strings.EqualFold(fqdn, "localhost") {
		out = append(out, "localhost")
	}
	return out
}

func load(certPath, keyPath string) (*Material, error) {
	pair, err := cryptotls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("load keypair: %w", err)
	}
	return materialize(pair)
}

func materialize(cert cryptotls.Certificate) (*Material, error) {
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return nil, fmt.Errorf("parse leaf: %w", err)
	}
	cert.Leaf = leaf
	return &Material{
		Fingerprint: FingerprintDER(cert.Certificate[0]),
		Mode:        ModeSelfSigned,
		tlsConfig: &cryptotls.Config{
			Certificates: []cryptotls.Certificate{cert},
			MinVersion:   cryptotls.VersionTLS12,
		},
	}, nil
}

// FingerprintDER returns the SHA-256 of the certificate's DER encoding as a
// lower-case hex string — the format the panel pins against the leaf it sees.
func FingerprintDER(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}

func writePEM(path, typ string, der []byte, mode os.FileMode) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	return pem.Encode(f, &pem.Block{Type: typ, Bytes: der})
}
