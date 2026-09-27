package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

type resizeMsg struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

func handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	// Gate before upgrade: a disabled terminal section must not yield a shell.
	if !requireFeature(w, FeatureTerminal) {
		return
	}
	conn, err := acceptWebSocket(w, r, "terminal")
	if err != nil {
		return
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 30, Cols: 120})
	if err != nil {
		log.Printf("terminal: pty start: %v", err)
		conn.Close(websocket.StatusInternalError, "pty failed")
		return
	}

	ctx := r.Context()
	done := make(chan struct{})

	// Both goroutines below signal on the same channel, and either can reach
	// its close first: a tab close makes conn.Read fail, while a shell exiting
	// makes ptmx.Read fail. The second close was
	//   panic: close of closed channel
	// which killed the whole dashboard - SSE, the audio WebSocket, the hotkey
	// endpoint, every connected client. Closing a PTY is enough to trigger it:
	// the reader sees EIO and closes done at almost the same moment the
	// WebSocket reader sees the close frame.
	var doneOnce sync.Once
	finish := func() { doneOnce.Do(func() { close(done) }) }

	// PTY stdout → WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				finish()
				return
			}
			if err := conn.Write(ctx, websocket.MessageBinary, buf[:n]); err != nil {
				finish()
				return
			}
		}
	}()

	// WebSocket → PTY stdin (handles resize JSON + raw input)
	go func() {
		for {
			typ, msg, err := conn.Read(ctx)
			if err != nil {
				finish()
				return
			}
			if typ == websocket.MessageText {
				var rm resizeMsg
				if json.Unmarshal(msg, &rm) == nil && rm.Type == "resize" {
					pty.Setsize(ptmx, &pty.Winsize{Rows: rm.Rows, Cols: rm.Cols})
					continue
				}
			}
			if typ == websocket.MessageBinary || typ == websocket.MessageText {
				ptmx.Write(msg)
			}
		}
	}()

	<-done
	ptmx.Close()
	// cmd.Wait can block on a shell that ignores the hangup, and a dashboard
	// must not be held open by one, so the reap is bounded.
	reaped := make(chan struct{})
	go func() { cmd.Wait(); close(reaped) }()
	select {
	case <-reaped:
	case <-time.After(2 * time.Second):
	}
	conn.Close(websocket.StatusNormalClosure, "")
}
