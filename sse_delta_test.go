package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func fieldsOf(t *testing.T, s string) map[string]json.RawMessage {
	t.Helper()
	var f map[string]json.RawMessage
	if err := json.Unmarshal([]byte(s), &f); err != nil {
		t.Fatalf("unmarshal %q: %v", s, err)
	}
	return f
}

// The first frame a client sees must be whole: it has no base to apply a
// delta to.
func TestFirstFrameIsAlwaysFull(t *testing.T) {
	state := json.RawMessage(`{"a":1,"b":"x"}`)
	event, payload := marshalDelta(1, nil, state)
	if event != sseFullFrameEvent {
		t.Errorf("event = %q, want %q", event, sseFullFrameEvent)
	}
	if !strings.Contains(payload, `"a"`) || !strings.Contains(payload, `"b"`) {
		t.Errorf("payload = %q, want the whole state", payload)
	}
}

// A frame that repeats itself sends nothing at all - the client already has it.
func TestUnchangedFrameSendsNothing(t *testing.T) {
	state := json.RawMessage(`{"pos":1,"title":"t"}`)
	prev := fieldsOf(t, string(state))
	if event, payload := marshalDelta(2, prev, state); event != "" || payload != "" {
		t.Errorf("got %q/%q, want nothing sent", event, payload)
	}
}

// A small change must go out as a delta naming only what moved.
func TestSmallChangeBecomesADelta(t *testing.T) {
	prev := fieldsOf(t, `{"pos":1,"title":"t","artist":"a","vol":50}`)
	event, payload := marshalDelta(2, prev, json.RawMessage(`{"pos":2,"title":"t","artist":"a","vol":50}`))
	if event != "delta" {
		t.Fatalf("event = %q, want delta", event)
	}
	var d struct {
		O int                        `json:"o"`
		P map[string]json.RawMessage `json:"p"`
	}
	if err := json.Unmarshal([]byte(payload), &d); err != nil {
		t.Fatalf("unmarshal delta: %v", err)
	}
	if d.O != 2 {
		t.Errorf("ordinal = %d, want 2", d.O)
	}
	if len(d.P) != 1 {
		t.Fatalf("patch has %d entries, want just the changed one: %s", len(d.P), payload)
	}
	if string(d.P["pos"]) != "2" {
		t.Errorf("pos = %s, want 2", d.P["pos"])
	}
}

// A key that disappears has to be visible to the client. JSON cannot say
// "unset" by omission - omission is how a delta says "unchanged" - so it goes
// out as an explicit null, and such a frame is sent whole rather than risking a
// client that misses it.
func TestRemovedKeyForcesAFullFrame(t *testing.T) {
	prev := fieldsOf(t, `{"pos":1,"title":"t"}`)
	event, payload := marshalDelta(2, prev, json.RawMessage(`{"pos":1}`))
	if event != sseFullFrameEvent {
		t.Errorf("event = %q, want a full frame when a key disappears", event)
	}
	if strings.Contains(payload, "title") {
		t.Errorf("payload = %q, want the removed key gone", payload)
	}
}

func TestSseDeltaMerge(t *testing.T) {
	prev := map[string]json.RawMessage{
		"a": json.RawMessage("1"),
		"b": json.RawMessage(`"keep"`),
	}
	patch := map[string]json.RawMessage{
		"a": json.RawMessage("2"),
		"c": json.RawMessage("3"),
	}
	got := sseDelta(prev, patch)
	if string(got["a"]) != "2" {
		t.Errorf("a = %s, want 2", got["a"])
	}
	if string(got["b"]) != `"keep"` {
		t.Errorf("b = %s, want it untouched", got["b"])
	}
	if string(got["c"]) != "3" {
		t.Errorf("c = %s, want 3", got["c"])
	}
	// The input must not be mutated: the caller keeps the previous base.
	if string(prev["a"]) != "1" {
		t.Errorf("prev was mutated: a = %s", prev["a"])
	}
}

func TestSseDeltaNullClearsAKey(t *testing.T) {
	prev := map[string]json.RawMessage{
		"a": json.RawMessage("1"),
		"b": json.RawMessage("2"),
	}
	got := sseDelta(prev, map[string]json.RawMessage{"a": json.RawMessage("null")})
	if _, still := got["a"]; still {
		t.Error("an explicit null did not clear the key")
	}
	if string(got["b"]) != "2" {
		t.Errorf("b = %s, want it untouched", got["b"])
	}
}

// When describing the change would not be smaller than sending the frame, send
// the frame: the bookkeeping is not free either.
func TestLargeChangeFallsBackToFull(t *testing.T) {
	prev := fieldsOf(t, `{"a":"`+strings.Repeat("x", 200)+`"}`)
	state := json.RawMessage(`{"a":"` + strings.Repeat("y", 200) + `"}`)
	event, payload := marshalDelta(2, prev, state)
	if event != sseFullFrameEvent {
		t.Errorf("event = %q, want a full frame for a change this large", event)
	}
	if !strings.Contains(payload, strings.Repeat("y", 200)) {
		t.Error("the full frame does not carry the new value")
	}
}

// A long run of frames: the deltas must reconstruct the same state as the full
// frames would have.
func TestDeltaRunReconstructsTheSameState(t *testing.T) {
	type frame struct {
		pos    int
		title  string
		artist string
		vol    int
	}
	frames := []frame{
		{1, "one", "a", 50},
		{2, "one", "a", 50},
		{3, "one", "a", 50},
		{3, "one", "a", 60},
		{3, "two", "a", 60},
		{3, "two", "a", 60},
		{9, "two", "a", 60},
	}

	var reconstructed map[string]any
	base := map[string]json.RawMessage(nil)
	ordinal := 0
	fullBytes, deltaBytes := 0, 0

	for i, f := range frames {
		raw, _ := json.Marshal(map[string]any{
			"pos": f.pos, "title": f.title, "artist": f.artist, "vol": f.vol,
		})
		ordinal++
		event, payload := marshalDelta(ordinal, base, json.RawMessage(raw))
		if payload == "" {
			continue
		}

		if event == sseFullFrameEvent {
			fullBytes += len(payload)
			_ = json.Unmarshal([]byte(payload), &reconstructed)
			base = fieldsOf(t, payload)
		} else {
			deltaBytes += len(payload)
			var d struct {
				O int                        `json:"o"`
				P map[string]json.RawMessage `json:"p"`
			}
			if err := json.Unmarshal([]byte(payload), &d); err != nil {
				t.Fatalf("frame %d: %v", i, err)
			}
			if d.O != ordinal {
				t.Errorf("frame %d: ordinal = %d, want %d", i, d.O, ordinal)
			}
			merged := sseDelta(base, d.P)
			encoded, _ := json.Marshal(merged)
			_ = json.Unmarshal(encoded, &reconstructed)
			base = merged
		}

		want := map[string]any{
			"pos": float64(f.pos), "title": f.title, "artist": f.artist, "vol": float64(f.vol),
		}
		for k, v := range want {
			if reconstructed[k] != v {
				t.Fatalf("frame %d: %s = %v, want %v (state %v)", i, k, reconstructed[k], v, reconstructed)
			}
		}
	}

	allFull := 0
	for _, f := range frames {
		raw, _ := json.Marshal(map[string]any{
			"pos": f.pos, "title": f.title, "artist": f.artist, "vol": f.vol,
		})
		allFull += len(raw)
	}
	sent := fullBytes + deltaBytes
	if sent >= allFull {
		t.Errorf("sent %d bytes for 7 frames; sending them whole would be %d", sent, allFull)
	}
	t.Logf("7 frames: %d bytes with deltas, %d whole, %d skipped", sent, fullBytes, deltaBytes)
}
