package main

import (
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/coder/websocket"
)

// Both WebSocket endpoints passed InsecureSkipVerify: true, which disables the
// library's Origin check entirely. The audit verified that a handshake with
// "Origin: https://evil.example" against /ws/terminal returned
// 101 Switching Protocols and yielded a $SHELL PTY.
//
// The dashboard has no configurable allow-list, so the rule is structural: the
// Origin must be absent (a non-browser client, which cannot be driven by a web
// page) or must match the host the request actually arrived on. A page on any
// other origin cannot satisfy that, and a browser always sends Origin on a
// WebSocket handshake.
// errForbiddenOrigin is returned to the caller; the response has already been
// written by the time it is.
var errForbiddenOrigin = errors.New("forbidden origin")

func wsAcceptOptions(r *http.Request) *websocket.AcceptOptions {
	return &websocket.AcceptOptions{
		OriginPatterns: []string{originPattern(r)},
	}
}

// originPattern builds the single permitted Origin for this request.
func originPattern(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	// Honour X-Forwarded-Proto only for the scheme, never for identity: the
	// host is taken from the request the server actually received.
	if p := r.Header.Get("X-Forwarded-Proto"); p == "https" || p == "http" {
		scheme = p
	}
	host := r.Host
	if host == "" {
		host = "localhost"
	}
	return scheme + "://" + host
}

// sameOrigin reports whether an Origin header is acceptable. An empty Origin
// means a non-browser client, which no web page can forge.
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func acceptWebSocket(w http.ResponseWriter, r *http.Request, name string) (*websocket.Conn, error) {
	if !sameOrigin(r) {
		log.Printf("%s: rejected cross-origin websocket from %q for host %q",
			name, r.Header.Get("Origin"), r.Host)
		http.Error(w, "forbidden origin", http.StatusForbidden)
		return nil, errForbiddenOrigin
	}
	return websocket.Accept(w, r, wsAcceptOptions(r))
}
