package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// BUG-001: two goroutines signalled on the same channel, and closing a PTY was
// enough to make both reach close(done) - "panic: close of closed channel",
// which took down the entire dashboard (SSE, the audio WebSocket, the hotkey
// endpoint, every connected client). Reproduced live before the fix: a single
// abandoned WebSocket killed the server.
func TestTerminalWSConcurrentTeardownDoesNotPanic(t *testing.T) {
	enableFeatureForTest(t, FeatureTerminal, true)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/terminal", func(w http.ResponseWriter, r *http.Request) {
		if !validSession(tokenFromRequest(r)) {
			http.Error(w, "locked", http.StatusUnauthorized)
			return
		}
		handleTerminalWS(w, r)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	tok := newSessionToken("dashboard")
	wsBase := "ws" + strings.TrimPrefix(srv.URL, "http")

	// Each iteration opens a shell, lets it produce output, then drops the
	// socket mid-stream. Both the PTY reader and the WebSocket reader will
	// notice at almost the same moment, which is what used to race.
	const rounds = 12
	var wg sync.WaitGroup
	for i := 0; i < rounds; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			url := wsBase + "/ws/terminal?token=" + tok
			conn, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{
				HTTPHeader: http.Header{"Origin": []string{srv.URL}},
			})
			if err != nil {
				return // refused for an unrelated reason; not this test's concern
			}
			// Let the shell emit a prompt so the PTY reader is genuinely running.
			time.Sleep(time.Duration(20+i*8) * time.Millisecond)
			conn.Close(websocket.StatusNormalClosure, "abandoned")
		}(i)
	}
	wg.Wait()

	// Give any panicking goroutine time to take the process down, then prove
	// the handler is still serving.
	time.Sleep(500 * time.Millisecond)

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/ws/terminal?token="+tok, nil)
	req.Header.Set("Origin", srv.URL)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("handler stopped serving after the storm: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		t.Fatal("session token unexpectedly rejected")
	}
	// A plain GET is not a WebSocket handshake, so any non-401 status proves the
	// route is alive and the process survived.
	if resp.StatusCode == 500 {
		t.Fatalf("handler returned 500 after the storm: %s", resp.Status)
	}
}

// The app config is an atomic pointer that is nil until initConfig runs, so a
// test has to install a snapshot the way config_test.go does.
func enableFeatureForTest(t *testing.T, key string, on bool) {
	t.Helper()
	prev := appCfg.Load()
	cfg := &Config{Features: map[string]bool{}}
	if prev != nil {
		*cfg = *prev
	}
	// Copy rather than alias, and never leave it nil: another test may have
	// stored a Config with no Features map at all.
	cfg.Features = map[string]bool{}
	if prev != nil {
		for k, v := range prev.Features {
			cfg.Features[k] = v
		}
	}
	cfg.Features[key] = on
	appCfg.Store(cfg)
	t.Cleanup(func() { appCfg.Store(prev) })
}
