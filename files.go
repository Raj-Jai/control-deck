package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	// maxUploadBytes caps a single file drop (100 MiB).
	maxUploadBytes = 100 << 20
)

// dropDir is ~/deck-drop, created on demand.
func dropDir() string {
	return os.Getenv("HOME") + "/deck-drop"
}

func mustAbsDropDir() string {
	abs, err := filepath.Abs(dropDir())
	if err != nil {
		return dropDir()
	}
	return abs
}

// safeDropName rejects traversal, separators, and degenerate names.
func safeDropName(name string) (string, bool) {
	if name == "" || name == "." || name == ".." || len(name) > 255 {
		return "", false
	}
	if strings.ContainsAny(name, "/\\\x00") {
		return "", false
	}
	if filepath.Base(name) != name {
		return "", false
	}
	return name, true
}

func handleFileUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureFileDrop) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1024)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		http.Error(w, "Upload too large or invalid", http.StatusBadRequest)
		return
	}
	f, hdr, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Missing file field", http.StatusBadRequest)
		return
	}
	defer f.Close()
	name, ok := safeDropName(hdr.Filename)
	if !ok {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}
	if err := os.MkdirAll(dropDir(), 0755); err != nil {
		http.Error(w, "Storage unavailable", http.StatusInternalServerError)
		return
	}
	// Belt-and-suspenders containment: the final path must stay in dropDir
	// even if a separator ever slips past safeDropName.
	dest := filepath.Join(dropDir(), name)
	if abs, err := filepath.Abs(dest); err != nil || filepath.Dir(abs) != mustAbsDropDir() {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}
	dst, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		http.Error(w, "Save failed", http.StatusInternalServerError)
		return
	}
	n, err := io.Copy(dst, io.LimitReader(f, maxUploadBytes+1))
	dst.Close()
	if err != nil {
		os.Remove(filepath.Join(dropDir(), name))
		http.Error(w, "Save failed", http.StatusBadRequest)
		return
	}
	if n > maxUploadBytes {
		os.Remove(filepath.Join(dropDir(), name))
		http.Error(w, "Upload too large", http.StatusBadRequest)
		return
	}
	addLog("⇪ dropped file " + name)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "name": name, "size": n})
}

type droppedFile struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
}

func handleFileList(w http.ResponseWriter, r *http.Request) {
	if !requireFeature(w, FeatureFileDrop) {
		return
	}
	out := []droppedFile{}
	entries, err := os.ReadDir(dropDir())
	if err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			out = append(out, droppedFile{
				Name:     e.Name(),
				Size:     info.Size(),
				Modified: info.ModTime().Unix(),
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func handleFileDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureFileDrop) {
		return
	}
	name, ok := safeDropName(r.URL.Query().Get("name"))
	if !ok {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}
	http.ServeFile(w, r, filepath.Join(dropDir(), name))
}
