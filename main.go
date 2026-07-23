package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type MediaState struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Status   string  `json:"status"`   // Playing, Paused, Stopped
	Position float64 `json:"position"` // in seconds
	Length   float64 `json:"length"`   // in seconds
	ArtUrl   string  `json:"art_url"`  // URL or proxy route to album art
}

type SeekPayload struct {
	Position float64 `json:"position"`
}

func getMPRISState() MediaState {
	// Use individual queries or properly escaped JSON format
	format := `{"title": "{{title}}", "artist": "{{artist}}", "status": "{{status}}", "position": {{position}}, "length": {{mpris:length}}, "artUrl": "{{mpris:artUrl}}"}`
	cmd := exec.Command("playerctl", "metadata", "--format", format)
	out, err := cmd.Output()
	if err != nil {
		return MediaState{}
	}

	var raw struct {
		Title    string  `json:"title"`
		Artist   string  `json:"artist"`
		Status   string  `json:"status"`
		Position float64 `json:"position"`
		Length   float64 `json:"length"`
		ArtUrl   string  `json:"artUrl"`
	}

	if err := json.Unmarshal(out, &raw); err != nil {
		// Fallback: If JSON unmarshaling fails due to unescaped quotes in track titles
		return getMPRISStateFallback()
	}

	art := strings.TrimSpace(raw.ArtUrl)

	if strings.HasPrefix(art, "file://") {
		rawPath := strings.TrimPrefix(art, "file://")
		if decodedPath, err := url.QueryUnescape(rawPath); err == nil {
			art = "/art?path=" + url.QueryEscape(decodedPath)
		} else {
			art = "/art?path=" + url.QueryEscape(rawPath)
		}
	}

	return MediaState{
		Title:    raw.Title,
		Artist:   raw.Artist,
		Status:   raw.Status,
		Position: raw.Position / 1000000.0,
		Length:   raw.Length / 1000000.0,
		ArtUrl:   art,
	}
}

// Robust fallback in case titles contain unescaped JSON characters
func getMPRISStateFallback() MediaState {
	artCmd := exec.Command("playerctl", "metadata", "mpris:artUrl")
	artOut, _ := artCmd.Output()
	art := strings.TrimSpace(string(artOut))

	if strings.HasPrefix(art, "file://") {
		rawPath := strings.TrimPrefix(art, "file://")
		if decodedPath, err := url.QueryUnescape(rawPath); err == nil {
			art = "/art?path=" + url.QueryEscape(decodedPath)
		} else {
			art = "/art?path=" + url.QueryEscape(rawPath)
		}
	}

	titleCmd := exec.Command("playerctl", "metadata", "title")
	titleOut, _ := titleCmd.Output()

	artistCmd := exec.Command("playerctl", "metadata", "artist")
	artistOut, _ := artistCmd.Output()

	statusCmd := exec.Command("playerctl", "status")
	statusOut, _ := statusCmd.Output()

	return MediaState{
		Title:  strings.TrimSpace(string(titleOut)),
		Artist: strings.TrimSpace(string(artistOut)),
		Status: strings.TrimSpace(string(statusOut)),
		ArtUrl: art,
	}
}

// Serve local album art files, detecting image types dynamically
func artHandler(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "Missing path parameter", http.StatusBadRequest)
		return
	}

	cleanPath := filepath.Clean(filePath)
	data, err := os.ReadFile(cleanPath)
	if err != nil {
		http.Error(w, "Art file not found", http.StatusNotFound)
		return
	}

	// Detect MIME type dynamically using content sniff (handles extensionless files like Chrome's /tmp/.com.google.Chrome.*)
	contentType := http.DetectContentType(data)
	w.Header().Set("Content-Type", contentType)
	w.Write(data)
}

func mediaStreamHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			state := getMPRISState()
			data, _ := json.Marshal(state)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func seekHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload SeekPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	posStr := strconv.FormatFloat(payload.Position, 'f', 2, 64)
	_ = exec.Command("playerctl", "position", posStr).Run()

	w.WriteHeader(http.StatusOK)
}

func main() {
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)
	http.HandleFunc("/media-stream", mediaStreamHandler)
	http.HandleFunc("/seek", seekHandler)
	http.HandleFunc("/art", artHandler)

	log.Println("Control Deck server running on http://0.0.0.0:8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("Server launch failed: %v", err)
	}
}
