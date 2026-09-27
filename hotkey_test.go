package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The keybinding has no session to offer, so its path in is a separate
// loopback-only endpoint. These are the properties that endpoint must keep:
// unreachable from the network, and unreachable from a web page.
func TestLocalBroadcastIsLoopbackOnly(t *testing.T) {
	resetAuthState()
	// Simulate a request that arrived from another device on the LAN.
	req := httptest.NewRequest(http.MethodPost, "/local/broadcast",
		strings.NewReader(`{"action":"toggle"}`))
	req.RemoteAddr = "192.168.1.77:51000"
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	handleBroadcastLocal(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("from the LAN = %d, want 403", rec.Code)
	}
}

func TestLocalBroadcastRefusesForeignOrigin(t *testing.T) {
	resetAuthState()
	for _, origin := range []string{
		"https://evil.example",
		"http://192.168.1.9:8080", // a page served by another machine on the LAN
		"http://localhost.evil.example",
	} {
		req := httptest.NewRequest(http.MethodPost, "/local/broadcast",
			strings.NewReader(`{"action":"toggle"}`))
		req.RemoteAddr = "127.0.0.1:51000"
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")

		rec := httptest.NewRecorder()
		handleBroadcastLocal(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("Origin %s = %d, want 403", origin, rec.Code)
		}
	}
}

// A browser will happily send a cross-origin form POST, which carries no custom
// headers and so is the one request that skips the preflight. Requiring JSON is
// what stops it.
func TestLocalBroadcastRefusesFormPost(t *testing.T) {
	resetAuthState()
	req := httptest.NewRequest(http.MethodPost, "/local/broadcast",
		strings.NewReader(`{"action":"toggle"}`))
	req.RemoteAddr = "127.0.0.1:51000"
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	rec := httptest.NewRecorder()
	handleBroadcastLocal(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("form post = %d, want 415", rec.Code)
	}
}

func TestLocalBroadcastRefusesBadAction(t *testing.T) {
	resetAuthState()
	for _, body := range []string{`{"action":"rm-rf"}`, `{}`, `not json`} {
		req := httptest.NewRequest(http.MethodPost, "/local/broadcast",
			strings.NewReader(body))
		req.RemoteAddr = "127.0.0.1:51000"
		req.Header.Set("Content-Type", "application/json")

		rec := httptest.NewRecorder()
		handleBroadcastLocal(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %q = %d, want 400", body, rec.Code)
		}
	}
}

func TestQuoteGSettingsArg(t *testing.T) {
	if got := quoteGSettingsArg("/home/u/.local/bin/tab-dashboard"); got != "/home/u/.local/bin/tab-dashboard" {
		t.Errorf("plain path was quoted: %q", got)
	}
	if got := quoteGSettingsArg("/home/a b/tab-dashboard"); !strings.HasPrefix(got, "'") {
		t.Errorf("a path with a space was not quoted: %q", got)
	}
}

// The binding is written to gsettings, so it must not contain a credential.
func TestHotkeyCommandCarriesNoCredential(t *testing.T) {
	cmd, err := broadcastHotkeyCommand()
	if err != nil {
		t.Fatalf("could not build the hotkey command: %v", err)
	}
	for _, bad := range []string{"token", "pin", "session", "curl", "Authorization"} {
		if strings.Contains(strings.ToLower(cmd), strings.ToLower(bad)) {
			t.Errorf("hotkey command leaks %q: %s", bad, cmd)
		}
	}
	if !strings.Contains(cmd, "--toggle-broadcast") {
		t.Errorf("hotkey command does not call the one-shot helper: %s", cmd)
	}
}
