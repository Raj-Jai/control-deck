package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

func isFinite(v float64) bool {
	return !math.IsInf(v, 0) && !math.IsNaN(v)
}

var dashPIN string
var caffeineSD string
var commandMap map[string][]string
var (
	adPending struct {
		sync.Mutex
		player string
		length float64
		setAt  time.Time
	}
)

var speedSteps = []float64{0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2}

var (
	speedMu         sync.RWMutex
	currentSpeedIdx int = 3 // index 3 = 1.0x
)

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
		"seekBack10":     {"playerctl", "position", "10-"},
		"seekFwd10":      {"playerctl", "position", "10+"},

		"fullscreen":     {os.Getenv("HOME") + "/.local/bin/tab-dashboard-sendkey", "f"},
		"captions":       {os.Getenv("HOME") + "/.local/bin/tab-dashboard-sendkey", "c"},
		"volUp":          {"wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%+"},
		"volDown":        {"wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "5%-"},
		"mute":           {"wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"},
		"brightnessUp":   {"brightnessctl", "set", "+10%"},
		"brightnessDown": {"brightnessctl", "set", "10%-"},
		"lock":           {"loginctl", "lock-session"},
		"bluetoothOn":    {"rfkill", "unblock", "bluetooth"},
		"bluetoothOff":   {"rfkill", "block", "bluetooth"},
		"btSinkOn":       {"sh", "-c", "bluetoothctl discoverable on && bluetoothctl pairable on"},
		"btSinkOff":      {"bluetoothctl", "discoverable", "off"},
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

// buildProfileCommandMap adds profile-specific commands to the global commandMap.
func buildProfileCommandMap() {
	sk := os.Getenv("HOME") + "/.local/bin/tab-dashboard-sendkey"

	profileCmds := map[string][]string{
		// IDE: Debugger keys (F5, F10, F11, Shift+F5)
		"dbg_continue":      {sk, "F5"},
		"dbg_step_over":     {sk, "F10"},
		"dbg_step_into":     {sk, "F11"},
		"dbg_step_out":      {"sh", "-c", sk + " F5"}, // Shift+F5 — handled below
		"dbg_stop":          {"sh", "-c", sk + " F5"}, // Shift+F5
		"dbg_restart":       {"sh", "-c", sk + " F5"}, // Ctrl+Shift+F5 via loop
		"dbg_toggle_break":  {"sh", "-c", "playerctl --player $PLAYER play-pause 2>/dev/null || true"},
		"dbg_clear_all":     {"sh", "-c", sk + " F9"},

		// IDE: Git aliases
		"git_stage":  {"bash", "-c", "git add -A && git status -s"},
		"git_commit": {"bash", "-c", "git commit -m 'dashboard commit' && git push"},
		"git_push":   {"bash", "-c", "git push"},
		"git_pull":   {"bash", "-c", "git pull --rebase"},
		"git_reset":  {"bash", "-c", "git reset HEAD~1"},
		"git_stash":  {"bash", "-c", "git stash"},

		// IDE: Tasks
		"task_build": {"bash", "-c", "npm run build 2>/dev/null || make 2>/dev/null || cargo build 2>/dev/null || echo 'no build tool found'"},
		"task_test":  {"bash", "-c", "npm test 2>/dev/null || go test ./... 2>/dev/null || cargo test 2>/dev/null || echo 'no test tool found'"},
		"task_lint":  {"bash", "-c", "npm run lint 2>/dev/null || ruff check . 2>/dev/null || echo 'no linter found'"},
		"task_dev":   {"bash", "-c", "npm run dev 2>/dev/null || echo 'no dev script found'"},

		// Terminal: Cursor keys
		"key_up":    {sk, "up"},
		"key_down":  {sk, "down"},
		"key_left":  {sk, "left"},
		"key_right": {sk, "right"},
		"key_esc":   {sk, "esc"},
		"key_tab":   {sk, "tab"},
		"key_enter": {sk, "enter"},

		// Media: YouTube shortcut keys
		"key_j": {sk, "j"},
		"key_k": {sk, "k"},
		"key_l": {sk, "l"},
		"key_m": {sk, "m"},
		"key_t": {sk, "t"},
		"key_c": {sk, "c"},
		"key_space": {sk, "space"},

		// Terminal: Ctrl+key combos (via sendkey)
		"key_ctrl_c": {sk, "ctrl_c"},
		"key_ctrl_z": {sk, "ctrl_z"},
		"key_ctrl_d": {sk, "ctrl_d"},
		"key_ctrl_l": {sk, "ctrl_l"},
		"key_ctrl_a": {sk, "ctrl_a"},
		"key_ctrl_e": {sk, "ctrl_e"},
		"key_ctrl_w": {sk, "ctrl_w"},
		"key_ctrl_u": {sk, "ctrl_u"},

		// Tmux
		"tmux_pane_l":  {"bash", "-c", "tmux select-pane -L 2>/dev/null || true"},
		"tmux_pane_r":  {"bash", "-c", "tmux select-pane -R 2>/dev/null || true"},
		"tmux_pane_u":  {"bash", "-c", "tmux select-pane -U 2>/dev/null || true"},
		"tmux_pane_d":  {"bash", "-c", "tmux select-pane -D 2>/dev/null || true"},
		"tmux_split_h": {"bash", "-c", "tmux split-window -h 2>/dev/null || true"},
		"tmux_split_v": {"bash", "-c", "tmux split-window -v 2>/dev/null || true"},
		"tmux_new_win": {"bash", "-c", "tmux new-window 2>/dev/null || true"},
		"tmux_win_prev": {"bash", "-c", "tmux previous-window 2>/dev/null || true"},
		"tmux_win_next": {"bash", "-c", "tmux next-window 2>/dev/null || true"},

		// Speed — handled by handleSpeedCommand (intercepted before commandMap lookup)
		"speed_up":   {"sh", "-c", ":"},
		"speed_down": {"sh", "-c", ":"},
		"speed_0.25": {"sh", "-c", ":"},
		"speed_0.5":  {"sh", "-c", ":"},
		"speed_0.75": {"sh", "-c", ":"},
		"speed_1":    {"sh", "-c", ":"},
		"speed_1.25": {"sh", "-c", ":"},
		"speed_1.5":  {"sh", "-c", ":"},
		"speed_1.75": {"sh", "-c", ":"},
		"speed_2":    {"sh", "-c", ":"},

		// Video player sync
		"aspect_default": {"bash", "-c", sk + " v"},
		"sub_delay_":     {"bash", "-c", sk + " v"}, // placeholder — YouTube uses 'v' for captions
	}

	for k, v := range profileCmds {
		if _, exists := commandMap[k]; !exists {
			commandMap[k] = v
		}
	}
}

type SystemStats struct {
	CPU       float64 `json:"cpu"`
	RAM       float64 `json:"ram"`
	RAMUsed   float64 `json:"ram_used"`
	RAMTotal  float64 `json:"ram_total"`
	Battery   float64 `json:"battery"`
	Charging  bool    `json:"charging"`
	Temp      float64 `json:"temp"`
	SSID      string  `json:"ssid"`
	IP        string  `json:"ip"`
	PingOK    bool    `json:"ping_ok"`
	GPU       *GPUStats `json:"gpu,omitempty"`
}

type MediaState struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Status   string  `json:"status"`
	ArtURL   string  `json:"art_url"`
	Position float64 `json:"position"`
	Length   float64 `json:"length"`
	Lyrics   *LyricData `json:"lyrics,omitempty"`
	Volume     float64 `json:"volume"`
	Muted      bool    `json:"muted"`
	Brightness float64 `json:"brightness"`
	NightLight        bool   `json:"night_light"`
	CaffeineOn        bool   `json:"caffeine_on"`
	CaffeineCustom    bool   `json:"caffeine_custom"`
	CaffeineDuration  int    `json:"caffeine_duration"`
	BluetoothOn       bool   `json:"bluetooth_on"`
	WarpOn            bool   `json:"warp_on"`
	BTSinkOn          bool   `json:"bt_sink_on"`
	AudioStreamActive bool         `json:"audio_stream_active"`
	Players           []PlayerState `json:"players"`
	Sinks             []Sink        `json:"sinks"`
	AppStreams        []AppStream   `json:"app_streams"`
	Sys               *SystemStats  `json:"sys"`
	CmdLog            []LogEntry    `json:"cmd_log"`
}

type PlayerState struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Status   string  `json:"status"`
	ArtURL   string  `json:"art_url"`
	Position float64 `json:"position"`
	Length   float64 `json:"length"`
}

type CommandRequest struct {
	Command string `json:"command"`
	Player  string `json:"player,omitempty"`
}

type SeekRequest struct {
	Position float64 `json:"position"`
	Player   string  `json:"player,omitempty"`
}

type LogEntry struct {
	Time    string `json:"time"`
	Command string `json:"command"`
}

var (
	clients      = make(map[chan string]bool)
	clientsMu    sync.Mutex
	artCachePath string
	artCacheData string

	winClients   = make(map[chan string]bool)
	winClientsMu sync.Mutex

	connectedClients   = make(map[string]*ConnectedClient)
	connectedClientsMu sync.RWMutex

	sseDeviceChans   = make(map[string]chan string)
	sseDeviceChansMu sync.RWMutex

	cmdLog   []LogEntry
	cmdLogMu sync.Mutex

	cpuPrevIdle  uint64
	cpuPrevTotal uint64
	cpuReady     bool

	pingOK bool
	pingMu sync.RWMutex

	lastWMClass string
	lastTitle   string
	windowMu    sync.Mutex

	mediaPlaying       bool
	mediaPlayingPlayer string
	mediaPlayingMu     sync.RWMutex

	broadcasting   bool
	broadcastingMu sync.Mutex

	syncBroadcastOn  bool
	syncBroadcastMu  sync.Mutex
	syncNullModule   uint32
	syncLoopModule   uint32
	syncRealSink     string
)

type ConnectedClient struct {
	IP        string    `json:"ip"`
	UA        string    `json:"ua"`
	Connected time.Time `json:"connected"`
	LastSeen  time.Time `json:"last_seen"`
	Path      string    `json:"path"`
	DeviceID  string    `json:"device_id"`
	Streaming bool      `json:"streaming"`
}

const clientTTL = 3 * time.Second

func trackClient(r *http.Request, deviceID string) {
	ip := r.RemoteAddr
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		ip = strings.Split(fwd, ",")[0]
	}
	key := ip + "|" + r.UserAgent()
	now := time.Now()
	deviceAudioWSMu.Lock()
	_, streaming := deviceAudioWS[deviceID]
	deviceAudioWSMu.Unlock()
	connectedClientsMu.Lock()
	if existing, ok := connectedClients[key]; ok {
		existing.LastSeen = now
		existing.DeviceID = deviceID
		existing.Path = r.URL.Path
		existing.Streaming = streaming
	} else {
		connectedClients[key] = &ConnectedClient{
			IP:        ip,
			UA:        r.UserAgent(),
			Connected: now,
			LastSeen:  now,
			Path:      r.URL.Path,
			DeviceID:  deviceID,
			Streaming: streaming,
		}
	}
	connectedClientsMu.Unlock()
}

func cleanupClients() {
	for {
		time.Sleep(15 * time.Second)
		now := time.Now()
		connectedClientsMu.Lock()
		for k, c := range connectedClients {
			if now.Sub(c.LastSeen) > clientTTL {
				delete(connectedClients, k)
			}
		}
		connectedClientsMu.Unlock()
	}
}

func addLog(cmd string) {
	cmdLogMu.Lock()
	defer cmdLogMu.Unlock()
	cmdLog = append(cmdLog, LogEntry{
		Time:    time.Now().Format("15:04:05"),
		Command: cmd,
	})
	if len(cmdLog) > 30 {
		cmdLog = cmdLog[len(cmdLog)-30:]
	}
}

func main() {
	initConfig()
	initVideoPlayerConfig()
	buildCommandMap()
	buildProfileCommandMap()
	initVideoPlayerConfig()

	// Serve frontend assets
	http.Handle("/", trackMiddleware(http.FileServer(http.Dir("."))))

	// API Routes
	http.HandleFunc("/api/capabilities", handleCapabilities)
	http.HandleFunc("/api/auth", handleAuth)
	http.HandleFunc("/api/command", handleCommand)
	http.HandleFunc("/api/clients", handleClients)
	http.HandleFunc("/api/stream/control", handleStreamControl)
	http.HandleFunc("/api/stream/broadcast", handleStreamBroadcast)
	http.HandleFunc("/seek", handleSeek)
	http.HandleFunc("/api/set-volume", handleSetVolume)
	http.HandleFunc("/api/set-brightness", handleSetBrightness)
	http.HandleFunc("/media-stream", handleSSE)
	http.HandleFunc("/api/clipboard/pull", handleClipboardPull)
	http.HandleFunc("/api/clipboard/push", handleClipboardPush)
	http.HandleFunc("/api/audio/sinks", handleGetSinks)
	http.HandleFunc("/api/audio/set-sink", handleSetSink)
	http.HandleFunc("/api/audio/app-streams", handleGetAppStreams)
	http.HandleFunc("/api/audio/set-app-stream", handleSetAppStream)

	http.HandleFunc("/api/audio-stream/ws", handleStreamWS)
	http.HandleFunc("/api/audio-stream/status", handleStreamStatus)
	http.HandleFunc("/api/window-stream", handleWindowSSE)
	http.HandleFunc("/api/video/status", handleVideoStatus)
	http.HandleFunc("/api/video/command", handleVideoCommand)
	http.HandleFunc("/api/service-stats", handleServiceStats)
	http.HandleFunc("/ws/terminal", handleTerminalWS)

	// Background tickers
	go startMediaBroadcaster()
	go cleanupClients()
	go startPingChecker()
	go startWindowWatcher()

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

func handleCapabilities(w http.ResponseWriter, r *http.Request) {
	caps := map[string]bool{
		"caffeine":    checkCaffeine(),
		"bluetooth":   checkBluetooth(),
		"warp":        checkBinary("warp-cli"),
		"erp":         checkBinary("erp"),
		"night_light": checkNightLight(),
		"brightness":  checkBinary("brightnessctl"),
		"clipboard":   checkBinary("wl-copy") || checkBinary("xclip"),
		"ffmpeg":      checkBinary("ffmpeg"),
		"playerctl":   checkBinary("playerctl"),
		"battery":     checkBattery(),
		"mpv_socket":  checkMPVSocket(),
		"vlc_http":    checkVLCInterface(),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(caps)
}

func checkBinary(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func checkCaffeine() bool {
	sd := caffeineSD
	if sd == "" {
		sd = os.Getenv("HOME") + "/.local/share/gnome-shell/extensions/caffeine@patapon.info/schemas"
	}
	out, err := exec.Command("gsettings", "--schemadir", sd, "list-schemas").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "org.gnome.shell.extensions.caffeine")
}

func checkNightLight() bool {
	out, err := exec.Command("gsettings", "list-schemas").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "org.gnome.settings-daemon.plugins.color")
}

func checkBluetooth() bool {
	if !checkBinary("rfkill") {
		return false
	}
	out, _ := exec.Command("rfkill", "list", "bluetooth").Output()
	return len(out) > 0
}

func checkMPVSocket() bool {
	conn, err := net.DialTimeout("unix", "/tmp/mpvsocket", 200*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func checkVLCInterface() bool {
	resp, err := http.Get("http://localhost:8080/requests/status.json")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

func checkBattery() bool {
	ents, err := os.ReadDir("/sys/class/power_supply")
	if err != nil {
		return false
	}
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), "BAT") {
			return true
		}
	}
	return false
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

	// Intercept speed commands for the shift+. / shift+, state machine
	if strings.HasPrefix(req.Command, "speed_") {
		addLog("▶ " + req.Command)
		go handleSpeedCommand(req.Command)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "executed": req.Command})
		return
	}

	args, exists := commandMap[req.Command]
	if !exists {
		http.Error(w, "Unknown command", http.StatusBadRequest)
		return
	}

	addLog("▶ " + req.Command)

	sendkeyBin := os.Getenv("HOME") + "/.local/bin/tab-dashboard-sendkey"

		go func(cmdArgs []string) {
			p := req.Player
			if p == "" {
				p = findBestPlayer()
			}
			if cmdArgs[0] == "playerctl" && len(cmdArgs) > 1 {
				if p != "" && p != cmdArgs[1] {
					cmdArgs = append([]string{cmdArgs[0], "--player", p}, cmdArgs[1:]...)
				}
			} else if (req.Command == "fullscreen" || req.Command == "captions") && cmdArgs[0] == sendkeyBin {
				if p != "" {
					cmdArgs = []string{cmdArgs[0], cmdArgs[1], p}
				}
			}
			cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
			cmd.Env = append(os.Environ(), "PLAYER="+p, "PLAYER_BUS=org.mpris.MediaPlayer2."+p)
			if out, err := cmd.CombinedOutput(); err != nil {
				log.Printf("Error executing %v: %v | Output: %s", cmdArgs, err, string(out))
			}
		}(args)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "executed": req.Command})
}

// handleSpeedCommand implements a Shift+. / Shift+, state machine matching YouTube's
// native 8-speed step array. Accepts:
//   speed_up       — increment one step
//   speed_down     — decrement one step
//   speed_<float>  — jump to exact step (e.g. speed_1.5)
// It sends the required number of shift+. / shift+, keystrokes with 55ms spacing,
// then broadcasts the updated speed via the window SSE.
func handleSpeedCommand(cmd string) {
	suffix := strings.TrimPrefix(cmd, "speed_")

	speedMu.RLock()
	cur := currentSpeedIdx
	speedMu.RUnlock()

	targetIdx := -1

	switch suffix {
	case "up":
		targetIdx = cur + 1
		if targetIdx >= len(speedSteps) {
			targetIdx = len(speedSteps) - 1
		}
	case "down":
		targetIdx = cur - 1
		if targetIdx < 0 {
			targetIdx = 0
		}
	default:
		target, err := strconv.ParseFloat(suffix, 64)
		if err != nil {
			return
		}
		for i, s := range speedSteps {
			if math.Abs(s-target) < 0.001 {
				targetIdx = i
				break
			}
		}
	}

	if targetIdx < 0 || targetIdx == cur {
		return
	}

	sk := os.Getenv("HOME") + "/.local/bin/tab-dashboard-sendkey"
	delta := targetIdx - cur
	key := "shift_."
	if delta < 0 {
		key = "shift_,"
		delta = -delta
	}

	for i := 0; i < delta; i++ {
		exec.Command(sk, key).Run()
		time.Sleep(55 * time.Millisecond)
	}

	speedMu.Lock()
	currentSpeedIdx = targetIdx
	speedMu.Unlock()

	addLog(fmt.Sprintf("speed → %.2fx (delta %d, key %s)", speedSteps[targetIdx], targetIdx-cur, key))

	// Broadcast through window SSE
	evt := map[string]interface{}{
		"event": "YT_SPEED_UPDATED",
		"speed": speedSteps[targetIdx],
	}
	if d, err := json.Marshal(evt); err == nil {
		winClientsMu.Lock()
		msg := string(d)
		for ch := range winClients {
			select {
			case ch <- msg:
			default:
			}
		}
		winClientsMu.Unlock()
	}
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

	addLog(fmt.Sprintf("seek %.1fs", req.Position))

	go func(pos float64) {
		p := req.Player
		if p == "" {
			p = findBestPlayer()
		}
		if p == "" {
			return
		}
		cmd := exec.Command("playerctl", "--player", p, "position", fmt.Sprintf("%f", pos))
		if err := cmd.Run(); err != nil {
			log.Printf("Error seeking to %f: %v", pos, err)
		}
		broadcastState()
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
	addLog(fmt.Sprintf("volume %.0f%%", req.Volume*100))

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
	addLog(fmt.Sprintf("brightness %.0f%%", req.Brightness))

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

	deviceID := r.URL.Query().Get("device_id")
	trackClient(r, deviceID)
	messageChan := make(chan string)

	clientsMu.Lock()
	clients[messageChan] = true
	clientsMu.Unlock()

	if deviceID != "" {
		sseDeviceChansMu.Lock()
		sseDeviceChans[deviceID] = messageChan
		sseDeviceChansMu.Unlock()
	}

	defer func() {
		clientsMu.Lock()
		delete(clients, messageChan)
		clientsMu.Unlock()
		if deviceID != "" {
			sseDeviceChansMu.Lock()
			if sseDeviceChans[deviceID] == messageChan {
				delete(sseDeviceChans, deviceID)
			}
			sseDeviceChansMu.Unlock()
		}
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

func trackMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			trackClient(r, r.URL.Query().Get("device_id"))
		}
		next.ServeHTTP(w, r)
	})
}

func handleClients(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	trackClient(r, r.URL.Query().Get("device_id"))
	connectedClientsMu.RLock()
	list := make([]*ConnectedClient, 0, len(connectedClients))
	deviceAudioWSMu.Lock()
	for _, c := range connectedClients {
		_, c.Streaming = deviceAudioWS[c.DeviceID]
		list = append(list, c)
	}
	deviceAudioWSMu.Unlock()
	connectedClientsMu.RUnlock()
	broadcastingMu.Lock()
	bc := broadcasting
	broadcastingMu.Unlock()
	syncBroadcastMu.Lock()
	sb := syncBroadcastOn
	syncBroadcastMu.Unlock()
	json.NewEncoder(w).Encode(map[string]any{
		"count":          len(list),
		"clients":        list,
		"broadcasting":   bc,
		"sync_broadcast": sb,
	})
}

func handleStreamControl(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Target string `json:"target"`
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	log.Printf("stream/control: action=%s target=%s", req.Action, req.Target)
	sseDeviceChansMu.RLock()
	ch, ok := sseDeviceChans[req.Target]
	sseDeviceChansMu.RUnlock()
	log.Printf("stream/control: sse channel found=%v (total channels=%d)", ok, len(sseDeviceChans))
	switch req.Action {
	case "start":
		if !ok {
			http.Error(w, "device not connected", http.StatusNotFound)
			return
		}
		select {
		case ch <- `{"type":"stream_command","action":"start"}`:
			log.Printf("stream/control: sent start to %s", req.Target)
		default:
			log.Printf("stream/control: channel full for %s", req.Target)
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	case "stop":
		stopped := remoteStopStream(req.Target)
		sseDeviceChansMu.RLock()
		ch, hasSSE := sseDeviceChans[req.Target]
		sseDeviceChansMu.RUnlock()
		if hasSSE {
			select {
			case ch <- `{"type":"stream_command","action":"stop"}`:
			default:
			}
		}
		if stopped || hasSSE {
			json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		} else {
			http.Error(w, "device not found", http.StatusNotFound)
		}
	default:
		http.Error(w, "unknown action", http.StatusBadRequest)
	}
}

func handleStreamBroadcast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Action string `json:"action"`
		Sync   bool   `json:"sync"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	switch req.Action {
	case "start":
		sseDeviceChansMu.RLock()
		hasClients := len(sseDeviceChans) > 0
		sseDeviceChansMu.RUnlock()
		if !hasClients {
			http.Error(w, "no devices connected", http.StatusNotFound)
			return
		}

		if req.Sync {
			broadcastingMu.Lock()
			if broadcasting {
				broadcasting = false
				go exec.Command("wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "0").Run()
			}
			broadcastingMu.Unlock()

			syncBroadcastMu.Lock()
			if syncBroadcastOn {
				syncBroadcastMu.Unlock()
				http.Error(w, "sync broadcast already active", http.StatusConflict)
				return
			}
			realSink, err := getDefaultSink()
			if err != nil {
				syncBroadcastMu.Unlock()
				http.Error(w, "failed to get default sink", http.StatusInternalServerError)
				return
			}
			nullMod, err := runPactl("load-module", "module-null-sink", "sink_name=sync_broadcast")
			if err != nil {
				syncBroadcastMu.Unlock()
				http.Error(w, "failed to create null sink", http.StatusInternalServerError)
				return
			}
			loopMod, err := runPactl("load-module", "module-loopback",
				"source=sync_broadcast.monitor",
				"sink="+realSink,
				"latency_msec=400")
			if err != nil {
				pactlUnload(nullMod)
				syncBroadcastMu.Unlock()
				http.Error(w, "failed to create loopback", http.StatusInternalServerError)
				return
			}
			exec.Command("pactl", "set-default-sink", "sync_broadcast").Run()
			syncNullModule = nullMod
			syncLoopModule = loopMod
			syncRealSink = realSink
			syncBroadcastOn = true
			syncBroadcastMu.Unlock()
		} else {
			disableSyncBroadcast()

			go exec.Command("wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1").Run()
			broadcastingMu.Lock()
			broadcasting = true
			broadcastingMu.Unlock()
		}

		sseDeviceChansMu.RLock()
		for _, ch := range sseDeviceChans {
			select {
			case ch <- `{"type":"stream_command","action":"start"}`:
			default:
			}
		}
		sseDeviceChansMu.RUnlock()

		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	case "stop":
		disableSyncBroadcast()
		go exec.Command("wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "0").Run()
		broadcastingMu.Lock()
		broadcasting = false
		broadcastingMu.Unlock()

		remoteStopAllStreams()

		sseDeviceChansMu.RLock()
		for _, ch := range sseDeviceChans {
			select {
			case ch <- `{"type":"stream_command","action":"stop"}`:
			default:
			}
		}
		sseDeviceChansMu.RUnlock()

		if !req.Sync {
			broadcastingMu.Lock()
			broadcasting = false
			broadcastingMu.Unlock()
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	default:
		http.Error(w, "unknown action", http.StatusBadRequest)
	}
}

func getDefaultSink() (string, error) {
	out, err := exec.Command("pactl", "info").Output()
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "Default Sink:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "Default Sink:")), nil
		}
	}
	return "", fmt.Errorf("no default sink found")
}

func runPactl(args ...string) (uint32, error) {
	out, err := exec.Command("pactl", args...).Output()
	if err != nil {
		return 0, err
	}
	var id uint32
	fmt.Sscanf(strings.TrimSpace(string(out)), "%d", &id)
	return id, nil
}

func pactlUnload(id uint32) {
	exec.Command("pactl", "unload-module", fmt.Sprintf("%d", id)).Run()
}

func disableSyncBroadcast() {
	syncBroadcastMu.Lock()
	defer syncBroadcastMu.Unlock()
	if !syncBroadcastOn {
		return
	}
	if syncRealSink != "" {
		exec.Command("pactl", "set-default-sink", syncRealSink).Run()
	}
	if syncLoopModule != 0 {
		pactlUnload(syncLoopModule)
	}
	if syncNullModule != 0 {
		pactlUnload(syncNullModule)
	}
	syncBroadcastOn = false
	syncNullModule = 0
	syncLoopModule = 0
	syncRealSink = ""
}

func broadcastState() {
	state := fetchMPRISState()

	mediaPlayingMu.Lock()
	mediaPlaying = false
	mediaPlayingPlayer = ""
	for _, p := range state.Players {
		if p.Status == "Playing" {
			mediaPlaying = true
			mediaPlayingPlayer = p.ID
			break
		}
	}
	mediaPlayingMu.Unlock()

	clientsMu.Lock()
	clientCount := len(clients)
	clientsMu.Unlock()
	if clientCount == 0 {
		return
	}

	data, err := json.Marshal(state)
	if err != nil {
		return
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

// Polls MPRIS state via playerctl and broadcasts to SSE clients
func startMediaBroadcaster() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		broadcastState()
		checkAndSkipAds()
	}
}

func checkAndSkipAds() {
	adPending.Lock()
	p := adPending.player
	l := adPending.length
	adPending.player = ""
	adPending.length = 0
	adPending.Unlock()

	if p == "" || l <= 0 {
		return
	}

	addLog("ad-skip → seek end")
	log.Printf("ad-skip: seeking on %s to %.0fs", p, l)
	out, err := exec.Command("playerctl", "--player", p, "position",
		fmt.Sprintf("%f", l)).CombinedOutput()
	if err != nil {
		log.Printf("ad-skip: FAILED on %s: %v | %s", p, err, string(out))
	} else {
		log.Printf("ad-skip: OK on %s", p)
	}
}

// ─── Active Window Detection ──────────────────────────────────

type WindowFocusEvent struct {
	Event string `json:"event"`
	App   string `json:"app"`
	Title string `json:"title"`
}

var (
	browserWmClasses = []string{"chromium", "chrome", "firefox", "brave", "mozilla", "org.mozilla.firefox", "org.chromium.Chromium"}
	terminalWmClasses = []string{"gnome-terminal", "kitty", "alacritty", "termite", "foot", "wezterm", "konsole", "windows-terminal", "kgx", "ptyxis", "blackbox", "cool-retro-term"}
	ideWmClasses      = []string{"code", "code-oss", "jetbrains-idea", "jetbrains-pycharm", "jetbrains-webstorm", "jetbrains-goland", "idea", "pycharm", "webstorm", "goland", "android-studio"}
	videoWmClasses    = []string{"vlc", "mpv", "celluloid", "totem", "snapshop", "io.mpv", "org.videolan.vlc"}
)

func detectFocusedWindow() (string, string) {
	cls, title := detectByDBusExtension()
	if cls != "" {
		log.Printf("win detect: D-Bus extension → %s | %s", cls, title)
		return cls, title
	}

	cls, _ = detectByProcessList()
	log.Printf("win detect: process list → %s", cls)
	return cls, cls
}

func detectByDBusExtension() (string, string) {
	out, err := exec.Command("gdbus", "call", "--session",
		"--dest", "com.github.WindowFocus",
		"--object-path", "/com/github/WindowFocus",
		"--method", "com.github.WindowFocus.GetFocusedWindow").CombinedOutput()
	if err != nil {
		return "", ""
	}
	s := strings.TrimSpace(string(out))
	if !strings.HasPrefix(s, "(") || !strings.HasSuffix(s, ")") {
		return "", ""
	}
	inner := strings.TrimPrefix(s, "(")
	inner = strings.TrimSuffix(inner, ")")
	parts := strings.Split(inner, ", ")
	if len(parts) < 2 {
		return "", ""
	}
	cls := strings.Trim(parts[0], "' ")
	title := strings.Trim(parts[1], "' ")
	if cls == "" {
		return "", ""
	}
	return cls, title
}

func detectByProcessList() (string, string) {
	knownProcs := []struct {
		pattern string
		wmClass string
	}{
		{"chromium-browser", "chromium"},
		{"chromium", "chromium"},
		{"google-chrome", "chromium"},
		{"chrome", "chromium"},
		{"firefox", "firefox"},
		{"brave", "brave"},
		{"vlc", "vlc"},
		{"mpv", "mpv"},
		{"gnome-terminal", "gnome-terminal"},
		{"kitty", "kitty"},
		{"alacritty", "alacritty"},
		{"cool-retro-term", "cool-retro-term"},
		{"code-oss", "code"},
		{"code", "code"},
		{"jetbrains", "jetbrains"},
	}

	out, err := exec.Command("ps", "-eo", "comm", "--sort=-start_time").CombinedOutput()
	if err != nil {
		return "", ""
	}
	lines := strings.Split(string(out), "\n")

	for _, line := range lines {
		name := strings.TrimSpace(line)
		if name == "" || name == "COMMAND" {
			continue
		}
		lower := strings.ToLower(name)
		for _, p := range knownProcs {
			if strings.Contains(lower, p.pattern) {
				return p.wmClass, p.wmClass
			}
		}
	}
	return "", ""
}

// classifyApp maps a wm_class + title to one of: youtube, browser, vscode, terminal, default
func classifyApp(wmClass, title string) (string, string) {
	cls := strings.ToLower(wmClass)
	t := strings.ToLower(title)

	for _, b := range browserWmClasses {
		if strings.Contains(cls, b) {
			if strings.Contains(t, " - youtube") || strings.Contains(t, " - youtube music") {
				ytTitle := enrichYouTubeTitle(title)
				if ytTitle != "" {
					return "youtube", ytTitle
				}
				return "youtube", title
			}
			return "browser", title
		}
	}
	for _, i := range ideWmClasses {
		if strings.Contains(cls, i) {
			return "vscode", title
		}
	}
	for _, t := range terminalWmClasses {
		if strings.Contains(cls, t) {
			return "terminal", title
		}
	}
	for _, v := range videoWmClasses {
		if strings.Contains(cls, v) {
			return "video", title
		}
	}
	return "default", title
}

func enrichYouTubeTitle(windowTitle string) string {
	p := findBestPlayer()
	if p == "" {
		return ""
	}
	out, err := runCmd("playerctl", "--player", p, "metadata", "xesam:title")
	if err != nil || out == "" {
		return ""
	}
	lower := strings.ToLower(out)
	if strings.Contains(lower, "youtube") {
		return out
	}
	return ""
}

func startWindowWatcher() {
	go startDBusSignalListener()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		cls, rawTitle := detectFocusedWindow()
		if cls == "" {
			continue
		}
		app, title := classifyApp(cls, rawTitle)
		triggerFocusChange(app, title, cls)
	}
}

func startDBusSignalListener() {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		log.Printf("dbus signal: connect failed: %v", err)
		return
	}
	defer conn.Close()

	c := make(chan *dbus.Signal, 16)
	conn.Signal(c)

	match := "type='signal',interface='com.github.WindowFocus',member='FocusedWindowChanged'"
	call := conn.BusObject().Call("org.freedesktop.DBus.AddMatch", 0, match)
	if call.Err != nil {
		log.Printf("dbus signal: add match failed: %v", call.Err)
		return
	}

	log.Printf("dbus signal: listening for FocusedWindowChanged")

	for sig := range c {
		if len(sig.Body) < 2 {
			continue
		}
		cls, _ := sig.Body[0].(string)
		title, _ := sig.Body[1].(string)
		if cls == "" {
			continue
		}
		app, label := classifyApp(cls, title)
		log.Printf("dbus signal: %s | %s", app, label)
		triggerFocusChange(app, label, cls)
	}
}

func triggerFocusChange(app, title, wmClass string) {
	windowMu.Lock()
	changed := app != lastWMClass || title != lastTitle
	if changed {
		lastWMClass = app
		lastTitle = title
	}
	windowMu.Unlock()
	if changed {
		log.Printf("app focus changed: %s | %s (wm_class=%s)", app, title, wmClass)
		broadcastAppFocus(app, title)
	}
}

func broadcastAppFocus(app, title string) {
	evt := WindowFocusEvent{
		Event: "APP_FOCUS_CHANGED",
		App:   app,
		Title: title,
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	msg := string(data)

	winClientsMu.Lock()
	for ch := range winClients {
		select {
		case ch <- msg:
		default:
		}
	}
	winClientsMu.Unlock()
}

func handleWindowSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan string, 8)
	winClientsMu.Lock()
	winClients[ch] = true
	winClientsMu.Unlock()

	defer func() {
		winClientsMu.Lock()
		delete(winClients, ch)
		winClientsMu.Unlock()
		close(ch)
	}()

	windowMu.Lock()
	lastApp := lastWMClass
	lastT := lastTitle
	windowMu.Unlock()

	if lastApp != "" {
		evt := WindowFocusEvent{
			Event: "APP_FOCUS_CHANGED",
			App:   lastApp,
			Title: lastT,
		}
		if d, e := json.Marshal(evt); e == nil {
			ch <- string(d)
		}
	}

	speedMu.RLock()
	initSpeed := speedSteps[currentSpeedIdx]
	speedMu.RUnlock()
	if initSpeed > 0 {
		if d, e := json.Marshal(map[string]interface{}{
			"event": "YT_SPEED_UPDATED",
			"speed": initSpeed,
		}); e == nil {
			ch <- string(d)
		}
	}

	notify := r.Context().Done()
	for {
		select {
		case <-notify:
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
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

func getRAMStats() (pct, usedKB, totalKB float64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return -1, -1, -1
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
		return -1, -1, -1
	}
	used := total - available
	return used / total * 100, used, total
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
	ramPct, ramUsed, ramTotal := getRAMStats()
	bat, charging := getBattery()
	temp := getTemp()
	ssid := getSSID()
	ip := getIP()
	pingMu.RLock()
	pOK := pingOK
	pingMu.RUnlock()
	gpu := fetchGPUStats()

	if cpu < 0 && ramPct < 0 && bat < 0 && temp < 0 && ssid == "" && ip == "" && gpu == nil {
		return nil
	}
	return &SystemStats{
		CPU:      cpu,
		RAM:      ramPct,
		RAMUsed:  ramUsed,
		RAMTotal: ramTotal,
		Battery:  bat,
		Charging: charging,
		Temp:     temp,
		SSID:     ssid,
		IP:       ip,
		PingOK:   pOK,
		GPU:      gpu,
	}
}

func playerPrettyName(id string) string {
	if idx := strings.Index(id, "."); idx > 0 {
		return strings.Title(id[:idx])
	}
	return strings.Title(id)
}

func fetchPlayerState(player string) PlayerState {
	title, _ := runCmd("playerctl", "--player", player, "metadata", "xesam:title")
	artist, _ := runCmd("playerctl", "--player", player, "metadata", "xesam:artist")
	status, _ := runCmd("playerctl", "--player", player, "status")

	lenStr, _ := runCmd("playerctl", "--player", player, "metadata", "mpris:length")
	var length float64
	if l, e := strconv.ParseFloat(lenStr, 64); e == nil {
		length = l / 1000000.0
	}
	if length < 0 || !isFinite(length) {
		length = 0
	}

	posStr, _ := runCmd("playerctl", "--player", player, "position")
	var posSeconds float64
	if p, e := strconv.ParseFloat(posStr, 64); e == nil {
		posSeconds = p
	}
	if posSeconds < 0 || !isFinite(posSeconds) {
		posSeconds = 0
	}

	artStr, _ := runCmd("playerctl", "--player", player, "metadata", "mpris:artUrl")

	if length > 0 && status == "Playing" && title != "" {
		lower := strings.ToLower(title)
		if strings.Contains(lower, "advertisement") ||
			strings.Contains(lower, "sponsored") {
			adPending.Lock()
			if time.Since(adPending.setAt) > 2*time.Second {
				adPending.player = player
				adPending.length = length
				adPending.setAt = time.Now()
			}
			adPending.Unlock()
		}
	}

	return PlayerState{
		ID:       player,
		Name:     playerPrettyName(player),
		Title:    title,
		Artist:   artist,
		Status:   status,
		ArtURL:   resolveArtURL(artStr),
		Position: posSeconds,
		Length:   length,
	}
}

func fetchAllPlayers() []PlayerState {
	out, err := runCmd("playerctl", "-l")
	if err != nil || out == "" {
		return nil
	}
	ids := strings.Fields(out)
	players := make([]PlayerState, 0, len(ids))
	seen := make(map[string]bool)
	for _, id := range ids {
		base := id
		if idx := strings.LastIndex(id, "."); idx > 0 {
			base = id[:idx]
		}
		if seen[base] {
			continue
		}
		seen[base] = true
		ps := fetchPlayerState(id)
		players = append(players, ps)
	}
	return players
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

	btShow, _ := runCmd("bluetoothctl", "show")
	btSinkOn := strings.Contains(btShow, "Discoverable: yes")

	warpOut, _ := runCmd("warp-cli", "status")
	warpOn := strings.Contains(warpOut, "Connected")

	streamMgr.mu.Lock()
	streamActive := len(streamMgr.listeners) > 0
	streamMgr.mu.Unlock()

	sinks, _ := fetchSinks()
	appStreams := fetchAppStreams()
	players := fetchAllPlayers()

	cmdLogMu.Lock()
	logCopy := make([]LogEntry, len(cmdLog))
	copy(logCopy, cmdLog)
	cmdLogMu.Unlock()

	lyricsTrackID := lyricsCacheKey(artist, title)
	lyrics := fetchCachedLyrics(lyricsTrackID)
	if lyrics == nil && title != "" && artist != "" {
		lyrics = fetchLyrics(artist, title, length)
	}

	return MediaState{
		Title:       title,
		Artist:      artist,
		Status:      status,
		Lyrics:      lyrics,
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
		BTSinkOn:         btSinkOn,
		WarpOn:            warpOn,
		AudioStreamActive: streamActive,
		Players:           players,
		Sinks:             sinks,
		AppStreams:        appStreams,
		Sys:               fetchSystemStats(),
		CmdLog:            logCopy,
	}
}
