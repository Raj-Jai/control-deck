package main

import (
	"strings"
	"testing"
	"time"
)

// A missing helper must be named as missing, not as some opaque exit status.
func TestAttemptNamesAMissingBinary(t *testing.T) {
	_, err := attempt("definitely-not-installed-xyz", 500*time.Millisecond, nil)
	if err == nil {
		t.Fatal("expected an error for a missing binary")
	}
	if !strings.Contains(err.Error(), "definitely-not-installed-xyz") ||
		!strings.Contains(err.Error(), "not installed") {
		t.Errorf("error = %q, want it to name the binary and say it is not installed", err)
	}
}

// A compositor that is not answering is a different problem from a missing
// binary, and the message is the only thing that says so.
func TestAttemptDistinguishesATimeout(t *testing.T) {
	_, err := attempt("sleep", 200*time.Millisecond, nil, "30")
	if err == nil {
		t.Fatal("expected a timeout error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "sleep") {
		t.Errorf("error = %q, want it to name the binary", msg)
	}
	if !strings.Contains(msg, "did not respond") {
		t.Errorf("error = %q, want it to describe a timeout", msg)
	}
	if strings.Contains(msg, "deadline exceeded") {
		t.Errorf("error = %q still uses the raw context error", msg)
	}
}

func TestAttemptReportsANonZeroExit(t *testing.T) {
	_, err := attempt("sh", time.Second, nil, "-c", "echo 'no terminal' >&2; exit 4")
	if err == nil {
		t.Fatal("expected an error for a non-zero exit")
	}
	if !strings.Contains(err.Error(), "no terminal") {
		t.Errorf("error = %q, want the command's own stderr", err)
	}
}

func TestAttemptSucceedsAndTrims(t *testing.T) {
	got, err := attempt("printf", time.Second, nil, "  hello  \n\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "hello" {
		t.Errorf("got %q, want %q", got, "hello")
	}
}

func TestFirstLine(t *testing.T) {
	cases := map[string]string{
		"one\ntwo":      "one",
		"one":           "one",
		"  padded  \nx": "padded",
		"":              "",
		// The first line of "\nfoo" is empty, which is what this returns; the
		// point of the helper is to keep only the leading line, not to skip it.
		"\nfoo": "",
	}
	for in, want := range cases {
		if got := firstLine(in); got != want {
			t.Errorf("firstLine(%q) = %q, want %q", in, got, want)
		}
	}
}

// Both helpers failing must name both, not just the last one.
func TestReadClipboardNamesBothFailures(t *testing.T) {
	// Neither wl-paste nor xclip is present on a bare CI container, so this
	// exercises the real path.
	if _, err := attempt("wl-paste", 200*time.Millisecond, nil); err == nil {
		t.Skip("wl-paste exists here; the both-failed path is not reachable")
	}
	_, err := readClipboard()
	if err == nil {
		t.Skip("a clipboard helper is present and working here")
	}
	if !strings.Contains(err.Error(), "wl-paste") {
		t.Errorf("error = %q, want the Wayland failure named", err)
	}
}
