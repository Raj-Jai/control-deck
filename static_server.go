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

// setStaticCacheHeaders says how long each response may be reused.
//
// Nothing was being set at all, which left the browser to guess from
// Last-Modified. For the app shell that guess goes the wrong way often enough
// to matter: a phone that had the dashboard installed as a home-screen app
// could keep rendering the previous build, so a UI change deployed to the
// server was simply not visible on the device. That is the whole reason the
// service worker's cache name carries the build hash (BUG-019) - and it was
// still not enough, because the HTML the worker serves from its own cache
// never revalidates.
//
// The rule is the standard one for a content-hashed build:
//
//   - /assets/* filenames contain a hash of their contents, so a given URL can
//     never mean two different files. Cache them for a year, immutable.
//   - the shell, the worker and the manifest decide which hashed assets get
//     loaded, so they must be revalidated every time. no-cache still allows a
//     304, so this costs a round trip and saves a stale app.
//   - everything else in static/ is unhashed, so give it a short window.
func setStaticCacheHeaders(w http.ResponseWriter, rel string) {
	base := path.Base(rel)
	switch {
	case strings.HasPrefix(rel, "assets/") && looksHashed(base):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case base == "index.html" || base == "service-worker.js" || base == "manifest.json":
		w.Header().Set("Cache-Control", "no-cache")
	default:
		w.Header().Set("Cache-Control", "public, max-age=3600")
	}
}

// looksHashed reports whether a filename ends in a build hash, which is what
// Vite appends. A file under assets/ without one is not content-addressed, and
// caching it for a year would be a lie the browser believes.
func looksHashed(name string) bool {
	// Strip the extension first: Vite names chunks index-DrNsI20R.js, and the
	// hash is everything between the last dash and the dot.
	stem := strings.TrimSuffix(name, path.Ext(name))
	i := strings.LastIndex(stem, "-")
	if i < 0 {
		return false
	}
	hash := stem[i+1:]
	if len(hash) < 8 {
		return false
	}
	// Vite's hashes are base64url, not hex - index-BOoHxFAc.js has an x in it -
	// so this cannot be a hex check. Require at least one digit, which is what
	// separates a hash from an ordinary word.
	var digit bool
	for _, r := range hash {
		switch {
		case r >= '0' && r <= '9':
			digit = true
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r == '-', r == '_':
		default:
			return false
		}
	}
	return digit
}

// newStaticHandler serves the built frontend and nothing else.
//
//   - "/" redirects to the app entry point rather than listing a directory
//   - every other path is resolved inside staticRoot and refused if it escapes
//   - dotfiles and the known-sensitive names are refused outright
func newStaticHandler() http.Handler {
	return newStaticHandlerAt(staticRoot)
}

// newStaticHandlerAt is newStaticHandler with an explicit root, so a test can
// serve a directory it built rather than the package's own static/.
func newStaticHandlerAt(root string) http.Handler {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		log.Printf("static: cannot resolve %q: %v", root, err)
		absRoot = root
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
		// The worker is served from /static/, so its default scope is /static/ -
		// which cannot see /api/ or /ws/ at all, making the pass-through rules
		// in its fetch handler unreachable (BUG-018). This header is how a
		// browser is told the worker may claim the whole origin.
		if rel == "service-worker.js" {
			w.Header().Set("Service-Worker-Allowed", "/")
		}
		setStaticCacheHeaders(w, rel)

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
