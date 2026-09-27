package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAcceptsGzip(t *testing.T) {
	cases := map[string]bool{
		"gzip":                true,
		"gzip, deflate, br":   true,
		"deflate":             false,
		"br":                  false,
		"":                    false,
		"GZIP":                true,
		"gzip;q=0.5, *;q=0.1": true,
		"identity":            false,
	}
	for header, want := range cases {
		if got := acceptsGzip(header); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
		}
	}
}

func TestCompressible(t *testing.T) {
	cases := []struct {
		ct   string
		want bool
	}{
		{"", true},
		{"text/html; charset=utf-8", true},
		{"application/javascript", true},
		{"application/json", true},
		{"image/png", false},
		{"image/svg+xml", true},
		{"font/woff2", false},
	}
	for _, tc := range cases {
		h := http.Header{}
		if tc.ct != "" {
			h.Set("Content-Type", tc.ct)
		}
		if got := compressible(h); got != tc.want {
			t.Errorf("compressible(%q) = %v, want %v", tc.ct, got, tc.want)
		}
	}
}

// The bundle is 640 kB and was pulled uncompressed on every load.
func TestCompressHandlerGzipsText(t *testing.T) {
	payload := strings.Repeat("const answer = 42; ", 4000)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		io.WriteString(w, payload)
	})
	h := compressHandler(inner)

	// Without the header: passed through untouched.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/x.js", nil))
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("no Accept-Encoding but Content-Encoding = %q", got)
	}
	if rec.Body.Len() != len(payload) {
		t.Errorf("uncompressed body length = %d, want %d", rec.Body.Len(), len(payload))
	}

	// With it: gzipped, and substantially smaller.
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/static/x.js", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate")
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if rec.Body.Len() >= len(payload)/2 {
		t.Errorf("gzipped %d bytes from %d - barely smaller", rec.Body.Len(), len(payload))
	}
}

// An event stream must not be buffered: SSE relies on per-write flushes.
func TestCompressHandlerSkipsEventStream(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: {}\n\n")
	})
	h := compressHandler(inner)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/media-stream", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("event stream was compressed (Content-Encoding %q)", got)
	}
	if !strings.Contains(rec.Body.String(), "data:") {
		t.Errorf("event stream body = %q", rec.Body.String())
	}
}

func TestPlayerListIsCached(t *testing.T) {
	playerListMu.Lock()
	playerListCache = nil
	playerListAt = time.Time{}
	playerListMu.Unlock()

	first := listPlayers()
	// A second call inside the TTL must not have re-spawned playerctl: if it
	// had, the cache timestamp would have moved.
	playerListMu.Lock()
	at := playerListAt
	playerListMu.Unlock()
	_ = listPlayers()
	playerListMu.Lock()
	after := playerListAt
	playerListMu.Unlock()

	if !after.Equal(at) {
		t.Errorf("listPlayers re-ran inside the %s TTL", playerListTTL)
	}
	if first == nil {
		t.Log("no playerctl on this host; the cache mechanics are what is under test")
	}
}

// Wrapping the ResponseWriter removed http.Hijacker, so every WebSocket
// handshake failed with 501 Not Implemented.
func TestCompressHandlerPassesThroughWebSocketUpgrade(t *testing.T) {
	// httptest.ResponseRecorder is not an http.Hijacker, so what matters is
	// that the handler receives the original writer rather than the gzip
	// wrapper, and that no Content-Encoding was set on the way.
	var gotWriter http.ResponseWriter
	h := compressHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotWriter = w
		w.WriteHeader(http.StatusSwitchingProtocols)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ws/terminal", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Accept-Encoding", "gzip")
	h.ServeHTTP(rec, req)

	if gotWriter == nil {
		t.Fatal("the wrapped handler was never reached")
	}
	if _, wrapped := gotWriter.(*gzipResponseWriter); wrapped {
		t.Error("the upgrade handler got the gzip wrapper, which cannot hijack")
	}
	if enc := rec.Header().Get("Content-Encoding"); enc != "" {
		t.Errorf("upgrade response was compressed (Content-Encoding %q)", enc)
	}
	if rec.Code != http.StatusSwitchingProtocols {
		t.Errorf("status = %d, want 101", rec.Code)
	}
}
