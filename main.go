package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// CommandMap routes web deck actions directly to Linux CLI utilities.
var commandMap = map[string][]string{
	"playpause":      {"playerctl", "play-pause"},
	"next":           {"playerctl", "next"},
	"previous":       {"playerctl", "previous"},
	"volUp":          {"wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%+"},
	"volDown":        {"wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%-"},
	"mute":           {"wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"},
	"brightnessUp":   {"brightnessctl", "set", "+10%"},
	"brightnessDown": {"brightnessctl", "set", "10%-"},
	"lock":           {"loginctl", "lock-session"},
	"bluetooth":      {"rfkill", "toggle", "bluetooth"},
	"warpOn":         {"warp-cli", "connect"},
	"warpOff":        {"warp-cli", "disconnect"},
	// Add your script paths here if needed
	"erpLogin": {"erp", "login"},
}

type MediaState struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Status   string  `json:"status"`
	ArtURL   string  `json:"art_url"`
	Position float64 `json:"position"`
	Length   float64 `json:"length"`
}

type CommandRequest struct {
	Command string `json:"command"`
}

type SeekRequest struct {
	Position float64 `json:"position"`
}

var (
	clients      = make(map[chan string]bool)
	clientsMu    sync.Mutex
	artCachePath string
	artCacheData string
)

func main() {
	// Serve frontend assets
	http.Handle("/", http.FileServer(http.Dir(".")))

	// API Routes
	http.HandleFunc("/api/command", handleCommand)
	http.HandleFunc("/seek", handleSeek)
	http.HandleFunc("/media-stream", handleSSE)

	// Background ticker to broadcast MPRIS state to connected web decks
	go startMediaBroadcaster()

	port := ":8080"
	log.Printf("Control Deck running on http://localhost%s\n", port)
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// Executed when buttons are pressed on the Web Deck
func handleCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	args, exists := commandMap[req.Command]
	if !exists {
		http.Error(w, "Unknown command", http.StatusBadRequest)
		return
	}

	// Fire command in background thread for low-latency response
	go func(cmdArgs []string) {
		cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
		if out, err := cmd.CombinedOutput(); err != nil {
			log.Printf("Error executing %v: %v | Output: %s", cmdArgs, err, string(out))
		}
	}(args)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "executed": req.Command})
}

// Handles timeline seeking via playerctl
func handleSeek(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SeekRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	go func(pos float64) {
		cmd := exec.Command("playerctl", "position", fmt.Sprintf("%f", pos))
		if err := cmd.Run(); err != nil {
			log.Printf("Error seeking to %f: %v", pos, err)
		}
	}(req.Position)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Server-Sent Events (SSE) endpoint for real-time track updates
func handleSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	messageChan := make(chan string)

	clientsMu.Lock()
	clients[messageChan] = true
	clientsMu.Unlock()

	defer func() {
		clientsMu.Lock()
		delete(clients, messageChan)
		clientsMu.Unlock()
		close(messageChan)
	}()

	notify := r.Context().Done()
	for {
		select {
		case <-notify:
			return
		case msg := <-messageChan:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

// Polls MPRIS state via playerctl and broadcasts to SSE clients
func startMediaBroadcaster() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		clientsMu.Lock()
		clientCount := len(clients)
		clientsMu.Unlock()

		if clientCount == 0 {
			continue
		}

		state := fetchMPRISState()
		data, err := json.Marshal(state)
		if err != nil {
			continue
		}

		msg := string(data)
		clientsMu.Lock()
		for ch := range clients {
			select {
			case ch <- msg:
			default:
			}
		}
		clientsMu.Unlock()
	}
}

func resolveArtURL(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}

	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}

	if strings.HasPrefix(rawURL, "file://") {
		parsed, err := url.Parse(rawURL)
		if err != nil {
			log.Printf("Failed to parse art URL %s: %v", rawURL, err)
			return ""
		}
		filePath := parsed.Path

		if filePath == artCachePath {
			return artCacheData
		}

		data, err := os.ReadFile(filePath)
		if err != nil {
			log.Printf("Failed to read art file %s: %v", filePath, err)
			artCachePath = filePath
			artCacheData = ""
			return ""
		}

		mimeType := http.DetectContentType(data)
		if !strings.HasPrefix(mimeType, "image/") {
			log.Printf("Art file %s has non-image MIME type: %s", filePath, mimeType)
			artCachePath = filePath
			artCacheData = ""
			return ""
		}

		encoded := base64.StdEncoding.EncodeToString(data)
		dataURI := "data:" + mimeType + ";base64," + encoded
		artCachePath = filePath
		artCacheData = dataURI
		return dataURI
	}

	log.Printf("Unknown art URL scheme: %s", rawURL)
	return ""
}

func runPlayerctl(args ...string) (string, error) {
	out, err := exec.Command("playerctl", args...).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func fetchMPRISState() MediaState {
	title, _ := runPlayerctl("metadata", "xesam:title")
	artist, _ := runPlayerctl("metadata", "xesam:artist")
	status, _ := runPlayerctl("status")

	lenStr, lenErr := runPlayerctl("metadata", "mpris:length")
	var length float64
	if lenErr == nil {
		if l, e := strconv.ParseFloat(lenStr, 64); e == nil {
			length = l / 1000000.0
		}
	}

	posStr, posErr := runPlayerctl("position")
	var posSeconds float64
	if posErr == nil {
		posSeconds, _ = strconv.ParseFloat(posStr, 64)
	}

	artStr, _ := runPlayerctl("metadata", "mpris:artUrl")

	return MediaState{
		Title:    title,
		Artist:   artist,
		Status:   status,
		ArtURL:   resolveArtURL(artStr),
		Position: posSeconds,
		Length:   length,
	}
}
