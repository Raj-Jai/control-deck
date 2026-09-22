package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// MusicSearchResult is a single top hit returned to the frontend.
type MusicSearchResult struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Artist    string `json:"artist"`
	Duration  int64  `json:"duration"` // seconds
	Thumbnail string `json:"thumbnail"`
	URL       string `json:"url"`
}

// handleMusicSearch runs a YouTube search via yt-dlp and returns top results.
func handleMusicSearch(w http.ResponseWriter, r *http.Request) {
	if !requireFeature(w, FeatureMediaBrowser) {
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		http.Error(w, "Missing q", http.StatusBadRequest)
		return
	}
	n := 8
	if v := r.URL.Query().Get("n"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p <= 20 {
			n = p
		}
	}

	out, err := exec.Command("yt-dlp",
		fmt.Sprintf("ytsearch%d:%s", n, q),
		"--flat-playlist", "-J", "--no-warnings").Output()
	if err != nil {
		log.Printf("music: yt-dlp search failed: %v", err)
		http.Error(w, "Search failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	var pl struct {
		Entries []struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Duration interface{} `json:"duration"`
			Thumb    string `json:"thumbnail"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(out, &pl); err != nil {
		log.Printf("music: decode yt-dlp search failed: %v", err)
		http.Error(w, "Search decode failed", http.StatusBadGateway)
		return
	}

	results := make([]MusicSearchResult, 0, len(pl.Entries))
	for _, e := range pl.Entries {
		if e.ID == "" {
			continue
		}
		dur := int64(0)
		switch d := e.Duration.(type) {
		case float64:
			dur = int64(d)
		case int64:
			dur = d
		}
		artist := ""
		title := e.Title
		// YouTube cover titles use "Title || Artist", normal ones "Artist - Title".
		for _, sep := range []string{" - ", " || ", " | "} {
			if i := strings.Index(title, sep); i > 0 {
				left := strings.TrimSpace(title[:i])
				right := strings.TrimSpace(title[i+len(sep):])
				if sep == " - " {
					artist, title = left, right
				} else {
					title, artist = left, right
				}
				break
			}
		}
		// Remove trailing noise from each part.
		artist = cleanSearchPart(artist)
		title = cleanSearchPart(title)
		results = append(results, MusicSearchResult{
			ID:        e.ID,
			Title:     title,
			Artist:    artist,
			Duration:  dur,
			Thumbnail: e.Thumb,
			URL:       "https://www.youtube.com/watch?v=" + e.ID,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"query":   q,
		"results": results,
	})
}

// Track the running music pipeline (yt-dlp | mpv) so playing a new song
// kills the previous one instead of leaving it running.
var (
	musicPipelineMu sync.Mutex
	musicPipeline   *exec.Cmd

	// musicMeta holds the known artist/title for the currently playing music
	// pipeline. mpv exposes no xesam:artist (it streams from stdin, so there
	// is no file metadata), so the deck uses this to resolve lyrics and to
	// display a clean title instead of the raw YouTube title.
	musicMetaMu     sync.Mutex
	musicMetaArtist string
	musicMetaTitle  string
	musicMetaURL    string
)

// currentMusicMeta returns the stored artist/title for the music pipeline.
func currentMusicMeta() (string, string) {
	musicMetaMu.Lock()
	defer musicMetaMu.Unlock()
	return musicMetaArtist, musicMetaTitle
}

// currentMusicURL returns the stored source URL for the music pipeline.
func currentMusicURL() string {
	musicMetaMu.Lock()
	defer musicMetaMu.Unlock()
	return musicMetaURL
}

// killMusicPipeline terminates any running music pipeline and its whole
// process group (both the yt-dlp producer and the mpv consumer). As a safety
// net it also kills any stray mpv/yt-dlp processes.
func killMusicPipeline() {
	musicPipelineMu.Lock()
	if musicPipeline != nil && musicPipeline.Process != nil {
		syscall.Kill(-musicPipeline.Process.Pid, syscall.SIGKILL)
		musicPipeline.Wait()
		musicPipeline = nil
	}
	musicPipelineMu.Unlock()
	exec.Command("pkill", "-9", "-x", "mpv").Run()
	exec.Command("pkill", "-9", "-x", "yt-dlp").Run()
	if _, err := os.Stat(mpvSocketPath); err == nil {
		os.Remove(mpvSocketPath)
	}
}

// mpvAlive verifies a real mpv process is behind the IPC socket by performing
// an actual round-trip command (a bare dial can succeed on a stale socket file
// left by a crashed/zombie mpv).
func mpvAlive() bool {
	conn, err := net.DialTimeout("unix", mpvSocketPath, 500*time.Millisecond)
	if err != nil {
		return false
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(1 * time.Second))
	raw := []byte(`{"command":["get_property","time-pos"]}` + "\n")
	if _, err := conn.Write(raw); err != nil {
		return false
	}
	scanner := bufio.NewScanner(conn)
	scanner.Split(scanLines)
	return scanner.Scan()
}

// handleMusicPlay plays the given URL by streaming it through yt-dlp directly
// into mpv over a pipe (yt-dlp | mpv -). Streaming through yt-dlp is robust
// against YouTube's 429/403 rate-limiting because yt-dlp handles auth, cookies
// and signing internally; passing a pre-resolved googlevideo URL to mpv often
// gets rejected with 403.
//
// Optional query params: title & artist are passed to mpv via --force-media-title
// so MPRIS exposes a human-readable title (and the deck/lyrics show it).
func handleMusicPlay(w http.ResponseWriter, r *http.Request) {
	if !requireFeature(w, FeatureMediaBrowser) {
		return
	}
	u := strings.TrimSpace(r.URL.Query().Get("url"))
	if u == "" {
		http.Error(w, "Missing url", http.StatusBadRequest)
		return
	}
	if !checkBinary("mpv") {
		http.Error(w, "mpv not installed", http.StatusServiceUnavailable)
		return
	}
	if !checkBinary("yt-dlp") {
		http.Error(w, "yt-dlp not installed", http.StatusServiceUnavailable)
		return
	}

	title := strings.TrimSpace(r.URL.Query().Get("title"))
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	mediaTitle := title
	if mediaTitle == "" && artist != "" {
		mediaTitle = artist
	} else if title != "" && artist != "" {
		mediaTitle = artist + " - " + title
	}

	// Remember the clean artist/title for lyrics resolution & display (mpv
	// exposes no xesam:artist and its xesam:title is the raw YouTube title).
	musicMetaMu.Lock()
	musicMetaArtist = artist
	musicMetaTitle = title
	musicMetaURL = u
	musicMetaMu.Unlock()

	// Stop any existing music pipeline before starting the new song.
	killMusicPipeline()

	// Build: yt-dlp -f bestaudio -o - <url> | mpv - --input-ipc-server=...
	// sh -c runs the pipeline under one process group (Setpgid) that we can
	// kill as a unit later.
	// --js-runtimes node: YouTube now requires a JS runtime to solve the
	// signature/n challenge; without it yt-dlp can only see storyboard images.
	// The service PATH doesn't include ~/.nvm, so use node's absolute path.
	nodeBin := findNodeBinary()
	jsRuntime := "node"
	if nodeBin != "" {
		jsRuntime = "node:" + shellQuote(nodeBin)
	}
	pipeline := "yt-dlp --js-runtimes " + jsRuntime + " -f bestaudio/best -o - -q --no-warnings"
	for _, cookieSrc := range []string{"chrome", "google-chrome"} {
		if browserHasCookies(cookieSrc) {
			pipeline += " --cookies-from-browser " + cookieSrc
			break
		}
	}
	mpvOpts := "--input-ipc-server=" + mpvSocketPath +
		" --no-terminal --quiet --keep-open=yes --force-window=no --vid=no --hwdec=no"
	if mediaTitle != "" {
		mpvOpts += " --force-media-title=" + shellQuote(mediaTitle)
	}
	pipeline += " " + shellQuote(u) + " | mpv - " + mpvOpts

	cmd := exec.Command("sh", "-c", pipeline)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if f, err := os.OpenFile("/tmp/mpv_deck.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644); err == nil {
		cmd.Stdout = f
		cmd.Stderr = f
	}
	if err := cmd.Start(); err != nil {
		log.Printf("music: pipeline start failed: %v", err)
		http.Error(w, "Failed to start playback: "+err.Error(), http.StatusInternalServerError)
		return
	}
	musicPipelineMu.Lock()
	musicPipeline = cmd
	musicPipelineMu.Unlock()
	log.Printf("music: started yt-dlp|mpv pipeline (pid %d) for %s", cmd.Process.Pid, u)

	// Wait for the IPC socket to appear (mpv binds it shortly after startup).
	deadline := time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		if mpvAlive() {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"playing": true,
		"url":     u,
	})
}

// cleanSearchPart strips YouTube title noise (parenthesised tags, channel
// suffixes, extra separators) from a title or artist part.
func cleanSearchPart(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Split(s, " || ")[0]
	s = strings.Split(s, " | ")[0]
	s = strings.Split(s, " - Topic")[0]
	noise := regexp.MustCompile(`(?i)[\(\[].*?(official|video|audio|lyric|live|remastered|version|concert|hd|4k|8k|visualizer|music\s*video|lyrical|song).*?[\)\]]`)
	s = noise.ReplaceAllString(s, "")
	s = strings.TrimSpace(s)
	return s
}

// resolvePlayerMedia returns the browser-openable URL for the given (or best)
// player, captured at its current position, plus the player id and position.
// The player is NOT paused here — callers decide.
func resolvePlayerMedia(player string) (id, openURL string, pos float64, err error) {
	p := strings.TrimSpace(player)
	if p == "" {
		p = findBestPlayer()
	}
	if p == "" {
		return "", "", 0, fmt.Errorf("no media player found")
	}

	// Capture position before pausing.
	posStr, _ := runCmd("playerctl", "--player", p, "position")
	if f, e := strconv.ParseFloat(strings.TrimSpace(posStr), 64); e == nil && f >= 0 {
		pos = f
	}

	// Resolve the media URL.
	mediaURL := ""
	if strings.HasPrefix(p, "mpv") {
		mediaURL = currentMusicURL()
	}
	if mediaURL == "" {
		if u, err := runCmd("playerctl", "--player", p, "metadata", "xesam:url"); err == nil {
			mediaURL = strings.TrimSpace(u)
		}
	}
	if mediaURL == "" {
		if t, err := runCmd("playerctl", "--player", p, "metadata", "xesam:title"); err == nil {
			mediaURL = resolveYouTubeByTitle(strings.TrimSpace(t))
		}
	}
	if mediaURL == "" {
		return "", "", 0, fmt.Errorf("could not determine media URL")
	}

	return p, browserURLAtPosition(mediaURL, pos), pos, nil
}

// handleOpenInBrowser pauses the given (or best) player and returns the current
// media's browser-openable URL (resumed from the same position where possible)
// so the client device — not the server — can open it in a new tab.
func handleOpenInBrowser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureMediaBrowser) {
		return
	}
	var req struct {
		Player string `json:"player"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	p, openURL, pos, err := resolvePlayerMedia(req.Player)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Pause the laptop player first.
	runCmd("playerctl", "--player", p, "pause")

	addLog("↗ open in browser: " + openURL)
	log.Printf("open-in-browser: player=%s pos=%.0f → %s", p, pos, openURL)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"opened":  true,
		"paused":  true,
		"url":     openURL,
		"player":  p,
		"seconds": pos,
	})
}

// phoneDevice is a handoff target discovered via KDE Connect / GSConnect.
type phoneDevice struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// gsconnectDaemon returns the path to GSConnect's daemon.js (its CLI entry
// point) if the extension is installed, or "" if not.
func gsconnectDaemon() string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, ".local/share/gnome-shell/extensions/gsconnect@andyholmes.github.io/service/daemon.js"),
		"/usr/share/gnome-shell/extensions/gsconnect@andyholmes.github.io/service/daemon.js",
		"/usr/lib/gnome-shell/extensions/gsconnect@andyholmes.github.io/service/daemon.js",
	}
	for _, p := range candidates {
		if fileExists(p) {
			return p
		}
	}
	return ""
}

// gsconnectAvailable reports whether GSConnect is installed and its daemon is
// reachable on the session bus (preferred backend over kdeconnect-cli).
func gsconnectAvailable() bool {
	daemon := gsconnectDaemon()
	if daemon == "" || !checkBinary("gjs") {
		return false
	}
	out, err := exec.Command("gjs", "-m", daemon, "--list-devices").CombinedOutput()
	return err == nil || len(out) > 0
}

// gsconnectListDevices runs GSConnect's CLI and returns reachable paired
// devices as "id\tname\tconnected\tpaired" lines.
func gsconnectListDevices() string {
	daemon := gsconnectDaemon()
	if daemon == "" {
		return ""
	}
	out, err := exec.Command("gjs", "-m", daemon, "--list-all").Output()
	if err != nil {
		log.Printf("handoff: gsconnect --list-all failed: %v", err)
		return ""
	}
	return string(out)
}

// gsconnectDeviceProp reads a property from GSConnect's Device D-Bus object.
func gsconnectDeviceProp(id, prop string) string {
	path := "/org/gnome/Shell/Extensions/GSConnect/Device/" + id
	out, err := exec.Command("dbus-send", "--session", "--print-reply",
		"--dest=org.gnome.Shell.Extensions.GSConnect", "--type=method_call",
		path,
		"org.freedesktop.DBus.Properties.Get",
		"string:org.gnome.Shell.Extensions.GSConnect.Device", "string:"+prop).Output()
	if err != nil {
		return ""
	}
	return string(out)
}

// listPhoneDevices returns all reachable KDE Connect/GSConnect phone/tablet
// devices, preferring GSConnect when installed.
func listPhoneDevices() []phoneDevice {
	if gsconnectAvailable() {
		var devs []phoneDevice
		for _, line := range strings.Split(strings.TrimSpace(gsconnectListDevices()), "\n") {
			fields := strings.Split(line, "\t")
			if len(fields) < 2 {
				continue
			}
			id := strings.TrimSpace(fields[0])
			name := strings.TrimSpace(fields[1])
			if id == "" || !deviceIsPhone(id) {
				continue
			}
			devs = append(devs, phoneDevice{ID: id, Name: name})
		}
		return devs
	}

	out, err := exec.Command("kdeconnect-cli", "-l", "--id-name-only").Output()
	if err != nil {
		log.Printf("handoff: kdeconnect-cli -l failed: %v", err)
		return nil
	}
	var devs []phoneDevice
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: "<id> <name>"
		parts := strings.SplitN(line, " ", 2)
		if len(parts) != 2 {
			continue
		}
		id := strings.TrimSpace(parts[0])
		name := strings.TrimSpace(parts[1])
		if id == "" || !deviceIsPhone(id) {
			continue
		}
		devs = append(devs, phoneDevice{ID: id, Name: name})
	}
	return devs
}

// handleHandoffDevices lists reachable phones for the frontend device picker.
func handleHandoffDevices(w http.ResponseWriter, r *http.Request) {
	if !requireFeature(w, FeatureMediaBrowser) {
		return
	}
	if !gsconnectAvailable() && !checkBinary("kdeconnect-cli") {
		http.Error(w, "no KDE Connect / GSConnect backend available", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"devices": listPhoneDevices(),
	})
}

// findPhoneDeviceID returns the device id of the handoff target phone:
//  1. the device configured in config.json (kdeconnect_phone), matched by
//     device id or name, if it is reachable;
//  2. otherwise the first reachable phone/tablet device.
func findPhoneDeviceID() string {
	devs := listPhoneDevices()

	// Prefer the configured device.
	if cfg := getConfig().KDConnectPhone; cfg != "" {
		for _, d := range devs {
			if d.ID == cfg || d.Name == cfg {
				if deviceIsPhone(d.ID) {
					return d.ID
				}
				log.Printf("handoff: configured device %q is not a phone (type?)", cfg)
			}
		}
		log.Printf("handoff: configured device %q not reachable, falling back", cfg)
	}

	if len(devs) > 0 {
		return devs[0].ID
	}
	return ""
}

// deviceIsPhone reports whether the device of the given id is a phone or
// tablet (vs desktop/laptop), via whichever backend is active.
func deviceIsPhone(id string) bool {
	if gsconnectAvailable() {
		s := gsconnectDeviceProp(id, "Type")
		return strings.Contains(s, "phone") || strings.Contains(s, "tablet")
	}
	out, err := exec.Command("dbus-send", "--session", "--print-reply",
		"--dest=org.kde.kdeconnect", "--type=method_call",
		"/modules/kdeconnect/devices/"+id,
		"org.freedesktop.DBus.Properties.Get",
		"string:org.kde.kdeconnect.device", "string:type").Output()
	if err != nil {
		return false
	}
	s := string(out)
	return strings.Contains(s, "phone") || strings.Contains(s, "tablet")
}

// devicePaired reports whether the device is paired (plugins load only after
// pairing, so sharing needs it).
func devicePaired(id string) bool {
	if gsconnectAvailable() {
		return strings.Contains(gsconnectDeviceProp(id, "Paired"), "true")
	}
	out, err := exec.Command("dbus-send", "--session", "--print-reply",
		"--dest=org.kde.kdeconnect", "--type=method_call",
		"/modules/kdeconnect/devices/"+id,
		"org.freedesktop.DBus.Properties.Get",
		"string:org.kde.kdeconnect.device", "string:isPaired").Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "true")
}

// ensureDevicePaired requests pairing if needed and waits up to 15s for the
// user to accept on the phone. Returns true if the device ends up paired.
func ensureDevicePaired(id string) bool {
	if devicePaired(id) {
		return true
	}
	log.Printf("handoff: device %s not paired, requesting pairing", id)
	if gsconnectAvailable() {
		daemon := gsconnectDaemon()
		if daemon != "" {
			exec.Command("gjs", "-m", daemon, "--pair", "--device", id).Run()
		}
	} else {
		exec.Command("kdeconnect-cli", "--pair", "--device", id).Run()
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(500 * time.Millisecond)
		if devicePaired(id) {
			return true
		}
	}
	return false
}

// handleHandoffToPhone pauses the given (or best) player and shares the current
// media URL (at the same position) to the user's KDE Connect phone so it opens
// natively there — no dashboard needed on the phone.
func handleHandoffToPhone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureMediaBrowser) {
		return
	}
	if !gsconnectAvailable() && !checkBinary("kdeconnect-cli") {
		http.Error(w, "no KDE Connect / GSConnect backend available", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		Player string `json:"player"`
		Device string `json:"device"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	p, openURL, pos, err := resolvePlayerMedia(req.Player)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Pause the laptop player first.
	runCmd("playerctl", "--player", p, "pause")

	dev := strings.TrimSpace(req.Device)
	if dev == "" {
		dev = findPhoneDeviceID()
	}
	if dev == "" {
		http.Error(w, "No KDE Connect phone device reachable", http.StatusNotFound)
		return
	}

	// Plugins (including share) only load after pairing. Auto-request pairing
	// and wait for the user to accept on the phone.
	if !ensureDevicePaired(dev) {
		http.Error(w, "Phone not paired — accept the pairing request on the phone and retry", http.StatusConflict)
		return
	}

	// Share the URL to the phone. KDE Connect shows a notification with an
	// "Open" action which launches the URL natively (YouTube/Spotify app or
	// browser) at the embedded timestamp.
	var out []byte
	var errShare error
	if gsconnectAvailable() {
		daemon := gsconnectDaemon()
		out, errShare = exec.Command("gjs", "-m", daemon, "--share-link", openURL, "--device", dev).CombinedOutput()
	} else {
		out, errShare = exec.Command("kdeconnect-cli", "--share", openURL, "--device", dev).CombinedOutput()
	}
	if errShare != nil {
		log.Printf("handoff: share failed: %v | %s", errShare, string(out))
		http.Error(w, "Failed to share to phone: "+errShare.Error(), http.StatusInternalServerError)
		return
	}

	addLog("📲 handoff to phone: " + openURL)
	log.Printf("handoff: player=%s dev=%s pos=%.0f → %s", p, dev, pos, openURL)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"opened":  true,
		"paused":  true,
		"url":     openURL,
		"player":  p,
		"device":  dev,
		"seconds": pos,
	})
}

// resolveYouTubeByTitle finds the YouTube watch URL for a title via yt-dlp.
func resolveYouTubeByTitle(title string) string {
	if title == "" {
		return ""
	}
	out, err := exec.Command("yt-dlp",
		fmt.Sprintf("ytsearch1:%s", title),
		"--flat-playlist", "-J", "--no-warnings").Output()
	if err != nil {
		log.Printf("open-in-browser: yt-dlp resolve failed: %v", err)
		return ""
	}
	var pl struct {
		Entries []struct {
			ID string `json:"id"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(out, &pl); err != nil || len(pl.Entries) == 0 || pl.Entries[0].ID == "" {
		log.Printf("open-in-browser: no yt-dlp result for %q", title)
		return ""
	}
	return "https://www.youtube.com/watch?v=" + pl.Entries[0].ID
}

// browserURLAtPosition converts a media URL into a browser-openable URL,
// appending a seek timestamp for YouTube.
func browserURLAtPosition(raw string, pos float64) string {
	raw = strings.TrimSpace(raw)

	// Spotify canonical form: spotify:track:ID → https://open.spotify.com/track/ID
	if strings.HasPrefix(raw, "spotify:") {
		id := strings.TrimPrefix(raw, "spotify:")
		if id != "" {
			return "https://open.spotify.com/" + id
		}
	}

	ts := ""
	if pos > 0 {
		ts = fmt.Sprintf("%d", int(pos))
	}

	if strings.Contains(raw, "youtube.com/watch") || strings.Contains(raw, "youtube.com/shorts") || strings.Contains(raw, "music.youtube.com") {
		sep := "?"
		if strings.Contains(raw, "?") {
			sep = "&"
		}
		if ts != "" {
			return raw + sep + "t=" + ts + "s"
		}
		return raw
	}
	if strings.Contains(raw, "youtu.be/") {
		sep := "?"
		if strings.Contains(raw, "?") {
			sep = "&"
		}
		if ts != "" {
			return raw + sep + "t=" + ts + "s"
		}
		return raw
	}

	return raw
}

// browserHasCookies reports whether a browser profile with a cookies DB exists.
func browserHasCookies(browser string) bool {
	home, _ := os.UserHomeDir()
	paths := map[string]string{
		"chrome":        home + "/.config/google-chrome/Default/Cookies",
		"google-chrome": home + "/.config/google-chrome/Default/Cookies",
	}
	return fileExists(paths[browser])
}

// findNodeBinary locates a node binary. node is often installed via nvm under
// the user's home, which is not on the systemd service PATH, so we probe the
// usual nvm locations first (the system /usr/bin/node is usually too old for
// yt-dlp's challenge solver), falling back to PATH.
func findNodeBinary() string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		home + "/.nvm/versions/node/*/bin/node",
	}
	for _, c := range candidates {
		matches, _ := filepath.Glob(c)
		for _, m := range matches {
			if info, err := os.Stat(m); err == nil && !info.IsDir() {
				return m
			}
		}
	}
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	return ""
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// shellQuote wraps s in single quotes for safe use in a sh -c command string.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}


