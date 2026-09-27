package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	frameTypeInit  = 0x01
	frameTypeAudio = 0x02

	frameSamples    = 2048
	sampleRate      = 48000
	channels        = 2
	bytesPerSample  = 2
	frameBytes      = frameSamples * channels * bytesPerSample
	frameDurationMs = 2048.0 * 1000.0 / 48000.0
	emaAlpha        = 0.02

	// listenerQueueFrames bounds the per-client backlog. At 42.67 ms/frame
	// this is ~4 s of audio. A deeper queue does not buy resilience, it buys
	// permanent latency: a client that falls behind once keeps hearing the
	// backlog instead of live audio, and nothing can re-anchor it.
	listenerQueueFrames = 96

	// restartBaseDelay is the base backoff for respawning ffmpeg after the
	// capture pipeline dies on its own (monitor source removed, driver reset,
	// OOM kill). Without this, readLoop returns, every listener channel stays
	// open, and each connected client blocks forever on a dead channel.
	restartBaseDelay = 2 * time.Second
	maxRestarts      = 5
)

type PTSTracker struct {
	smoothedPTS float64
	initialized bool
	alpha       float64
}

func NewPTSTracker(alpha float64) *PTSTracker {
	return &PTSTracker{alpha: alpha}
}

// GetPTS returns a host-clock millisecond timestamp for the frame about to be
// emitted, smoothed against the nominal frame duration so read-clock jitter
// does not leak into the client timeline.
func (p *PTSTracker) GetPTS(readTime time.Time) uint64 {
	readTimeMs := float64(readTime.UnixMilli())
	if !p.initialized {
		p.smoothedPTS = readTimeMs
		p.initialized = true
		return uint64(readTimeMs)
	}
	nominalPTS := p.smoothedPTS + frameDurationMs
	p.smoothedPTS = (1.0-p.alpha)*nominalPTS + p.alpha*readTimeMs
	return uint64(p.smoothedPTS)
}

var streamMgr = &StreamManager{
	listeners: make(map[chan []byte]bool),
}

var (
	deviceAudioWS   = make(map[string]*websocket.Conn)
	deviceAudioWSMu sync.Mutex
)

func remoteStopStream(deviceID string) bool {
	deviceAudioWSMu.Lock()
	conn, ok := deviceAudioWS[deviceID]
	if ok {
		delete(deviceAudioWS, deviceID)
	}
	deviceAudioWSMu.Unlock()
	if ok {
		conn.Close(websocket.StatusNormalClosure, "remote stop")
		return true
	}
	return false
}

func remoteStopAllStreams() {
	deviceAudioWSMu.Lock()
	for id, conn := range deviceAudioWS {
		delete(deviceAudioWS, id)
		conn.Close(websocket.StatusNormalClosure, "broadcast stop")
	}
	deviceAudioWSMu.Unlock()
}

func remoteStartStream(deviceID string) bool {
	deviceAudioWSMu.Lock()
	_, ok := deviceAudioWS[deviceID]
	deviceAudioWSMu.Unlock()
	return !ok // device is not already streaming
}

type StreamManager struct {
	mu        sync.Mutex
	ffCmd     *exec.Cmd
	stdout    io.ReadCloser
	listeners map[chan []byte]bool
	stopCh    chan struct{}

	// lastErr records why the capture pipeline is down, so the handshake and
	// /api/audio-stream/status can say so instead of reporting a healthy but
	// silent stream.
	lastErr string

	// gen is bumped by every start and every stop. A scheduled restart only
	// fires if the generation it captured is still current, so a manual Stop()
	// during a restart backoff cannot leave an orphan ffmpeg behind.
	gen int
	// restarts counts consecutive respawns since the last frame was read.
	restarts int
}

func (m *StreamManager) start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.startLocked()
}

func (m *StreamManager) startLocked() error {
	if m.ffCmd != nil {
		return nil
	}

	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error",
		"-f", "pulse", "-i", "@DEFAULT_MONITOR@",
		"-f", "s16le",
		"-ac", "2",
		"-ar", "48000",
		"-acodec", "pcm_s16le",
		"pipe:1")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.lastErr = err.Error()
		return err
	}
	if err := cmd.Start(); err != nil {
		m.lastErr = err.Error()
		return err
	}

	stopCh := make(chan struct{})
	m.ffCmd = cmd
	m.stdout = stdout
	m.stopCh = stopCh
	m.lastErr = ""
	m.gen++

	// readLoop receives the reader and the stop channel as parameters. Reading
	// them off the struct instead would be an unsynchronised access to fields
	// that stopLocked writes under m.mu.
	go m.readLoop(stdout, stopCh)
	log.Println("audio-stream: started (PCM s16le 48000Hz stereo)")
	return nil
}

// readLoop pumps frames until the pipe breaks. On an unexpected break it hands
// off to scheduleRestart so connected clients recover instead of hanging.
func (m *StreamManager) readLoop(stdout io.ReadCloser, stopCh chan struct{}) {
	buf := make([]byte, frameBytes)
	ptsTracker := NewPTSTracker(emaAlpha)

	for {
		select {
		case <-stopCh:
			return
		default:
		}

		_, err := io.ReadFull(stdout, buf)
		if err != nil {
			m.mu.Lock()
			crashed := m.ffCmd != nil // nil means stopLocked already ran
			gen := m.gen
			orphan := m.ffCmd
			if crashed {
				m.lastErr = err.Error()
				m.ffCmd = nil
				m.stdout = nil
			}
			m.mu.Unlock()
			if !crashed {
				return // deliberate shutdown
			}
			// Clearing ffCmd above means stopLocked will no longer reap this
			// process, so reap it here instead of leaking a zombie.
			go orphan.Wait()
			log.Printf("audio-stream: capture pipe closed: %v (restarting)", err)
			m.scheduleRestart(gen)
			return
		}

		pts := ptsTracker.GetPTS(time.Now())

		frame := make([]byte, 1+8+frameBytes)
		frame[0] = frameTypeAudio
		binary.BigEndian.PutUint64(frame[1:], uint64(pts))
		copy(frame[9:], buf)

		// Fan out under the lock so a listener cannot be removed (and its
		// channel closed) between the map lookup and the send. A client that
		// cannot keep up has its frames DROPPED rather than reordered:
		// reordering plays the stream at the wrong rate and corrupts it,
		// whereas a drop is a hole the client can detect and re-anchor from.
		// A frame arriving also proves the pipeline is healthy, so the
		// restart counter is reset in the same critical section.
		m.mu.Lock()
		m.restarts = 0
		for ch := range m.listeners {
			select {
			case ch <- frame:
			default:
				// queue full — drop for this client only
			}
		}
		m.mu.Unlock()
	}
}

// scheduleRestart respawns ffmpeg with linear backoff, up to maxRestarts
// consecutive attempts. resarts is reset as soon as a frame is read, so a
// long-running healthy stream never accumulates credit toward the cap.
func (m *StreamManager) scheduleRestart(gen int) {
	go func() {
		for attempt := 1; attempt <= maxRestarts; attempt++ {
			delay := restartBaseDelay * time.Duration(attempt)
			log.Printf("audio-stream: restart attempt %d/%d in %s", attempt, maxRestarts, delay)
			time.Sleep(delay)

			m.mu.Lock()
			if m.gen != gen {
				// Stop() (or another start) happened while we waited.
				m.mu.Unlock()
				return
			}
			m.restarts = attempt
			err := m.startLocked()
			m.mu.Unlock()
			if err == nil {
				return // readLoop is running again
			}
		}
		m.mu.Lock()
		if m.gen != gen {
			// Stop() or a fresh start happened while we were backing off;
			// reporting failure now would kill a stream the user just began.
			m.mu.Unlock()
			return
		}
		m.lastErr = "capture did not recover after " + strconv.Itoa(maxRestarts) + " attempts"
		m.restarts = 0
		m.mu.Unlock()
		log.Printf("audio-stream: giving up: %s", m.capturedErr())
		m.failAll("capture_stopped")
	}()
}

func (m *StreamManager) capturedErr() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.lastErr == "" {
		return "capture pipe closed"
	}
	return m.lastErr
}

// failAll closes every listener channel so each client's writer loop returns
// instead of blocking forever on a channel that will never produce a frame.
func (m *StreamManager) failAll(reason string) {
	m.mu.Lock()
	chans := make([]chan []byte, 0, len(m.listeners))
	for ch := range m.listeners {
		chans = append(chans, ch)
		delete(m.listeners, ch)
	}
	m.mu.Unlock()
	for _, ch := range chans {
		close(ch)
	}
	if len(chans) > 0 {
		log.Printf("audio-stream: releasing %d stranded listener(s): %s", len(chans), reason)
	}
}

func (m *StreamManager) stopLocked() {
	// Bump the generation even when there is no process to kill. If ffmpeg has
	// already died, stopLocked is reached from a client disconnect during the
	// restart backoff with ffCmd == nil; returning early there would leave the
	// scheduled restart armed and resurrect a stream the user just stopped.
	m.gen++
	if m.ffCmd == nil {
		return
	}
	close(m.stopCh)
	m.ffCmd.Process.Kill()
	m.ffCmd.Wait()
	m.ffCmd = nil
	m.stdout = nil
	m.restarts = 0
	log.Println("audio-stream: stopped")
}

func (m *StreamManager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.stopLocked()
}

func (m *StreamManager) addListener() (chan []byte, error) {
	if err := m.start(); err != nil {
		return nil, err
	}
	ch := make(chan []byte, listenerQueueFrames)
	m.mu.Lock()
	m.listeners[ch] = true
	m.mu.Unlock()
	return ch, nil
}

func (m *StreamManager) removeListener(ch chan []byte) {
	m.mu.Lock()
	_, present := m.listeners[ch]
	delete(m.listeners, ch)
	stop := present && len(m.listeners) == 0
	if stop {
		m.stopLocked()
	}
	m.mu.Unlock()
	if present {
		close(ch)
	}
}

type ntpPing struct {
	Type string `json:"type"`
	T1   int64  `json:"t1"`
}

type ntpPong struct {
	Type string `json:"type"`
	T1   int64  `json:"t1"`
	T2   int64  `json:"t2"`
}

type errNotice struct {
	Type    string `json:"type"`
	Reason  string `json:"reason"`
	Message string `json:"message,omitempty"`
}

// connWriter serialises writes to one socket. coder/websocket permits only a
// single concurrent writer, but this handler has two producers: the NTP
// responder goroutine and the audio fan-out loop. Interleaving them corrupts
// the frame stream and surfaces as spurious write errors.
type connWriter struct {
	mu   sync.Mutex
	conn *websocket.Conn
	ctx  context.Context
}

func (w *connWriter) Write(typ websocket.MessageType, b []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.Write(w.ctx, typ, b)
}

func sendInitFrame(w *connWriter) error {
	frame := make([]byte, 7)
	frame[0] = frameTypeInit
	binary.BigEndian.PutUint32(frame[1:], sampleRate)
	frame[5] = channels
	frame[6] = bytesPerSample
	return w.Write(websocket.MessageBinary, frame)
}

func sendErrorNotice(w *connWriter, reason, msg string) {
	data, err := json.Marshal(errNotice{Type: "error", Reason: reason, Message: msg})
	if err != nil {
		return
	}
	_ = w.Write(websocket.MessageText, data)
}

func handleStreamWS(w http.ResponseWriter, r *http.Request) {
	conn, err := acceptWebSocket(w, r, "audio-stream")
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	deviceID := r.URL.Query().Get("device_id")
	if deviceID != "" {
		deviceAudioWSMu.Lock()
		prev := deviceAudioWS[deviceID]
		deviceAudioWS[deviceID] = conn
		deviceAudioWSMu.Unlock()
		if prev != nil && prev != conn {
			// This device reconnected. Close the stale socket so it stops
			// consuming fan-out bandwidth and is dropped from the map.
			prev.Close(websocket.StatusNormalClosure, "superseded by reconnect")
		}
		defer func() {
			deviceAudioWSMu.Lock()
			if deviceAudioWS[deviceID] == conn {
				delete(deviceAudioWS, deviceID)
			}
			deviceAudioWSMu.Unlock()
		}()
	}

	ctx := r.Context()
	out := &connWriter{conn: conn, ctx: ctx}

	ch, err := streamMgr.addListener()
	if err != nil {
		// Tell the client why instead of closing silently, so it can show a
		// real state immediately rather than waiting out its init timeout.
		sendErrorNotice(out, "capture_unavailable", err.Error())
		log.Printf("audio-stream: add listener: %v", err)
		return
	}
	defer streamMgr.removeListener(ch)

	if err := sendInitFrame(out); err != nil {
		return
	}

	go func() {
		for {
			_, msg, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var ping ntpPing
			if json.Unmarshal(msg, &ping) == nil && ping.Type == "ntp_ping" {
				pong := ntpPong{
					Type: "ntp_pong",
					T1:   ping.T1,
					T2:   time.Now().UnixMilli(),
				}
				data, _ := json.Marshal(pong)
				if out.Write(websocket.MessageText, data) != nil {
					return
				}
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-ch:
			if !ok {
				// The capture pipeline gave up. Say so rather than hanging.
				sendErrorNotice(out, "capture_stopped", streamMgr.capturedErr())
				return
			}
			if err := out.Write(websocket.MessageBinary, data); err != nil {
				return
			}
		}
	}
}

func handleStreamStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	streamMgr.mu.Lock()
	listeners := len(streamMgr.listeners)
	capturing := streamMgr.ffCmd != nil
	lastErr := streamMgr.lastErr
	streamMgr.mu.Unlock()

	resp := map[string]any{
		"active":    listeners > 0 && capturing,
		"listeners": listeners,
		"capturing": capturing,
		"error":     lastErr,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
