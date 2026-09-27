package main

import (
	"context"
	"encoding/json"
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

func readClipboard() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), clipboardAttemptTimeout)
	out, err := exec.CommandContext(ctx, "wl-paste").Output()
	cancel()
	if err == nil {
		return strings.TrimSpace(string(out)), nil
	}

	ctx2, cancel2 := context.WithTimeout(context.Background(), clipboardAttemptTimeout)
	defer cancel2()
	out, err = exec.CommandContext(ctx2, "xclip", "-selection", "clipboard", "-o").Output()
	if err == nil {
		return strings.TrimSpace(string(out)), nil
	}
	return "", err
}

func writeClipboard(text string) error {
	ctx, cancel := context.WithTimeout(context.Background(), clipboardAttemptTimeout)
	cmd := exec.CommandContext(ctx, "wl-copy")
	cmd.Stdin = strings.NewReader(text)
	err := cmd.Run()
	cancel()
	if err == nil {
		return nil
	}

	ctx2, cancel2 := context.WithTimeout(context.Background(), clipboardAttemptTimeout)
	defer cancel2()
	cmd = exec.CommandContext(ctx2, "xclip", "-selection", "clipboard")
	cmd.Stdin = strings.NewReader(text)
	return cmd.Run()
}
