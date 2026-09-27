package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func resetAuthState() {
	sessionMu.Lock()
	sessions = map[string]session{}
	sessionMu.Unlock()
	authMu.Lock()
	authFailures = map[string]*authAttempt{}
	authMu.Unlock()
}

func TestSessionTokenLifecycle(t *testing.T) {
	resetAuthState()

	tok := newSessionToken("dashboard")
	if len(tok) != 64 {
		t.Fatalf("token length = %d, want 64 hex chars", len(tok))
	}
	if !validSession(tok) {
		t.Error("a freshly minted token should be valid")
	}
	if validSession("") || validSession("deadbeef") {
		t.Error("an unknown or empty token must not validate")
	}

	// Expiry.
	sessionMu.Lock()
	sessions[tok] = session{mode: "dashboard", expires: time.Now().Add(-time.Second)}
	sessionMu.Unlock()
	if validSession(tok) {
		t.Error("an expired token must not validate")
	}

	// Logout.
	tok2 := newSessionToken("dashboard")
	dropSession(tok2)
	if validSession(tok2) {
		t.Error("a dropped token must not validate")
	}
}

// POST /api/command accepted text/plain with no preflight and no Origin check,
// so any web page the user visited could commit and push their repository.
func TestAuthMiddlewareRefusesCrossOriginCommand(t *testing.T) {
	resetAuthState()

	reached := false
	h := authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	// No token at all.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/command", strings.NewReader(`{"command":"git_push"}`))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("Origin", "https://evil.example")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated POST = %d, want 401", rec.Code)
	}
	if reached {
		t.Error("the handler must not run for an unauthenticated request")
	}

	// Valid token but no CSRF marker.
	tok := newSessionToken("dashboard")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/command", strings.NewReader(`{"command":"git_push"}`))
	req.Header.Set(sessionHeader, tok)
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("token without CSRF marker = %d, want 403", rec.Code)
	}
	if reached {
		t.Error("the handler must not run without the CSRF marker")
	}

	// Valid token and marker: allowed.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/command", strings.NewReader(`{"command":"git_push"}`))
	req.Header.Set(sessionHeader, tok)
	req.Header.Set(csrfHeader, "1")
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("token with CSRF marker = %d, want 200", rec.Code)
	}
	if !reached {
		t.Error("an authenticated, marked request should reach the handler")
	}
}

func TestAuthMiddlewareRefusesNonJSONBody(t *testing.T) {
	resetAuthState()
	tok := newSessionToken("dashboard")
	h := authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/command", strings.NewReader("git push"))
	req.Header.Set(sessionHeader, tok)
	req.Header.Set(csrfHeader, "1")
	req.Header.Set("Content-Type", "text/plain")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain body = %d, want 415", rec.Code)
	}
}

func TestAuthMiddlewareLeavesPublicPathsOpen(t *testing.T) {
	resetAuthState()
	h := authMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	for _, p := range []string{"/api/auth", "/api/auth-media", "/api/capabilities", "/api/features", "/api/ping"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("public %s = %d, want 200", p, rec.Code)
		}
	}
	// Static assets are not API paths and must never be gated.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/static/index.html", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("static asset = %d, want 200", rec.Code)
	}
}

// 4-digit PIN, no lockout: a script on the LAN could try 10,000 combinations.
func TestAuthRateLimitsRepeatedFailures(t *testing.T) {
	resetAuthState()
	ip := "192.168.1.50"

	for i := 0; i < authFailAllow; i++ {
		authRecordFailure(ip)
	}
	locked, retry := authRateLimited(ip)
	if !locked {
		t.Fatalf("client should be locked out after %d failures", authFailAllow)
	}
	if retry <= 0 {
		t.Errorf("retry-after = %v, want a positive duration", retry)
	}

	// A different client is unaffected.
	if locked, _ := authRateLimited("192.168.1.51"); locked {
		t.Error("a different client must not inherit the lockout")
	}

	// Success clears the counter.
	authRecordSuccess(ip)
	if locked, _ := authRateLimited(ip); locked {
		t.Error("a successful unlock should clear the failure counter")
	}
}

func TestHandleAuthUnlockMintsToken(t *testing.T) {
	resetAuthState()

	configMu.Lock()
	old := dashPIN
	dashPIN = "1357"
	configMu.Unlock()
	defer func() {
		configMu.Lock()
		dashPIN = old
		configMu.Unlock()
	}()

	// Wrong PIN: no token.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth", strings.NewReader(`{"pin":"0000"}`))
	handleAuthUnlock("dashboard")(rec, req)
	var bad map[string]any
	json.NewDecoder(rec.Body).Decode(&bad)
	if bad["ok"] != false {
		t.Errorf("wrong PIN response = %v, want ok:false", bad)
	}
	if _, has := bad["token"]; has {
		t.Error("a wrong PIN must not return a token")
	}

	// Correct PIN: token issued and immediately valid.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/auth", strings.NewReader(`{"pin":"1357"}`))
	handleAuthUnlock("dashboard")(rec, req)
	var good map[string]any
	json.NewDecoder(rec.Body).Decode(&good)
	if good["ok"] != true {
		t.Fatalf("correct PIN response = %v, want ok:true", good)
	}
	tok, _ := good["token"].(string)
	if tok == "" {
		t.Fatal("correct PIN did not return a token")
	}
	if !validSession(tok) {
		t.Error("the issued token should validate immediately")
	}
}

func TestClientIPIgnoresForwardedHeader(t *testing.T) {
	// X-Forwarded-For is attacker-controlled, so the socket address is used.
	req := httptest.NewRequest(http.MethodGet, "/api/ping", nil)
	req.RemoteAddr = "10.0.0.9:5555"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	if got := clientIP(req); got != "10.0.0.9" {
		t.Errorf("clientIP = %q, want 10.0.0.9", got)
	}
}
