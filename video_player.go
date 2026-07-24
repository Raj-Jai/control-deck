package main

import (
	"bufio"
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
	"time"
)

var (
	vlcBaseURL    string
	vlcPassword   string
	mpvSocketPath string
)

func initVideoPlayerConfig() {
	vlcBaseURL = "http://localhost:8080"
	vlcPassword = "password"
	mpvSocketPath = "/tmp/mpvsocket"
}

type VideoTrack struct {
	ID     int    `json:"id"`
	Title  string `json:"title"`
	Active bool   `json:"active"`
}

type VideoStatus struct {
	ActivePlayer string       `json:"active_player"`
	SubDelay     float64      `json:"sub_delay"`
	AudioDelay   float64      `json:"audio_delay"`
	AspectRatio  string       `json:"aspect_ratio"`
	Speed        float64      `json:"speed"`
	Position     float64      `json:"position"`
	Length       float64      `json:"length"`
	Subtitles    []VideoTrack `json:"subtitles"`
	AudioTracks  []VideoTrack `json:"audio_tracks"`
}

type VideoCommand struct {
	Action    string      `json:"action"`
	TrackID   int         `json:"track_id,omitempty"`
	Value     interface{} `json:"value,omitempty"`
	Direction string      `json:"direction,omitempty"`
}

func detectVideoPlayer() string {
	// 1. Probe mpv IPC socket directly (most reliable)
	if _, err := net.DialTimeout("unix", mpvSocketPath, 200*time.Millisecond); err == nil {
		return "mpv"
	}

	// 2. Probe VLC HTTP interface directly
	resp, err := http.Get(vlcBaseURL + "/requests/status.json")
	if err == nil && resp.StatusCode == 200 {
		resp.Body.Close()
		return "vlc"
	}

	// 3. Check MPRIS players (VLC/mpv expose MPRIS even without HTTP/socket)
	out, err := runCmd("playerctl", "-l")
	if err == nil {
		for _, p := range strings.Fields(out) {
			lower := strings.ToLower(p)
			if strings.Contains(lower, "vlc") {
				return "vlc"
			}
			if strings.Contains(lower, "mpv") {
				return "mpv"
			}
		}
	}

	// 4. Fallback: focused window wm_class
	windowMu.Lock()
	cls := lastWMClass
	windowMu.Unlock()
	if cls != "" {
		for _, v := range videoWmClasses {
			if strings.Contains(strings.ToLower(cls), v) {
				if strings.Contains(cls, "mpv") {
					return "mpv"
				}
				if strings.Contains(cls, "vlc") {
					return "vlc"
				}
			}
		}
	}

	return "unknown"
}

func mpvSendCommand(cmd interface{}) (map[string]interface{}, error) {
	conn, err := net.DialTimeout("unix", mpvSocketPath, 1*time.Second)
	if err != nil {
		return nil, fmt.Errorf("mpv dial: %w", err)
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(3 * time.Second))

	payload := map[string]interface{}{
		"command": cmd,
	}
	raw, _ := json.Marshal(payload)
	raw = append(raw, '\n')

	if _, err := conn.Write(raw); err != nil {
		return nil, fmt.Errorf("mpv write: %w", err)
	}

	scanner := bufio.NewScanner(conn)
	scanner.Split(scanLines)

	if !scanner.Scan() {
		return nil, fmt.Errorf("mpv read: %v", scanner.Err())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(scanner.Bytes(), &resp); err != nil {
		return nil, fmt.Errorf("mpv decode: %w", err)
	}
	return resp, nil
}

func scanLines(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	// Find first complete JSON object
	depth := 0
	for i, b := range data {
		switch b {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return i + 1, data[:i+1], nil
			}
		}
	}
	if atEOF {
		return len(data), data, bufio.ErrFinalToken
	}
	return 0, nil, nil
}

func mpvGetProperty(prop string) (interface{}, error) {
	resp, err := mpvSendCommand([]interface{}{"get_property", prop})
	if err != nil {
		return nil, err
	}
	if errStr, ok := resp["error"].(string); ok && errStr != "success" {
		return nil, fmt.Errorf("mpv error: %s", errStr)
	}
	return resp["data"], nil
}

func mpvSetProperty(prop string, val interface{}) error {
	_, err := mpvSendCommand([]interface{}{"set_property", prop, val})
	return err
}

func fetchMPVStatus() *VideoStatus {
	vs := &VideoStatus{ActivePlayer: "mpv"}

	// Track list
	if tracksRaw, err := mpvGetProperty("track-list"); err == nil {
		if tracks, ok := tracksRaw.([]interface{}); ok {
			for _, tRaw := range tracks {
				t, _ := tRaw.(map[string]interface{})
				if t == nil {
					continue
				}
				id, _ := t["id"].(float64)
				typ, _ := t["type"].(string)
				selected, _ := t["selected"].(bool)
				title := ""
				if t["title"] != nil {
					title, _ = t["title"].(string)
				}
				lang := ""
				if t["lang"] != nil {
					lang, _ = t["lang"].(string)
				}
				label := title
				if label == "" {
					label = lang
				}
				if label == "" {
					label = fmt.Sprintf("%s track %d", typ, int(id))
				}

				track := VideoTrack{
					ID:     int(id),
					Title:  label,
					Active: selected,
				}

				switch typ {
				case "sub":
					vs.Subtitles = append(vs.Subtitles, track)
				case "audio":
					vs.AudioTracks = append(vs.AudioTracks, track)
				}
			}
		}
	}

	// Properties
	if d, err := mpvGetProperty("sub-delay"); err == nil {
		vs.SubDelay, _ = d.(float64)
	}
	if d, err := mpvGetProperty("audio-delay"); err == nil {
		vs.AudioDelay, _ = d.(float64)
	}
	if d, err := mpvGetProperty("video-aspect-override"); err == nil {
		s, _ := d.(string)
		if s == "" || s == "-1" {
			vs.AspectRatio = "Default"
		} else {
			vs.AspectRatio = s
		}
	}
	if d, err := mpvGetProperty("speed"); err == nil {
		vs.Speed, _ = d.(float64)
	}
	if d, err := mpvGetProperty("time-pos"); err == nil {
		vs.Position, _ = d.(float64)
	}
	if d, err := mpvGetProperty("duration"); err == nil {
		vs.Length, _ = d.(float64)
	}

	return vs
}

func sendMPVCommand(cmd VideoCommand) error {
	switch cmd.Action {
	case "set_subtitle":
		if cmd.TrackID <= 0 {
			return mpvSetProperty("sid", 0)
		}
		return mpvSetProperty("sid", cmd.TrackID)
	case "set_audio":
		if cmd.TrackID <= 0 {
			return mpvSetProperty("aid", 0)
		}
		return mpvSetProperty("aid", cmd.TrackID)
	case "set_sub_delay":
		return mpvSetProperty("sub-delay", cmd.Value)
	case "set_audio_delay":
		return mpvSetProperty("audio-delay", cmd.Value)
	case "set_aspect":
		ratio, _ := cmd.Value.(string)
		if ratio == "" || strings.EqualFold(ratio, "default") {
			return mpvSetProperty("video-aspect-override", "-1")
		}
		return mpvSetProperty("video-aspect-override", ratio)
	case "set_speed":
		speed, _ := cmd.Value.(float64)
		return mpvSetProperty("speed", speed)
	case "frame_step":
		if cmd.Direction == "prev" {
			_, err := mpvSendCommand([]interface{}{"frame-back-step"})
			return err
		}
		_, err := mpvSendCommand([]interface{}{"frame-step"})
		return err
	default:
		return fmt.Errorf("unknown mpv action: %s", cmd.Action)
	}
}

func vlcDoRequest(params string) (*http.Response, error) {
	url := vlcBaseURL + "/requests/status.json?" + params
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	if vlcPassword != "" {
		req.SetBasicAuth("", vlcPassword)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	return client.Do(req)
}

func fetchVLCStatus() *VideoStatus {
	vs := &VideoStatus{ActivePlayer: "vlc"}

	resp, err := vlcDoRequest("")
	if err != nil {
		return vs
	}
	defer resp.Body.Close()

	var vlcData map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&vlcData); err != nil {
		return vs
	}

	// Parse subtitles
	if subs, ok := vlcData["subtracks"].([]interface{}); ok {
		for _, sRaw := range subs {
			s, _ := sRaw.(map[string]interface{})
			if s == nil {
				continue
			}
			id, _ := s["id"].(string)
			name, _ := s["name"].(string)
			vs.Subtitles = append(vs.Subtitles, VideoTrack{
				ID:     parseVLCID(id),
				Title:  name,
				Active: false,
			})
		}
	}

	// Parse audio tracks
	if audios, ok := vlcData["audiotracks"].([]interface{}); ok {
		for _, aRaw := range audios {
			a, _ := aRaw.(map[string]interface{})
			if a == nil {
				continue
			}
			id, _ := a["id"].(string)
			name, _ := a["name"].(string)
			vs.AudioTracks = append(vs.AudioTracks, VideoTrack{
				ID:     parseVLCID(id),
				Title:  name,
				Active: false,
			})
		}
	}

	// Current sub/audio
	if curSub, ok := vlcData["currentsubtitle"].(map[string]interface{}); ok {
		if id, ok := curSub["id"].(string); ok {
			parsed := parseVLCID(id)
			for i := range vs.Subtitles {
				if vs.Subtitles[i].ID == parsed {
					vs.Subtitles[i].Active = true
					break
				}
			}
		}
	}
	if curAudio, ok := vlcData["currentaudiotrack"].(map[string]interface{}); ok {
		if id, ok := curAudio["id"].(string); ok {
			parsed := parseVLCID(id)
			for i := range vs.AudioTracks {
				if vs.AudioTracks[i].ID == parsed {
					vs.AudioTracks[i].Active = true
					break
				}
			}
		}
	}

	// Delays, aspect
	if d, ok := vlcData["subdelay"].(float64); ok {
		vs.SubDelay = d
	}
	if d, ok := vlcData["audiodelay"].(float64); ok {
		vs.AudioDelay = d
	}
	if a, ok := vlcData["aspectratio"].(string); ok && a != "" {
		vs.AspectRatio = a
	} else {
		vs.AspectRatio = "Default"
	}

	// Speed is not directly in VLC status, default to 1
	vs.Speed = 1.0
	if d, ok := vlcData["rate"].(float64); ok && d > 0 {
		vs.Speed = d
	}

	return vs
}

func sendVLCCommand(cmd VideoCommand) error {
	var params string
	switch cmd.Action {
	case "set_subtitle":
		if cmd.TrackID <= 0 {
			params = "command=subtitle_track&val=-1"
		} else {
			params = fmt.Sprintf("command=subtitle_track&val=%d", cmd.TrackID)
		}
	case "set_audio":
		if cmd.TrackID <= 0 {
			return nil // VLC doesn't support disabling audio track via HTTP
		}
		params = fmt.Sprintf("command=audio_track&val=%d", cmd.TrackID)
	case "set_sub_delay":
		val, _ := cmd.Value.(float64)
		params = fmt.Sprintf("command=subdelay&val=%.3f", val)
	case "set_audio_delay":
		val, _ := cmd.Value.(float64)
		params = fmt.Sprintf("command=audiodelay&val=%.3f", val)
	case "set_aspect":
		ratio, _ := cmd.Value.(string)
		if ratio == "" || strings.EqualFold(ratio, "default") {
			ratio = "default"
		}
		params = "command=aspectratio&val=" + url.QueryEscape(ratio)
	case "set_speed":
		speed, _ := cmd.Value.(float64)
		params = fmt.Sprintf("command=rate&val=%.2f", speed)
	case "frame_step":
		if cmd.Direction == "prev" {
			params = "command=key&val=shift+g"
		} else {
			params = "command=key&val=e"
		}
	default:
		return fmt.Errorf("unknown VLC action: %s", cmd.Action)
	}

	resp, err := vlcDoRequest(params)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func sendXdotoolCommand(cmd VideoCommand, mprisPlayer string) {
	sk := os.Getenv("HOME") + "/.local/bin/tab-dashboard-sendkey"

	var key string
	repeat := 1
	switch cmd.Action {
	case "set_subtitle":
		key = "v" // cycle/toggle subtitles
	case "set_audio":
		key = "b" // cycle audio track
	case "set_sub_delay":
		val, _ := cmd.Value.(float64)
		if val > 0 {
			key = "g" // sub delay +50ms
		} else {
			key = "h" // sub delay -50ms
		}
		repeat = int(math.Abs(val) / 0.05)
		if repeat < 1 {
			repeat = 1
		}
		if repeat > 100 {
			repeat = 100
		}
	case "set_audio_delay":
		val, _ := cmd.Value.(float64)
		if val > 0 {
			key = "k" // audio delay +50ms
		} else {
			key = "j" // audio delay -50ms
		}
		repeat = int(math.Abs(val) / 0.05)
		if repeat < 1 {
			repeat = 1
		}
		if repeat > 100 {
			repeat = 100
		}
	case "frame_step":
		key = "e"
	case "set_aspect":
		key = "a" // cycle aspect ratio
	default:
		return
	}

	log.Printf("xdotool: key=%s player=%s repeat=%d", key, mprisPlayer, repeat)
	args := []string{key}
	if mprisPlayer != "" {
		args = append(args, mprisPlayer)
	}
	for i := 0; i < repeat; i++ {
		exec.Command(sk, args...).Run()
		time.Sleep(30 * time.Millisecond)
	}
}

func parseVLCID(id string) int {
	// VLC IDs are like "0", "1", "2" or "0/0:0"
	parts := strings.Split(id, "/")
	n := 0
	fmt.Sscanf(parts[0], "%d", &n)
	return n
}

func fetchVideoStatus() *VideoStatus {
	player := detectVideoPlayer()

	switch player {
	case "mpv":
		// Verify mpv socket is available
		if conn, err := net.DialTimeout("unix", mpvSocketPath, 200*time.Millisecond); err == nil {
			conn.Close()
			vs := fetchMPVStatus()
			if vs != nil {
				return vs
			}
		}
		// Socket not available — try MPRIS fallback
		vs := &VideoStatus{ActivePlayer: "mpv"}
		fillFromMPRIS(vs)
		return vs
	case "vlc":
		// Verify VLC HTTP is available
		resp, err := http.Get(vlcBaseURL + "/requests/status.json")
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			vs := fetchVLCStatus()
			if vs != nil {
				return vs
			}
		}
		// HTTP not available — try MPRIS fallback
		vs := &VideoStatus{ActivePlayer: "vlc"}
		fillFromMPRIS(vs)
		return vs
	default:
		return &VideoStatus{ActivePlayer: "unknown"}
	}
}

func fillFromMPRIS(vs *VideoStatus) {
	out, err := runCmd("playerctl", "-l")
	if err != nil {
		return
	}
	suffix := ""
	if vs.ActivePlayer == "mpv" {
		suffix = "mpv"
	} else if vs.ActivePlayer == "vlc" {
		suffix = "vlc"
	} else {
		return
	}
	for _, p := range strings.Fields(out) {
		if strings.Contains(strings.ToLower(p), suffix) {
			posStr, _ := runCmd("playerctl", "--player", p, "position")
			if pos, e := strconv.ParseFloat(posStr, 64); e == nil {
				vs.Position = pos
			}
			lenStr, _ := runCmd("playerctl", "--player", p, "metadata", "mpris:length")
			if l, e := strconv.ParseFloat(lenStr, 64); e == nil {
				vs.Length = l / 1000000.0
			}
			break
		}
	}
	vs.Speed = 1.0
	vs.AspectRatio = "Default"
	vs.Subtitles = []VideoTrack{}
	vs.AudioTracks = []VideoTrack{}
}

func findMPRISPlayer(suffix string) string {
	if suffix == "" || suffix == "unknown" {
		return ""
	}
	out, err := runCmd("playerctl", "-l")
	if err != nil {
		return suffix
	}
	for _, p := range strings.Fields(out) {
		if strings.Contains(strings.ToLower(p), strings.ToLower(suffix)) {
			return p
		}
	}
	return suffix
}

func sendVideoCommand(cmd VideoCommand) error {
	player := detectVideoPlayer()
	mprisPlayer := findMPRISPlayer(player)

	switch player {
	case "mpv":
		if conn, err := net.DialTimeout("unix", mpvSocketPath, 200*time.Millisecond); err == nil {
			conn.Close()
			return sendMPVCommand(cmd)
		}
		sendXdotoolCommand(cmd, mprisPlayer)
		return nil
	case "vlc":
		resp, err := http.Get(vlcBaseURL + "/requests/status.json")
		if err == nil && resp.StatusCode == 200 {
			resp.Body.Close()
			return sendVLCCommand(cmd)
		}
		sendXdotoolCommand(cmd, mprisPlayer)
		return nil
	default:
		sendXdotoolCommand(cmd, "")
		return nil
	}
}

func handleVideoStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	vs := fetchVideoStatus()
	if vs == nil {
		vs = &VideoStatus{ActivePlayer: "unknown"}
	}
	json.NewEncoder(w).Encode(vs)
}

func handleVideoCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var cmd VideoCommand
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	addLog("video: " + cmd.Action)

	if err := sendVideoCommand(cmd); err != nil {
		log.Printf("video command error: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
