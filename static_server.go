package main

import (
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// The dashboard used to serve the whole working directory:
//
//	http.Handle("/", http.FileServer(http.Dir(".")))
//
// which meant anyone who could reach the port could read config.json (both
// PINs in cleartext), server.key (the complete TLS private key), server.log,
// the .git directory and the entire source tree. Only the built frontend is
// meant to be public, so only that is served.

// staticRoot is the single directory exposed over HTTP.
const staticRoot = "static"

// blockedNames are never served even if they somehow land under staticRoot.
var blockedNames = map[string]bool{
	"server.key":  true,
	"server.crt":  true,
	"server.log":  true,
	"config.json": true,
	".git":        true,
	".env":        true,
}

// newStaticHandler serves the built frontend and nothing else.
//
//   - "/" redirects to the app entry point rather than listing a directory
//   - every other path is resolved inside staticRoot and refused if it escapes
//   - dotfiles and the known-sensitive names are refused outright
func newStaticHandler() http.Handler {
	absRoot, err := filepath.Abs(staticRoot)
	if err != nil {
		log.Printf("static: cannot resolve %q: %v", staticRoot, err)
		absRoot = staticRoot
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			http.Redirect(w, r, "/"+staticRoot+"/", http.StatusFound)
			return
		}

		clean := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))

		// Refuse anything that is not under the static root.
		if !strings.HasPrefix(clean, "/"+staticRoot+"/") && clean != "/"+staticRoot {
			http.NotFound(w, r)
			return
		}

		rel := strings.TrimPrefix(strings.TrimPrefix(clean, "/"+staticRoot), "/")
		if rel == "" {
			rel = "index.html"
		}

		// Refuse dotfiles anywhere in the path (.git, .env, .ssh/...).
		for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
			if seg == "" {
				continue
			}
			if strings.HasPrefix(seg, ".") || blockedNames[strings.ToLower(seg)] {
				http.NotFound(w, r)
				return
			}
		}

		// Final containment check. path.Clean already removed "..", but a
		// symlink or an odd encoding must not be able to point outside either.
		target := filepath.Join(absRoot, filepath.FromSlash(rel))
		if resolved, err := filepath.EvalSymlinks(target); err == nil {
			if !strings.HasPrefix(resolved, absRoot+string(os.PathSeparator)) && resolved != absRoot {
				http.NotFound(w, r)
				return
			}
		}

		// Serve the bytes directly. http.FileServer redirects index.html to "./",
		// which against this rewrite is an infinite /static/ -> ./ -> /static/ loop.
		info, err := os.Stat(target)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if info.IsDir() {
			target = filepath.Join(target, "index.html")
			info, err = os.Stat(target)
			if err != nil || info.IsDir() {
				http.NotFound(w, r)
				return
			}
		}
		f, err := os.Open(target)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		// ServeContent handles Content-Type, Range and conditional requests.
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	})
}
