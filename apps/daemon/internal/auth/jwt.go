// Package auth verifies the short-lived, server-scoped JWT browser WebSocket
// clients present for the console. The panel mints these (HS256 over the per-node
// signing secret); the daemon verifies them locally, so each frame costs no
// round-trip back to the panel.
package auth

import (
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

// BrowserClaims is the payload the panel mints into the JWT. serverId + nodeId
// are required; the verifier rejects a token that omits either.
type BrowserClaims struct {
	ServerID    string   `json:"serverId"`
	NodeID      string   `json:"nodeId"`
	Permissions []string `json:"permissions"`
	jwt.RegisteredClaims
}

// VerifyBrowserToken parses tokenStr, validates the signature against
// signingSecret, and checks expiry. Allowed signing alg is **HS256 only** —
// rejecting "none"/RS* closes the typical JWT misuse cases.
func VerifyBrowserToken(tokenStr, signingSecret string) (*BrowserClaims, error) {
	if signingSecret == "" {
		return nil, errors.New("auth: signing secret is empty")
	}
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
	)
	claims := &BrowserClaims{}
	tok, err := parser.ParseWithClaims(
		tokenStr,
		claims,
		func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
			}
			return []byte(signingSecret), nil
		},
	)
	if err != nil {
		return nil, fmt.Errorf("verify token: %w", err)
	}
	if !tok.Valid {
		return nil, errors.New("verify token: not valid")
	}
	if claims.ServerID == "" || claims.NodeID == "" {
		return nil, errors.New("verify token: missing serverId or nodeId")
	}
	return claims, nil
}
