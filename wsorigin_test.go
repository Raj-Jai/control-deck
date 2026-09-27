package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// /ws/terminal accepted any Origin: the audit got 101 Switching Protocols and a
// $SHELL PTY from "Origin: https://evil.example".
func TestSameOriginRejectsForeignOrigin(t *testing.T) {
	cases := []struct {
		name   string
		host   string
		origin string
		want   bool
	}{
		{"no origin (non-browser client)", "192.168.1.5:8080", "", true},
		{"same host over http", "192.168.1.5:8080", "http://192.168.1.5:8080", true},
		{"same host over https", "192.168.1.5:8443", "https://192.168.1.5:8443", true},
		{"case-insensitive host", "192.168.1.5:8080", "http://192.168.1.5:8080", true},
		{"foreign host", "192.168.1.5:8080", "https://evil.example", false},
		{"foreign port on same ip", "192.168.1.5:8080", "http://192.168.1.5:9999", false},
		{"localhost", "localhost:8080", "http://localhost:8080", true},
		{"null origin", "192.168.1.5:8080", "null", false},
		{"garbage", "192.168.1.5:8080", "not a url", false},
		{"scheme mismatch is allowed: same host, either scheme", "192.168.1.5:8080", "https://192.168.1.5:8080", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "http://"+tc.host+"/ws/terminal", nil)
			r.Host = tc.host
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if got := sameOrigin(r); got != tc.want {
				t.Errorf("sameOrigin(origin=%q host=%q) = %v, want %v",
					tc.origin, tc.host, got, tc.want)
			}
		})
	}
}

// A rejected handshake must be a 403, never a 101.
func TestAcceptWebSocketRefusesForeignOrigin(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "http://192.168.1.5:8080/ws/terminal", nil)
	r.Host = "192.168.1.5:8080"
	r.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()

	conn, err := acceptWebSocket(rec, r, "test")
	if err == nil {
		t.Fatal("expected the handshake to be refused")
	}
	if conn != nil {
		t.Error("no connection should be returned for a foreign origin")
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 (a 101 would hand over a shell)", rec.Code)
	}
	if got := rec.Header().Get("Sec-Websocket-Accept"); got != "" {
		t.Error("a refused handshake must not include an upgrade token")
	}
}

func TestOriginPatternUsesRequestHost(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "http://192.168.1.5:8080/ws/terminal", nil)
	r.Host = "192.168.1.5:8080"
	if got := originPattern(r); got != "http://192.168.1.5:8080" {
		t.Errorf("originPattern = %q, want http://192.168.1.5:8080", got)
	}

	// A spoofed X-Forwarded-Host must not change the identity.
	r.Header.Set("X-Forwarded-Host", "evil.example")
	if got := originPattern(r); got != "http://192.168.1.5:8080" {
		t.Errorf("originPattern after X-Forwarded-Host = %q, want the real host", got)
	}
}
