package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

func isFinite(v float64) bool {
	return !math.IsInf(v, 0) && !math.IsNaN(v)
}

var dashPIN string
var caffeineSD string
var commandMap map[string][]string

func buildCommandMap() {
	caffeineSD = appCfg.CaffeineSchemaDir
	if caffeineSD == "" {
		caffeineSD = os.Getenv("HOME") + "/.local/share/gnome-shell/extensions/caffeine@patapon.info/schemas"
	}
	dashPIN = appCfg.PIN
	if dashPIN == "" {
		dashPIN = "0616"
	}

	commandMap = map[string][]string{
		"playpause":      {"playerctl", "play-pause"},
		"next":           {"playerctl", "next"},
		"previous":       {"playerctl", "previous"},
		"volUp":          {"wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%+"},
		"volDown":        {"wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%-"},
		"mute":           {"wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"},
		"brightnessUp":   {"brightnessctl", "set", "+10%"},
		"brightnessDown": {"brightnessctl", "set", "10%-"},
		"lock":           {"loginctl", "lock-session"},
		"bluetoothOn":    {"rfkill", "unblock", "bluetooth"},
		"bluetoothOff":   {"rfkill", "block", "bluetooth"},
		"btConnect":      {"bluetoothctl", "connect", appCfg.BTMAC},
		"nightOn":  {"gsettings", "set", "org.gnome.settings-daemon.plugins.color", "night-light-enabled", "true"},
		"nightOff": {"gsettings", "set", "org.gnome.settings-daemon.plugins.color", "night-light-enabled", "false"},
		"caffeineOff": {"gsettings", "--schemadir", caffeineSD, "set", "org.gnome.shell.extensions.caffeine", "cli-toggle", "false"},
		"caffeineOn":  {"bash", "-c", "gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine cli-toggle false && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine use-custom-duration false && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine duration-timer 0 && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine countdown-timer 0 && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine cli-toggle true"},
		"caffeine30":  {"bash", "-c", "gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine cli-toggle false && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine use-custom-duration true && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine duration-timer 1800 && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine countdown-timer 1800 && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine cli-toggle true"},
		"caffeine60":  {"bash", "-c", "gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine cli-toggle false && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine use-custom-duration true && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine duration-timer 3600 && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine countdown-timer 3600 && gsettings --schemadir " + caffeineSD + " set org.gnome.shell.extensions.caffeine cli-toggle true"},
	}
	for k, v := range appCfg.CustomCommands {
		commandMap[k] = v
	}
}

type SystemStats struct {
	CPU      float64 `json:"cpu"`
	RAM      float64 `json:"ram"`
	Battery  float64 `json:"battery"`
	Charging bool    `json:"charging"`
	Temp     float64 `json:"temp"`
	SSID     string  `json:"ssid"`
	IP       string  `json:"ip"`
	PingOK   bool    `json:"ping_ok"`
}

type MediaState struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Status   string  `json:"status"`
	ArtURL   string  `json:"art_url"`
	Position float64 `json:"position"`
	Length   float64 `json:"length"`
	Volume     float64 `json:"volume"`
	Muted      bool    `json:"muted"`
	Brightness float64 `json:"brightness"`
	NightLight        bool `json:"night_light"`
	CaffeineOn        bool `json:"caffeine_on"`
	CaffeineCustom    bool `json:"caffeine_custom"`
	CaffeineDuration  int  `json:"caffeine_duration"`
	BluetoothOn       bool `json:"bluetooth_on"`
	WarpOn       bool `json:"warp_on"`
	Sys        *SystemStats `json:"sys"`
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

	cpuPrevIdle  uint64
	cpuPrevTotal uint64
	cpuReady     bool

	pingOK bool
	pingMu sync.RWMutex
)

func main() {
	initConfig()
	buildCommandMap()

	// Serve frontend assets
	http.Handle("/", http.FileServer(http.Dir(".")))

	// API Routes
	http.HandleFunc("/api/auth", handleAuth)
	http.HandleFunc("/api/command", handleCommand)
	http.HandleFunc("/seek", handleSeek)
	http.HandleFunc("/api/set-volume", handleSetVolume)
	http.HandleFunc("/api/set-brightness", handleSetBrightness)
	http.HandleFunc("/media-stream", handleSSE)
	http.HandleFunc("/api/clipboard/pull", handleClipboardPull)
	http.HandleFunc("/api/clipboard/push", handleClipboardPush)
	http.HandleFunc("/api/audio/sinks", handleGetSinks)
	http.HandleFunc("/api/audio/set-sink", handleSetSink)
	http.HandleFunc("/api/audio-stream/stream", handleStreamPlay)
	http.HandleFunc("/api/audio-stream/ws", handleStreamWS)
	http.HandleFunc("/api/audio-stream/status", handleStreamStatus)

	// Background ticker to broadcast MPRIS state to connected web decks
	go startMediaBroadcaster()
	go startPingChecker()

	pingTarget := appCfg.PingTarget
	if pingTarget == "" {
		pingTarget = "8.8.8.8"
	}

	port := fmt.Sprintf(":%d", appCfg.HTTPPort)
	if appCfg.HTTPPort == 0 {
		port = ":8080"
	}
	log.Printf("Control Deck running on http://localhost%s\n", port)

	// TLS server for PWA (Chrome requires HTTPS for display: standalone)
	go func() {
		httpsPort := fmt.Sprintf(":%d", appCfg.HTTPSPort)
		if appCfg.HTTPSPort == 0 {
			httpsPort = ":8443"
		}
		log.Printf("HTTPS on https://localhost%s (accept self-signed cert once)", httpsPort)
		if err := http.ListenAndServeTLS(httpsPort, "server.crt", "server.key", nil); err != nil {
			log.Printf("TLS server: %v", err)
		}
	}()

	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		PIN string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": req.PIN == dashPIN})
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
		if cmdArgs[0] == "playerctl" && len(cmdArgs) > 1 {
			p := findBestPlayer()
			if p != "" && p != cmdArgs[1] {
				cmdArgs = append([]string{cmdArgs[0], "--player", p}, cmdArgs[1:]...)
			}
		}
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
		p := findBestPlayer()
		if p == "" {
			return
		}
		cmd := exec.Command("playerctl", "--player", p, "position", fmt.Sprintf("%f", pos))
		if err := cmd.Run(); err != nil {
			log.Printf("Error seeking to %f: %v", pos, err)
		}
	}(req.Position)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleSetVolume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Volume float64 `json:"volume"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	go func(v float64) {
		cmd := exec.Command("wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", fmt.Sprintf("%f", v))
		if err := cmd.Run(); err != nil {
			log.Printf("Error setting volume: %v", err)
		}
	}(req.Volume)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func handleSetBrightness(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Brightness float64 `json:"brightness"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	go func(v float64) {
		cmd := exec.Command("brightnessctl", "set", fmt.Sprintf("%d%%", int(v)))
		if err := cmd.Run(); err != nil {
			log.Printf("Error setting brightness: %v", err)
		}
	}(req.Brightness)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func parseVolume(out string) (vol float64, muted bool) {
	out = strings.TrimSpace(out)
	if !strings.HasPrefix(out, "Volume: ") {
		return 0, false
	}
	rest := strings.TrimPrefix(out, "Volume: ")
	if strings.HasSuffix(rest, " [MUTED]") {
		muted = true
		rest = strings.TrimSuffix(rest, " [MUTED]")
	}
	vol, err := strconv.ParseFloat(rest, 64)
	if err != nil {
		return 0, false
	}
	return vol, muted
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

func runCmd(cmd string, args ...string) (string, error) {
	out, err := exec.Command(cmd, args...).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func runPlayerctl(args ...string) (string, error) {
	return runCmd("playerctl", args...)
}

// findBestPlayer lists all MPRIS players, scores them, and returns the most
// likely real-media-player (prefers Playing + non-trivial title + non-zero
// length over browser tabs like the dashboard page itself).
func findBestPlayer() string {
	out, err := runCmd("playerctl", "-l")
	if err != nil || out == "" {
		return ""
	}
	players := strings.Fields(out)
	if len(players) == 1 {
		return players[0]
	}

	type candidate struct {
		name   string
		score  int
		status string
		title  string
	}
	var cands []candidate

	for _, p := range players {
		status, _ := runCmd("playerctl", "--player", p, "status")
		title, _ := runCmd("playerctl", "--player", p, "metadata", "xesam:title")
		lenRaw, _ := runCmd("playerctl", "--player", p, "metadata", "mpris:length")
		var length float64
		if l, err := strconv.ParseFloat(strings.TrimSpace(lenRaw), 64); err == nil {
			length = l
		}

		score := 0
		if status == "Playing" {
			score += 10
		} else if status == "Paused" {
			score += 5
		}
		if len(title) > 0 && title != "Control Deck" {
			score += 3
		}
		if len(title) > 10 {
			score += 2
		}
		if length > 1000000 {
			score += 3
		}

		cands = append(cands, candidate{name: p, score: score, status: status, title: title})
	}

	best := cands[0]
	for _, c := range cands[1:] {
		if c.score > best.score {
			best = c
		}
	}

	return best.name
}

// runPlayerctlBest runs playerctl targeting the best (most likely real) player.
func runPlayerctlBest(args ...string) (string, error) {
	p := findBestPlayer()
	if p == "" {
		return "", fmt.Errorf("no player found")
	}
	cmdArgs := append([]string{"--player", p}, args...)
	return runCmd("playerctl", cmdArgs...)
}

func startPingChecker() {
	target := appCfg.PingTarget
	if target == "" {
		target = "8.8.8.8"
	}
	for {
		err := exec.Command("ping", "-c", "1", "-W", "2", target).Run()
		pingMu.Lock()
		pingOK = err == nil
		pingMu.Unlock()
		time.Sleep(5 * time.Second)
	}
}

func getCPUPercent() float64 {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return -1
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) == 0 {
		return -1
	}
	fields := strings.Fields(lines[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return -1
	}
	var idle, total uint64
	for i, f := range fields[1:] {
		v, _ := strconv.ParseUint(f, 10, 64)
		total += v
		if i == 3 {
			idle = v
		}
	}
	if !cpuReady {
		cpuPrevIdle = idle
		cpuPrevTotal = total
		cpuReady = true
		return 50
	}
	deltaIdle := idle - cpuPrevIdle
	deltaTotal := total - cpuPrevTotal
	cpuPrevIdle = idle
	cpuPrevTotal = total
	if deltaTotal == 0 {
		return 0
	}
	return float64(deltaTotal-deltaIdle) / float64(deltaTotal) * 100
}

func getRAMPercent() float64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return -1
	}
	var total, available float64
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				total, _ = strconv.ParseFloat(fields[1], 64)
			}
		}
		if strings.HasPrefix(line, "MemAvailable:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				available, _ = strconv.ParseFloat(fields[1], 64)
			}
		}
	}
	if total == 0 {
		return -1
	}
	return (total - available) / total * 100
}

func getBattery() (percent float64, charging bool) {
	ents, err := os.ReadDir("/sys/class/power_supply")
	if err != nil {
		return -1, false
	}
	for _, e := range ents {
		if !strings.HasPrefix(e.Name(), "BAT") {
			continue
		}
		base := "/sys/class/power_supply/" + e.Name()
		capStr, err := os.ReadFile(base + "/capacity")
		if err != nil {
			continue
		}
		percent, _ = strconv.ParseFloat(strings.TrimSpace(string(capStr)), 64)
		statusStr, err := os.ReadFile(base + "/status")
		if err == nil {
			charging = strings.TrimSpace(string(statusStr)) == "Charging"
		}
		return percent, charging
	}
	return -1, false
}

func getTemp() float64 {
	zones := []string{"thermal_zone0", "thermal_zone1"}
	for _, z := range zones {
		data, err := os.ReadFile("/sys/class/thermal/" + z + "/temp")
		if err != nil {
			continue
		}
		millideg, _ := strconv.ParseFloat(strings.TrimSpace(string(data)), 64)
		return millideg / 1000.0
	}
	return -1
}

func getSSID() string {
	s, _ := runCmd("iwgetid", "-r")
	return s
}

func getIP() string {
	data, err := runCmd("hostname", "-I")
	if err != nil || data == "" {
		return ""
	}
	return strings.Fields(data)[0]
}

func fetchSystemStats() *SystemStats {
	cpu := getCPUPercent()
	ram := getRAMPercent()
	bat, charging := getBattery()
	temp := getTemp()
	ssid := getSSID()
	ip := getIP()
	pingMu.RLock()
	pOK := pingOK
	pingMu.RUnlock()

	if cpu < 0 && ram < 0 && bat < 0 && temp < 0 && ssid == "" && ip == "" {
		return nil
	}
	return &SystemStats{
		CPU:      cpu,
		RAM:      ram,
		Battery:  bat,
		Charging: charging,
		Temp:     temp,
		SSID:     ssid,
		IP:       ip,
		PingOK:   pOK,
	}
}

func fetchMPRISState() MediaState {
	title, _ := runPlayerctlBest("metadata", "xesam:title")
	artist, _ := runPlayerctlBest("metadata", "xesam:artist")
	status, _ := runPlayerctlBest("status")

	lenStr, lenErr := runPlayerctlBest("metadata", "mpris:length")
	var length float64
	if lenErr == nil {
		if l, e := strconv.ParseFloat(lenStr, 64); e == nil {
			length = l / 1000000.0
		}
	}
	if length < 0 || !isFinite(length) {
		length = 0
	}

	posStr, posErr := runPlayerctlBest("position")
	var posSeconds float64
	if posErr == nil {
		posSeconds, _ = strconv.ParseFloat(posStr, 64)
	}
	if posSeconds < 0 || !isFinite(posSeconds) {
		posSeconds = 0
	}

	artStr, _ := runPlayerctlBest("metadata", "mpris:artUrl")

	volOut, volErr := runCmd("wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@")
	var volume float64 = -1
	var muted bool
	if volErr == nil {
		volume, muted = parseVolume(volOut)
	}

	brightness := -1.0
	getOut, getErr := runCmd("brightnessctl", "get")
	maxOut, maxErr := runCmd("brightnessctl", "max")
	if getErr == nil && maxErr == nil {
		cur, e1 := strconv.ParseFloat(getOut, 64)
		max, e2 := strconv.ParseFloat(maxOut, 64)
		if e1 == nil && e2 == nil && max > 0 {
			brightness = (cur / max) * 100
		}
	}

	nightStr, _ := runCmd("gsettings", "get", "org.gnome.settings-daemon.plugins.color", "night-light-enabled")
	nightLight := nightStr == "true"

	caffeineOnStr, _ := runCmd("gsettings", "--schemadir", caffeineSD, "get", "org.gnome.shell.extensions.caffeine", "cli-toggle")
	caffeineOn := caffeineOnStr == "true"
	caffeineCustomStr, _ := runCmd("gsettings", "--schemadir", caffeineSD, "get", "org.gnome.shell.extensions.caffeine", "use-custom-duration")
	caffeineCustom := caffeineCustomStr == "true"
	caffeineDurStr, _ := runCmd("gsettings", "--schemadir", caffeineSD, "get", "org.gnome.shell.extensions.caffeine", "duration-timer")
	caffeineDur, _ := strconv.Atoi(strings.TrimSpace(caffeineDurStr))

	btOut, _ := runCmd("rfkill", "list", "bluetooth")
	btOn := strings.Contains(btOut, "Soft blocked: no")

	warpOut, _ := runCmd("warp-cli", "status")
	warpOn := strings.Contains(warpOut, "Connected")

	return MediaState{
		Title:       title,
		Artist:      artist,
		Status:      status,
		ArtURL:      resolveArtURL(artStr),
		Position:    posSeconds,
		Length:      length,
		Volume:      volume,
		Muted:       muted,
		Brightness:  brightness,
		NightLight:       nightLight,
		CaffeineOn:       caffeineOn,
		CaffeineCustom:   caffeineCustom,
		CaffeineDuration: caffeineDur,
		BluetoothOn:      btOn,
		WarpOn:      warpOn,
		Sys:         fetchSystemStats(),
	}
}
