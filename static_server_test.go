package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The root used to be http.FileServer(http.Dir(".")), which served
// config.json (both PINs), server.key, server.log and .git/ to anyone who
// could reach the port.
func TestStaticHandlerRefusesEverythingOutsideStaticRoot(t *testing.T) {
	root := t.TempDir()
	staticDir := filepath.Join(root, "static")
	if err := os.MkdirAll(filepath.Join(staticDir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(staticDir, "index.html"), "<html>app</html>")
	writeFile(t, filepath.Join(staticDir, "assets", "index-abc.js"), "console.log(1)")
	writeFile(t, filepath.Join(root, "config.json"), `{"pin":"1234"}`)
	writeFile(t, filepath.Join(root, "server.key"), "PRIVATE KEY")
	writeFile(t, filepath.Join(root, "main.go"), "package main")

	prev, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(prev)

	h := newStaticHandler()

	denied := []string{
		"/config.json",
		"/server.key",
		"/server.crt",
		"/server.log",
		"/main.go",
		"/.git/config",
		"/.env",
		"/static/../config.json",
		"/static/../../etc/passwd",
		"/static/assets/../../config.json",
	}
	for _, p := range denied {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404 (body %q)", p, rec.Code, truncate(rec.Body.String(), 40))
		}
	}

	allowed := []string{
		"/static/index.html",
		"/static/assets/index-abc.js",
		"/static/",
	}
	for _, p := range allowed {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", p, rec.Code)
		}
	}
}

// http.FileServer redirected index.html to "./", which against this handler is
// an infinite /static/ -> ./ -> /static/ loop that made the app unreachable.
func TestStaticHandlerIndexDoesNotRedirectForever(t *testing.T) {
	root := t.TempDir()
	staticDir := filepath.Join(root, "static")
	if err := os.MkdirAll(staticDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(staticDir, "index.html"), "<html>app</html>")

	prev, _ := os.Getwd()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(prev)

	h := newStaticHandler()
	// One hop from "/" to the app, then a real 200 - never a redirect.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusFound {
		t.Fatalf("GET / = %d, want 302", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.HasSuffix(loc, "/static/") {
		t.Fatalf("redirect target = %q, want /static/", loc)
	}

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, loc, nil))
	if rec2.Code != http.StatusOK {
		t.Fatalf("GET %s = %d, want 200 (redirect loop)", loc, rec2.Code)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// Without an explicit Cache-Control the browser guesses from Last-Modified, and
// for the shell it guesses "reuse this", so a phone with the dashboard
// installed kept rendering the previous build and UI changes looked like they
// had not deployed.
func TestStaticCacheHeaders(t *testing.T) {
	root := t.TempDir()
	staticDir := filepath.Join(root, "static")
	assets := filepath.Join(staticDir, "assets")
	if err := os.MkdirAll(assets, 0o755); err != nil {
		t.Fatal(err)
	}
	// A real name from the current build. The hash is base64url and need not
	// contain a digit, which is what a filename-sniffing rule got wrong.
	hashed := "index-BOoHxFAc.js"
	// Chunks go under assets/, everything else at the root.
	for name, body := range map[string]string{
		"assets/" + hashed:  "console.log(1)",
		"index.html":        "<!doctype html>",
		"service-worker.js": "self.addEventListener('install',()=>{})",
		"manifest.json":     "{}",
		"icon-192.png":      "\x89PNG",
	} {
		if err := os.WriteFile(filepath.Join(staticDir, filepath.FromSlash(name)), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	h := newStaticHandlerAt(staticDir)

	for _, tc := range []struct{ path, want string }{
		{"/static/assets/" + hashed, "public, max-age=31536000, immutable"},
		{"/static/index.html", "no-cache"},
		{"/static/service-worker.js", "no-cache"},
		{"/static/manifest.json", "no-cache"},
		{"/static/icon-192.png", "public, max-age=3600"},
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", tc.path, rec.Code)
			continue
		}
		if got := rec.Header().Get("Cache-Control"); got != tc.want {
			t.Errorf("GET %s Cache-Control = %q, want %q", tc.path, got, tc.want)
		}
	}
}
