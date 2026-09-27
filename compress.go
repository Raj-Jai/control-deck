package main

import (
	"compress/gzip"
	"net/http"
	"strings"
	"sync"
)

// compressHandler gzips responses for clients that ask for it.
//
// The frontend bundle is around 640 kB of JavaScript and the SSE payload is
// large and highly repetitive; neither listener compressed anything, so every
// client pulled the lot over the wire twice a second. Compression is applied
// only to text-ish types: re-encoding an already-compressed image or a
// self-signed certificate wastes CPU for nothing.
func compressHandler(next http.Handler) http.Handler {
	var (
		once sync.Once
		pool *sync.Pool
	)
	pool = &sync.Pool{New: func() any { return gzip.NewWriter(nil) }}
	_ = once

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A WebSocket upgrade needs to hijack the connection, which the
		// wrapping ResponseWriter does not implement - the handshake fails with
		// 501 Not Implemented. Upgrades must pass through untouched.
		if isWebSocketUpgrade(r) {
			next.ServeHTTP(w, r)
			return
		}
		if !acceptsGzip(r.Header.Get("Accept-Encoding")) || !compressible(w.Header()) {
			next.ServeHTTP(w, r)
			return
		}
		// Never compress an event stream. SSE depends on each write reaching the
		// client immediately, and a compressor in the middle buffers exactly
		// what the protocol needs flushed. The response Content-Type is not
		// known until the handler runs, so this has to be decided by path.
		if isEventStreamPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		gz := pool.Get().(*gzip.Writer)
		gz.Reset(w)
		defer func() {
			gz.Close()
			pool.Put(gz)
		}()
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		// Length is unknown once compressed; and an already-set length would be
		// wrong.
		w.Header().Del("Content-Length")
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, gz: gz}, r)
	})
}

// gzipResponseWriter commits the status and headers on the first Write, which
// is the only point at which they can still be changed.
type gzipResponseWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	if g.wroteHeader {
		return
	}
	g.wroteHeader = true
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	return g.gz.Write(b)
}

// Flush keeps SSE-style handlers working if one is ever routed through here.
func (g *gzipResponseWriter) Flush() {
	_ = g.gz.Flush()
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// isWebSocketUpgrade reports whether the request is a protocol upgrade.
func isWebSocketUpgrade(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	for _, v := range r.Header.Values("Connection") {
		for _, token := range strings.Split(v, ",") {
			if strings.EqualFold(strings.TrimSpace(token), "upgrade") {
				return true
			}
		}
	}
	return false
}

// isEventStreamPath lists the endpoints that stream. Keep in step with the
// routes registered in main.go.
func isEventStreamPath(p string) bool {
	return p == "/media-stream" || p == "/api/window-stream"
}

func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		enc := strings.TrimSpace(strings.SplitN(part, ";", 2)[0])
		if strings.EqualFold(enc, "gzip") {
			return true
		}
	}
	return false
}

func compressible(header http.Header) bool {
	ct := header.Get("Content-Type")
	if ct == "" {
		// Let the handler decide; most of our JSON endpoints set it, and the
		// static handler sets it from the file extension.
		return true
	}
	if strings.HasPrefix(ct, "text/") {
		return true
	}
	for _, kind := range []string{"json", "javascript", "xml", "svg", "yaml"} {
		if strings.Contains(ct, kind) {
			return true
		}
	}
	return false
}
