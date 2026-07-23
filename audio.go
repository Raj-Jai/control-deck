package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
)

type Sink struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Default     bool   `json:"default"`
}

func handleGetSinks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sinks, err := fetchSinks()
	if err != nil {
		log.Printf("fetch sinks error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sinks)
}

func handleSetSink(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if err := exec.Command("pactl", "set-default-sink", fmt.Sprintf("%d", req.ID)).Run(); err != nil {
		log.Printf("set-default sink error: %v", err)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func fetchSinks() ([]Sink, error) {
	out, err := exec.Command("pactl", "list", "sinks").Output()
	if err != nil {
		return nil, err
	}

	defaultName := getDefaultSinkName()

	var sinks []Sink
	var current Sink

	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "Sink #") {
			if current.Name != "" {
				current.Default = current.Name == defaultName
				sinks = append(sinks, current)
			}
			var id int
			fmt.Sscanf(line, "Sink #%d", &id)
			current = Sink{ID: id}
		} else if strings.HasPrefix(line, "\tName: ") {
			current.Name = strings.TrimSpace(strings.TrimPrefix(line, "\tName: "))
		} else if strings.HasPrefix(line, "\tDescription: ") {
			current.Description = strings.TrimSpace(strings.TrimPrefix(line, "\tDescription: "))
		}
	}

	if current.Name != "" {
		current.Default = current.Name == defaultName
		sinks = append(sinks, current)
	}

	return sinks, nil
}

func getDefaultSinkName() string {
	out, err := exec.Command("pactl", "info").Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "Default Sink: ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "Default Sink: "))
		}
	}
	return ""
}
