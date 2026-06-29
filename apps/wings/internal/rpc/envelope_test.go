package rpc

import (
	"encoding/json"
	"testing"
)

// These canonical wire strings are pinned identically in the panel's TypeScript
// envelope test (packages/contract/envelope.test.ts). If the two ever diverge,
// one side's round-trip assertion fails — that's the cross-language conformance
// check. Field order here matches the Frame struct (kind, id, op, payload,
// error), which is what makes the bytes identical to JSON.stringify on the panel.
const (
	canonicalRequest = `{"kind":"req","id":"req-1","op":"createServer","payload":{"name":"mc"}}`
	canonicalResult  = `{"kind":"res","id":"req-1","payload":{"id":"srv-1"}}`
	canonicalChunk   = `{"kind":"chunk","id":"req-1","payload":{"line":"hello"}}`
	canonicalError   = `{"kind":"err","id":"req-1","error":{"code":"not_found","message":"server not found"}}`
	canonicalCancel  = `{"kind":"cancel","id":"req-1"}`
	canonicalEvent   = `{"kind":"event","op":"heartbeat","payload":{"ok":true}}`
)

func TestEncodeMatchesCanonical(t *testing.T) {
	cases := []struct {
		name  string
		build func() (Frame, error)
		want  string
	}{
		{"request", func() (Frame, error) {
			return Request("req-1", "createServer", map[string]string{"name": "mc"})
		}, canonicalRequest},
		{"result", func() (Frame, error) {
			return Result("req-1", map[string]string{"id": "srv-1"})
		}, canonicalResult},
		{"chunk", func() (Frame, error) {
			return Chunk("req-1", map[string]string{"line": "hello"})
		}, canonicalChunk},
		{"error", func() (Frame, error) {
			return Errorf("req-1", CodeNotFound, "server not found"), nil
		}, canonicalError},
		{"cancel", func() (Frame, error) { return Cancel("req-1"), nil }, canonicalCancel},
		{"event", func() (Frame, error) {
			return Event("heartbeat", map[string]bool{"ok": true})
		}, canonicalEvent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, err := tc.build()
			if err != nil {
				t.Fatalf("build: %v", err)
			}
			got, err := f.Encode()
			if err != nil {
				t.Fatalf("encode: %v", err)
			}
			if string(got) != tc.want {
				t.Fatalf("wire mismatch\n got: %s\nwant: %s", got, tc.want)
			}
		})
	}
}

func TestDecodeCanonicalRequest(t *testing.T) {
	f, err := Decode([]byte(canonicalRequest))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if f.Kind != KindRequest || f.ID != "req-1" || f.Op != "createServer" {
		t.Fatalf("unexpected header: %+v", f)
	}
	// Payload stays raw until bound into the operation's own type.
	var body struct {
		Name string `json:"name"`
	}
	if err := f.Bind(&body); err != nil {
		t.Fatalf("bind: %v", err)
	}
	if body.Name != "mc" {
		t.Fatalf("payload: got %q want %q", body.Name, "mc")
	}
}

func TestDecodeError(t *testing.T) {
	f, err := Decode([]byte(canonicalError))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if f.Err == nil || f.Err.Code != CodeNotFound {
		t.Fatalf("error frame not decoded: %+v", f)
	}
	if got := f.Err.Error(); got != "not_found: server not found" {
		t.Fatalf("Error(): got %q", got)
	}
}

func TestRoundTripPreservesNoPayload(t *testing.T) {
	// A result with no payload must omit the field, not emit null.
	f, _ := Result("req-1", nil)
	raw, err := f.Encode()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if string(raw) != `{"kind":"res","id":"req-1"}` {
		t.Fatalf("empty-payload result: %s", raw)
	}
	back, err := Decode(raw)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(back.Payload) != 0 {
		t.Fatalf("payload should be empty, got %s", back.Payload)
	}
}

func TestValidateRejectsMalformed(t *testing.T) {
	cases := map[string]string{
		"unknown kind":      `{"kind":"nope","id":"x"}`,
		"req missing op":    `{"kind":"req","id":"x"}`,
		"req missing id":    `{"kind":"req","op":"getSystem"}`,
		"err missing error": `{"kind":"err","id":"x"}`,
		"event missing op":  `{"kind":"event"}`,
		"result missing id": `{"kind":"res"}`,
	}
	for name, frame := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Decode([]byte(frame)); err == nil {
				t.Fatalf("expected Decode to reject %s", frame)
			}
		})
	}
}

func TestStreamingSequence(t *testing.T) {
	// A streaming op: req → chunk, chunk → res. Each frame carries the same id.
	const id = "req-9"
	req, _ := Request(id, "getSystemStats", nil)
	c1, _ := Chunk(id, map[string]int{"cpu": 1})
	c2, _ := Chunk(id, map[string]int{"cpu": 2})
	done, _ := Result(id, nil)

	for _, f := range []Frame{req, c1, c2, done} {
		raw, err := f.Encode()
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		back, err := Decode(raw)
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		if back.ID != id {
			t.Fatalf("id not preserved across the stream: %+v", back)
		}
	}
}

// Sanity: a frame survives a generic map round-trip (order-independent), the
// same lens the contract conformance test uses.
func TestRoundTripIsLossless(t *testing.T) {
	f, _ := Request("req-1", "createServer", map[string]any{"name": "mc", "nodeId": "n1"})
	raw, _ := f.Encode()
	var asMap map[string]any
	if err := json.Unmarshal(raw, &asMap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if asMap["kind"] != "req" || asMap["op"] != "createServer" {
		t.Fatalf("round-trip lost a field: %v", asMap)
	}
}
