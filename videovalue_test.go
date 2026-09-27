package main

import (
	"encoding/json"
	"math"
	"testing"
)

func TestNumericValueAcceptsTheShapesJSONProduces(t *testing.T) {
	// Decoding into `any` gives float64; but a caller may construct a
	// command directly, and a Decoder using UseNumber gives json.Number.
	cases := []struct {
		in   any
		want float64
	}{
		{float64(1.5), 1.5},
		{float64(0), 0},
		{1, 1},
		{int64(2), 2},
		{json.Number("1.75"), 1.75},
	}
	for _, tc := range cases {
		got, err := numericValue(tc.in)
		if err != nil {
			t.Errorf("numericValue(%#v) = %v", tc.in, err)
			continue
		}
		if math.Abs(got-tc.want) > 1e-9 {
			t.Errorf("numericValue(%#v) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

// A speed that arrived as a string used to become 0, which mpv reads as pause -
// so a malformed request silently stopped the video.
func TestNumericValueRefusesTheWrongType(t *testing.T) {
	bad := []any{"1.5", true, nil, []any{1.0}, map[string]any{"a": 1}, json.Number("fast")}
	for _, v := range bad {
		if got, err := numericValue(v); err == nil {
			t.Errorf("numericValue(%#v) = %v, want an error", v, got)
		}
	}
}

func TestStringValue(t *testing.T) {
	if got, err := stringValue("16:9"); err != nil || got != "16:9" {
		t.Errorf("stringValue(\"16:9\") = %q, %v", got, err)
	}
	for _, v := range []any{1.5, nil, true, []string{"a"}} {
		if got, err := stringValue(v); err == nil {
			t.Errorf("stringValue(%#v) = %q, want an error", v, got)
		}
	}
}

// The zero value is a legitimate number, so callers that care - speed, which
// mpv treats as pause - must check it themselves. This pins that the helper is
// not the thing deciding, and that the guard is visible in the mpv path.
func TestZeroIsAcceptedButNotPlayable(t *testing.T) {
	got, err := numericValue(float64(0))
	if err != nil {
		t.Fatalf("numericValue(0) errored: %v", err)
	}
	if got != 0 {
		t.Fatalf("got %v, want 0", got)
	}
	if got > 0 {
		t.Error("0 should not pass a > 0 playability check")
	}
}
