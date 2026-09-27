package main

import "testing"

// The share URL comes from MPRIS metadata, which any media file on the machine
// can set, and it was passed as a bare argument with no `--` separator - so a
// value starting with `--` became an option to gjs or kdeconnect-cli (SUS-005).
// It is also handed to window.open, where a `javascript:` value would be
// executed (SUS-006).
func TestHandoffShareableURL(t *testing.T) {
	ok := []string{
		"https://www.youtube.com/watch?v=abc123",
		"http://127.0.0.1:8080/some/path",
		"HTTPS://EXAMPLE.COM/Track",
		"  https://example.com/x  ",
	}
	for _, u := range ok {
		got, err := handoffShareableURL(u)
		if err != nil {
			t.Errorf("handoffShareableURL(%q) = %v, want accepted", u, err)
			continue
		}
		if got != trimSpace(u) {
			t.Errorf("handoffShareableURL(%q) = %q, want the trimmed value", u, got)
		}
	}

	bad := []string{
		"",
		"   ",
		// Would have been read as a flag without the separator.
		"--device",
		"--help",
		// Executable schemes.
		"javascript:alert(1)",
		"JavaScript:alert(document.cookie)",
		"data:text/html,<script>alert(1)</script>",
		"file:///etc/passwd",
		"vbscript:msgbox(1)",
		// No host.
		"https://",
		"http://",
		// Not a URL at all.
		"not a url at all",
	}
	for _, u := range bad {
		if got, err := handoffShareableURL(u); err == nil {
			t.Errorf("handoffShareableURL(%q) = %q, want an error", u, got)
		}
	}
}

func trimSpace(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n') {
		end--
	}
	return s[start:end]
}

// req.Player reaches the host from POST /api/command, so it is client-supplied
// and was interpolated into a gdbus --dest value.
func TestPlayerNameIsSane(t *testing.T) {
	ok := []string{
		"mpv", "vlc", "chromium.instance1", "spotify",
		"org.mpris.MediaPlayer2.firefox", "player_1", "a-b.c", "user@host",
	}
	for _, n := range ok {
		if !playerNameIsSane(n) {
			t.Errorf("playerNameIsSane(%q) = false, want true", n)
		}
	}

	bad := []string{
		"",
		"--dest=org.bluez",
		"-v",
		"--",
		"has space",
		"semi;colon",
		"pipe|to|shell",
		"$(whoami)",
		"`id`",
		"new\nline",
		"tab\there",
		"quote'and\"quote",
		"../escape",
	}
	for _, n := range bad {
		if playerNameIsSane(n) {
			t.Errorf("playerNameIsSane(%q) = true, want false", n)
		}
	}

	long := make([]byte, 129)
	for i := range long {
		long[i] = 'a'
	}
	if playerNameIsSane(string(long)) {
		t.Error("a 129-character player name was accepted")
	}
}
