// Package rpc defines the framing for the panel↔daemon WebSocket transport:
// a small, hand-written envelope that carries the existing OpenAPI operations
// (by their operationId) as typed JSON frames over one persistent socket.
//
// It is deliberately NOT generated from the contract spec. The spec models
// request/response *payloads*; this envelope is the meta-protocol around them
// (correlation, multiplexing, streaming, cancellation) — the same reason the
// browser console WebSocket was never modelled in OpenAPI. The payload of a
// frame is whatever the operation's contract type says; this package leaves it
// as raw JSON so the dispatcher can decode it into the op-specific struct.
//
// The wire form is mirrored byte-for-byte by the panel's TypeScript envelope
// (packages/contract/envelope.ts); the round-trip tests on both sides pin the
// identical canonical JSON, so the two can't drift.
//
// # Lifecycle
//
//   - A requester sends a `req` frame: {id, op, payload}.
//   - The responder streams zero or more `chunk` frames {id, payload}, then
//     exactly one terminal frame: `res` {id, payload?} on success, or `err`
//     {id, error} on failure. A unary op simply skips the chunks.
//   - The requester may send `cancel` {id} to abort an in-flight op; the
//     responder finishes it with `err` {id, error:{code:"canceled"}}.
//   - An `event` frame {op, payload} is unsolicited and uncorrelated (no id, no
//     response) — used for heartbeats and async notifications.
package rpc

import (
	"encoding/json"
	"fmt"
)

// ProtocolVersion is the envelope version. It is exchanged once in the
// connection handshake (not stamped on every frame); bump it on a breaking
// change to the framing.
const ProtocolVersion = 1

// Kind is the discriminant of a frame.
type Kind string

const (
	KindRequest Kind = "req"    // start an operation
	KindResult  Kind = "res"    // terminal success (unary result or end-of-stream)
	KindChunk   Kind = "chunk"  // an intermediate streaming data frame
	KindError   Kind = "err"    // terminal failure
	KindCancel  Kind = "cancel" // requester aborts an in-flight operation
	KindEvent   Kind = "event"  // unsolicited, uncorrelated push (heartbeat, …)
)

// ErrorCode is a small, transport-level error taxonomy. The panel maps these to
// its own semantics (e.g. not_found → a generic 404, canceled → a silent abort).
type ErrorCode string

const (
	CodeBadRequest  ErrorCode = "bad_request"
	CodeNotFound    ErrorCode = "not_found"
	CodeUnsupported ErrorCode = "unsupported"
	CodeTimeout     ErrorCode = "timeout"
	CodeCanceled    ErrorCode = "canceled"
	CodeInternal    ErrorCode = "internal"
)

// Error is the payload of an `err` frame. It implements the error interface so a
// decoded failure can be returned directly.
type Error struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
}

func (e *Error) Error() string {
	if e == nil {
		return "<nil rpc error>"
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// Frame is one envelope on the wire. Field order is significant: it fixes the
// canonical JSON shape (kind, id, op, payload, error) the TypeScript side
// mirrors. Payload stays raw so the dispatcher decodes it into the op's own type
// with Bind — there is no central union over all 86 operations.
type Frame struct {
	Kind    Kind            `json:"kind"`
	ID      string          `json:"id,omitempty"`
	Op      string          `json:"op,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Err     *Error          `json:"error,omitempty"`
}

// Bind decodes the frame's payload into v (a pointer). A frame with no payload
// leaves v untouched and returns nil.
func (f Frame) Bind(v any) error {
	if len(f.Payload) == 0 {
		return nil
	}
	return json.Unmarshal(f.Payload, v)
}

// Validate checks the structural invariants for the frame's kind. Decode runs it
// for every inbound frame so a malformed message is rejected before dispatch.
func (f Frame) Validate() error {
	switch f.Kind {
	case KindRequest:
		if f.ID == "" || f.Op == "" {
			return fmt.Errorf("rpc: %q frame requires id and op", f.Kind)
		}
	case KindResult, KindChunk, KindCancel:
		if f.ID == "" {
			return fmt.Errorf("rpc: %q frame requires id", f.Kind)
		}
	case KindError:
		if f.ID == "" || f.Err == nil {
			return fmt.Errorf("rpc: %q frame requires id and error", f.Kind)
		}
	case KindEvent:
		if f.Op == "" {
			return fmt.Errorf("rpc: %q frame requires op", f.Kind)
		}
	default:
		return fmt.Errorf("rpc: unknown frame kind %q", f.Kind)
	}
	return nil
}

// Encode marshals the frame to its wire bytes.
func (f Frame) Encode() ([]byte, error) {
	return json.Marshal(f)
}

// Decode parses and validates a frame off the wire.
func Decode(data []byte) (Frame, error) {
	var f Frame
	if err := json.Unmarshal(data, &f); err != nil {
		return Frame{}, fmt.Errorf("rpc: decode frame: %w", err)
	}
	if err := f.Validate(); err != nil {
		return Frame{}, err
	}
	return f, nil
}

// marshalPayload turns an operation payload into raw JSON, treating a nil
// payload as "no payload" (omitted on the wire).
func marshalPayload(payload any) (json.RawMessage, error) {
	if payload == nil {
		return nil, nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("rpc: marshal payload: %w", err)
	}
	return raw, nil
}

// Request builds a `req` frame for op, correlated by id, carrying payload.
func Request(id, op string, payload any) (Frame, error) {
	raw, err := marshalPayload(payload)
	if err != nil {
		return Frame{}, err
	}
	return Frame{Kind: KindRequest, ID: id, Op: op, Payload: raw}, nil
}

// Result builds the terminal `res` frame for the operation id.
func Result(id string, payload any) (Frame, error) {
	raw, err := marshalPayload(payload)
	if err != nil {
		return Frame{}, err
	}
	return Frame{Kind: KindResult, ID: id, Payload: raw}, nil
}

// Chunk builds an intermediate `chunk` frame for a streaming operation.
func Chunk(id string, payload any) (Frame, error) {
	raw, err := marshalPayload(payload)
	if err != nil {
		return Frame{}, err
	}
	return Frame{Kind: KindChunk, ID: id, Payload: raw}, nil
}

// Event builds an unsolicited, uncorrelated `event` frame for op.
func Event(op string, payload any) (Frame, error) {
	raw, err := marshalPayload(payload)
	if err != nil {
		return Frame{}, err
	}
	return Frame{Kind: KindEvent, Op: op, Payload: raw}, nil
}

// Errorf builds the terminal `err` frame for the operation id.
func Errorf(id string, code ErrorCode, format string, args ...any) Frame {
	return Frame{
		Kind: KindError,
		ID:   id,
		Err:  &Error{Code: code, Message: fmt.Sprintf(format, args...)},
	}
}

// Cancel builds a `cancel` frame for an in-flight operation id.
func Cancel(id string) Frame {
	return Frame{Kind: KindCancel, ID: id}
}
