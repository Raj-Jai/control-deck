package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

func handleClipboardPull(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureClipboard) {
		return
	}

	text, err := readClipboard()
	if err != nil {
		log.Printf("clipboard pull error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"text":  "",
			"error": "clipboard read failed: " + err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"text": text})
}

func handleClipboardPush(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureClipboard) {
		return
	}

	var req struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if err := writeClipboard(req.Text); err != nil {
		log.Printf("clipboard push error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "error",
			"error":  "clipboard write failed: " + err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// The two helpers shared one 2-second context, so if the first attempt used up
// the whole budget - wl-paste blocking on a compositor that is not answering -
// the fallback started against an already-expired context and could never
// succeed. Each attempt gets its own deadline.
const clipboardAttemptTimeout = 2 * time.Second

// attempt runs one clipboard helper and describes the outcome in terms a user
// can act on.
//
// The error used to be whatever the last helper returned - "context deadline
// exceeded" or "signal: killed" - which named neither the binary nor the
// reason. A missing tool and a compositor that is not answering are very
// different problems, and the message is the only thing that distinguishes
// them (BUG-045).
func attempt(name string, timeout time.Duration, stdin io.Reader, args ...string) (string, error) {
	if _, err := exec.LookPath(name); err != nil {
		return "", fmt.Errorf("%s is not installed", name)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	out, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(out)), nil
	}
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("%s did not respond within %s (a compositor or X server that is not answering?)",
			name, timeout)
	}
	if exitErr, ok := err.(*exec.ExitError); ok {
		stderr := strings.TrimSpace(string(exitErr.Stderr))
		if stderr != "" {
			return "", fmt.Errorf("%s failed: %s", name, firstLine(stderr))
		}
		return "", fmt.Errorf("%s exited with status %d", name, exitErr.ExitCode())
	}
	return "", fmt.Errorf("%s could not be run: %v", name, err)
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

func readClipboard() (string, error) {
	// Each helper gets its own deadline. They used to share one context, so a
	// wl-paste that used up the whole budget launched the X11 fallback already
	// expired, and the fallback could never succeed (BUG-045).
	text, waylandErr := attempt("wl-paste", clipboardAttemptTimeout, nil)
	if waylandErr == nil {
		return text, nil
	}
	log.Printf("clipboard: %v; trying the X11 fallback", waylandErr)

	text, x11Err := attempt("xclip", clipboardAttemptTimeout, nil, "-selection", "clipboard", "-o")
	if x11Err == nil {
		return text, nil
	}
	return "", fmt.Errorf("neither clipboard helper worked: %w; %w", waylandErr, x11Err)
}

func writeClipboard(text string) error {
	// Same treatment: each helper its own deadline, and a failure that says
	// which one and why.
	_, waylandErr := attempt("wl-copy", clipboardAttemptTimeout, strings.NewReader(text))
	if waylandErr == nil {
		return nil
	}
	log.Printf("clipboard write: %v; trying the X11 fallback", waylandErr)

	_, x11Err := attempt("xclip", clipboardAttemptTimeout, strings.NewReader(text), "-selection", "clipboard")
	if x11Err == nil {
		return nil
	}
	return fmt.Errorf("neither clipboard helper worked: %w; %w", waylandErr, x11Err)
}
