package main

import (
	"bufio"
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"sync"
	"time"

	"github.com/coder/websocket"
)

var streamMgr = &StreamManager{
	listeners: make(map[chan []byte]bool),
}

type StreamManager struct {
	mu        sync.Mutex
	ffCmd     *exec.Cmd
	stdout    *bufio.Reader
	listeners map[chan []byte]bool
	stopCh    chan struct{}
	startedAt time.Time
}

func (m *StreamManager) start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.ffCmd != nil {
		return nil
	}

	m.startedAt = time.Now()

	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error",
		"-f", "pulse", "-i", "@DEFAULT_MONITOR@",
		"-c:a", "mp3", "-b:a", "128k",
		"-f", "mp3", "pipe:1")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	m.ffCmd = cmd
	m.stdout = bufio.NewReader(stdout)
	m.stopCh = make(chan struct{})

	go m.readLoop()
	log.Println("audio-stream: started (MP3 128k)")
	return nil
}

func (m *StreamManager) stopLocked() {
	if m.ffCmd == nil {
		return
	}
	close(m.stopCh)
	m.stopCh = nil
	m.ffCmd.Process.Kill()
	m.ffCmd.Wait()
	m.ffCmd = nil
	m.stdout = nil
	log.Println("audio-stream: stopped")
}

func (m *StreamManager) readLoop() {
	buf := make([]byte, 8192)
	for {
		select {
		case <-m.stopCh:
			return
		default:
		}

		n, err := m.stdout.Read(buf)
		if err != nil {
			m.mu.Lock()
			if m.ffCmd != nil {
				log.Printf("audio-stream: ffmpeg pipe closed")
				m.ffCmd = nil
				m.stdout = nil
			}
			m.mu.Unlock()
			return
		}

		data := make([]byte, n)
		copy(data, buf[:n])

		m.mu.Lock()
		for ch := range m.listeners {
			select {
			case ch <- data:
			default:
				go func(c chan []byte, d []byte) {
					select {
					case c <- d:
					case <-time.After(3 * time.Second):
						log.Println("audio-stream: dropping data for slow client")
					}
				}(ch, data)
			}
		}
		m.mu.Unlock()
	}
}

func (m *StreamManager) addListener() (chan []byte, error) {
	if err := m.start(); err != nil {
		return nil, err
	}
	ch := make(chan []byte, 512)
	m.mu.Lock()
	m.listeners[ch] = true
	m.mu.Unlock()
	return ch, nil
}

func (m *StreamManager) removeListener(ch chan []byte) {
	m.mu.Lock()
	delete(m.listeners, ch)
	remaining := len(m.listeners)
	m.mu.Unlock()
	close(ch)
	if remaining == 0 {
		m.mu.Lock()
		m.stopLocked()
		m.mu.Unlock()
	}
}

// --- WebSocket handler ---

func handleStreamWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("audio-stream: websocket accept: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	ch, err := streamMgr.addListener()
	if err != nil {
		log.Printf("audio-stream: add listener: %v", err)
		return
	}
	defer streamMgr.removeListener(ch)

	// Send start timestamp as first frame for cross-device sync
	streamMgr.mu.Lock()
	t0 := streamMgr.startedAt.UnixNano()
	streamMgr.mu.Unlock()
	syncMsg, _ := json.Marshal(map[string]int64{"startedAt": t0})
	ctx := r.Context()
	if err := conn.Write(ctx, websocket.MessageText, syncMsg); err != nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-ch:
			if !ok {
				return
			}
			err := conn.Write(ctx, websocket.MessageBinary, data)
			if err != nil {
				return
			}
		}
	}
}

// --- HTTP handler (MP3 via chunked transfer) ---

func handleStreamPlay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ch, err := streamMgr.addListener()
	if err != nil {
		log.Printf("audio-stream: start error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer streamMgr.removeListener(ch)

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case data, ok := <-ch:
			if !ok {
				return
			}
			if _, err := w.Write(data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func handleStreamStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	streamMgr.mu.Lock()
	active := len(streamMgr.listeners) > 0
	streamMgr.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"active": active})
}
