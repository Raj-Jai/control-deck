package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// The dashboard had no authorization boundary at all: every /api/ endpoint,
// both WebSockets and the SSE stream were open to anything that could reach the
// port, and POST /api/command accepted a text/plain body with no preflight and
// no Origin check. Any web page the user visited could commit, push, reset or
// wipe their repository.
//
// The fix has two halves:
//
//  1. A real session. Unlocking with the PIN mints a random token; everything
//     except the handful of endpoints needed before unlock requires it. A
//     cross-origin attacker cannot read the token, because the app is served
//     from this origin and there is no CORS header anywhere.
//
//  2. A CSRF guard. Mutating requests must carry the token in a custom header.
//     Custom headers force a preflight for cross-origin requests, and no
//     Access-Control-Allow-* is ever sent, so the preflight fails and the real
//     request is never sent. That closes the text/plain no-preflight vector
//     even if a token ever leaked.

const (
	sessionHeader    = "X-Control-Deck-Token"
	csrfHeader       = "X-Control-Deck-CSRF"
	sessionTTL       = 12 * time.Hour
	maxSessions      = 64
	authFailWindow   = 15 * time.Minute
	authFailAllow    = 5
	authLockoutBase  = 30 * time.Second
	authLockoutLimit = 15 * time.Minute
)

type session struct {
	mode    string
	expires time.Time
}

var (
	sessionMu sync.Mutex
	sessions  = map[string]session{}

	// PIN brute-force protection (SEC-008).
	authMu       sync.Mutex
	authFailures = map[string]*authAttempt{}

	// Set when the PIN is empty in config, so a deployment that never set one
	// is not permanently locked out.
	authDisabled bool
)

type authAttempt struct {
	fails    int
	first    time.Time
	lockedTo time.Time
}

// newSessionToken mints a token for a successful unlock.
func newSessionToken(mode string) string {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		// crypto/rand failing is unrecoverable; refusing is the safe answer.
		log.Printf("auth: cannot read random bytes: %v", err)
		return ""
	}
	tok := hex.EncodeToString(raw)

	sessionMu.Lock()
	defer sessionMu.Unlock()
	if len(sessions) >= maxSessions {
		expireSessionsLocked(time.Now())
	}
	sessions[tok] = session{mode: mode, expires: time.Now().Add(sessionTTL)}
	return tok
}

func expireSessionsLocked(now time.Time) {
	for k, s := range sessions {
		if now.After(s.expires) {
			delete(sessions, k)
		}
	}
}

func validSession(token string) bool {
	if token == "" {
		return false
	}
	sessionMu.Lock()
	defer sessionMu.Unlock()
	s, ok := sessions[token]
	if !ok {
		return false
	}
	if time.Now().After(s.expires) {
		delete(sessions, token)
		return false
	}
	return true
}

func dropSession(token string) {
	sessionMu.Lock()
	delete(sessions, token)
	sessionMu.Unlock()
}

// tokenFromRequest reads the session token from the header, or from the query
// string for the transports that cannot set headers (EventSource, WebSocket).
func tokenFromRequest(r *http.Request) string {
	if t := r.Header.Get(sessionHeader); t != "" {
		return t
	}
	return r.URL.Query().Get("token")
}

func clientIP(r *http.Request) string {
	// X-Forwarded-For is not trusted (SEC-012): the dashboard is reached
	// directly on the LAN, so the socket address is the only honest source.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// authRateLimited reports whether this client is currently locked out, and
// records a failure.
func authRateLimited(ip string) (locked bool, retryAfter time.Duration) {
	authMu.Lock()
	defer authMu.Unlock()
	now := time.Now()
	a := authFailures[ip]
	if a == nil {
		a = &authAttempt{first: now}
		authFailures[ip] = a
	}
	if now.Before(a.lockedTo) {
		return true, a.lockedTo.Sub(now)
	}
	if now.Sub(a.first) > authFailWindow {
		a.fails = 0
		a.first = now
	}
	return false, 0
}

func authRecordFailure(ip string) {
	authMu.Lock()
	defer authMu.Unlock()
	now := time.Now()
	a := authFailures[ip]
	if a == nil {
		a = &authAttempt{first: now}
		authFailures[ip] = a
	}
	if now.Sub(a.first) > authFailWindow {
		a.fails = 0
		a.first = now
	}
	a.fails++
	if a.fails >= authFailAllow {
		// Double the lockout each time, up to a ceiling.
		backoff := authLockoutBase
		for i := authFailAllow; i < a.fails && backoff < authLockoutLimit; i++ {
			backoff *= 2
		}
		if backoff > authLockoutLimit {
			backoff = authLockoutLimit
		}
		a.lockedTo = now.Add(backoff)
	}
}

func authRecordSuccess(ip string) {
	authMu.Lock()
	delete(authFailures, ip)
	authMu.Unlock()
}

// publicPaths never require a session: they are either needed before unlock or
// carry nothing sensitive.
var publicPaths = map[string]bool{
	"/api/auth":         true,
	"/api/auth-media":   true,
	"/api/capabilities": true,
	"/api/features":     true,
	"/api/ping":         true,
}

// requireSession wraps a handler so it only runs for an unlocked client.
func requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validSession(tokenFromRequest(r)) {
			w.Header().Set("WWW-Authenticate", `Token realm="control-deck"`)
			http.Error(w, "locked", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// authMiddleware enforces the session and the CSRF guard for every API route
// that is not explicitly public.
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/") && p != "/media-stream" && p != "/seek" &&
			p != "/ws/terminal" && p != "/api/window-stream" {
			next.ServeHTTP(w, r)
			return
		}
		if publicPaths[p] {
			next.ServeHTTP(w, r)
			return
		}

		// A cross-origin simple request cannot set a custom header, and no
		// CORS headers are ever returned, so requiring one is what actually
		// stops a foreign page from driving the host.
		if !validSession(tokenFromRequest(r)) {
			http.Error(w, "locked", http.StatusUnauthorized)
			return
		}

		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			ct := r.Header.Get("Content-Type")
			if ct != "" && !strings.HasPrefix(strings.ToLower(ct), "application/json") {
				http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
				return
			}
			// A same-origin form post or a text/plain body is refused outright.
			if r.Header.Get(csrfHeader) != "1" {
				http.Error(w, "missing CSRF marker", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// handleAuthUnlock is the shared body of /api/auth and /api/auth-media.
func handleAuthUnlock(mode string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ip := clientIP(r)
		if locked, retry := authRateLimited(ip); locked {
			w.Header().Set("Retry-After", itoa(int(retry.Seconds())+1))
			http.Error(w, "too many attempts", http.StatusTooManyRequests)
			return
		}

		var req struct {
			PIN string `json:"pin"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		configMu.RLock()
		want := dashPIN
		configMu.RUnlock()

		// An empty configured PIN means the owner never set one; refusing
		// forever would lock them out of their own dashboard. In that case the
		// session is the only thing standing between the LAN and the host, so
		// say so loudly at startup rather than pretending the lock is real.
		ok := want == "" || subtle.ConstantTimeCompare([]byte(req.PIN), []byte(want)) == 1

		w.Header().Set("Content-Type", "application/json")
		if !ok {
			authRecordFailure(ip)
			json.NewEncoder(w).Encode(map[string]any{"ok": false})
			return
		}
		authRecordSuccess(ip)
		tok := newSessionToken(mode)
		if tok == "" {
			http.Error(w, "auth unavailable", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "token": tok})
	}
}

func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if t := tokenFromRequest(r); t != "" {
		dropSession(t)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// startSessionReaper drops expired sessions so a long-lived server does not
// accumulate them.
func startSessionReaper() {
	go func() {
		for range time.Tick(10 * time.Minute) {
			sessionMu.Lock()
			expireSessionsLocked(time.Now())
			sessionMu.Unlock()
			authMu.Lock()
			for ip, a := range authFailures {
				if time.Now().After(a.lockedTo) && a.fails == 0 {
					delete(authFailures, ip)
				}
			}
			authMu.Unlock()
		}
	}()
}
