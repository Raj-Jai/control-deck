package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os/exec"
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
)

type PTSTracker struct {
	smoothedPTS float64
	initialized bool
	alpha       float64
}

func NewPTSTracker(alpha float64) *PTSTracker {
	return &PTSTracker{alpha: alpha}
}

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

type StreamManager struct {
	mu        sync.Mutex
	ffCmd     *exec.Cmd
	stdout    io.ReadCloser
	listeners map[chan []byte]bool
	stopCh    chan struct{}
}

func (m *StreamManager) start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

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
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	m.ffCmd = cmd
	m.stdout = stdout
	m.stopCh = make(chan struct{})

	go m.readLoop()
	log.Println("audio-stream: started (PCM s16le 48000Hz stereo)")
	return nil
}

func (m *StreamManager) stopLocked() {
	if m.ffCmd == nil {
		return
	}
	close(m.stopCh)
	m.ffCmd.Process.Kill()
	m.ffCmd.Wait()
	m.ffCmd = nil
	m.stdout = nil
	log.Println("audio-stream: stopped")
}

func (m *StreamManager) readLoop() {
	buf := make([]byte, frameBytes)
	ptsTracker := NewPTSTracker(emaAlpha)
	for {
		select {
		case <-m.stopCh:
			return
		default:
		}

		_, err := io.ReadFull(m.stdout, buf)
		if err != nil {
			m.mu.Lock()
			if m.ffCmd != nil {
				log.Printf("audio-stream: ffmpeg pipe closed: %v", err)
				m.ffCmd = nil
				m.stdout = nil
			}
			m.mu.Unlock()
			return
		}

		pts := ptsTracker.GetPTS(time.Now())

		frame := make([]byte, 1+8+frameBytes)
		frame[0] = frameTypeAudio
		binary.BigEndian.PutUint64(frame[1:], uint64(pts))
		copy(frame[9:], buf)

		m.mu.Lock()
		for ch := range m.listeners {
			select {
			case ch <- frame:
			default:
				go func(c chan []byte, d []byte) {
					defer func() { recover() }()
					select {
					case c <- d:
					case <-time.After(3 * time.Second):
					}
				}(ch, frame)
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

type ntpPing struct {
	Type string `json:"type"`
	T1   int64  `json:"t1"`
}

type ntpPong struct {
	Type string `json:"type"`
	T1   int64  `json:"t1"`
	T2   int64  `json:"t2"`
}

func sendInitFrame(conn *websocket.Conn, ctx context.Context) error {
	frame := make([]byte, 7)
	frame[0] = frameTypeInit
	binary.BigEndian.PutUint32(frame[1:], sampleRate)
	frame[5] = channels
	frame[6] = bytesPerSample
	return conn.Write(ctx, websocket.MessageBinary, frame)
}

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

	ctx := r.Context()

	if err := sendInitFrame(conn, ctx); err != nil {
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
				if conn.Write(ctx, websocket.MessageText, data) != nil {
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
				return
			}
			if err := conn.Write(ctx, websocket.MessageBinary, data); err != nil {
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
	active := len(streamMgr.listeners) > 0
	streamMgr.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"active": active})
}
