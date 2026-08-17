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
)

// currentMusicMeta returns the stored artist/title for the music pipeline.
func currentMusicMeta() (string, string) {
	musicMetaMu.Lock()
	defer musicMetaMu.Unlock()
	return musicMetaArtist, musicMetaTitle
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


