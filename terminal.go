package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"time"

	"github.com/creack/pty"
	"github.com/coder/websocket"
)

type resizeMsg struct {
	Type  string `json:"type"`
	Rows  uint16 `json:"rows"`
	Cols  uint16 `json:"cols"`
}

func handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("terminal: websocket accept: %v", err)
		return
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmd := exec.Command(shell)
	cmd.Env = os.Environ()

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 30, Cols: 120})
	if err != nil {
		log.Printf("terminal: pty start: %v", err)
		conn.Close(websocket.StatusInternalError, "pty failed")
		return
	}

	ctx := r.Context()
	done := make(chan struct{})

	// PTY stdout → WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				close(done)
				return
			}
			if err := conn.Write(ctx, websocket.MessageBinary, buf[:n]); err != nil {
				close(done)
				return
			}
		}
	}()

	// WebSocket → PTY stdin (handles resize JSON + raw input)
	go func() {
		for {
			typ, msg, err := conn.Read(ctx)
			if err != nil {
				close(done)
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
	cmd.Wait()
	conn.Close(websocket.StatusNormalClosure, "")
	time.Sleep(100 * time.Millisecond)
}
