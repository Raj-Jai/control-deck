package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
)

type Sink struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Default     bool   `json:"default"`
}

type AppStream struct {
	ID        int    `json:"id"`
	App       string `json:"app"`
	MediaName string `json:"media_name"`
	Volume    int    `json:"volume"`  // 0-100
	Muted     bool   `json:"muted"`
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

func handleGetAppStreams(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(fetchAppStreams())
}

func handleSetAppStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID     int  `json:"id"`
		Volume *int `json:"volume,omitempty"`
		Muted  *bool `json:"muted,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Volume != nil {
		pct := math.Max(0, math.Min(100, float64(*req.Volume)))
		linear := math.Pow(pct/100, 2)
		volStr := fmt.Sprintf("%.6f", linear)
		exec.Command("pactl", "set-sink-input-volume", strconv.Itoa(req.ID), volStr).Run()
	}
	if req.Muted != nil {
		val := "0"
		if *req.Muted {
			val = "1"
		}
		exec.Command("pactl", "set-sink-input-mute", strconv.Itoa(req.ID), val).Run()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func fetchAppStreams() []AppStream {
	out, err := exec.Command("pactl", "list", "sink-inputs").Output()
	if err != nil {
		return nil
	}

	var streams []AppStream
	var current AppStream

	scanner := bufio.NewScanner(strings.NewReader(string(out)))
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "Sink Input #") {
			if current.ID != 0 {
				streams = append(streams, current)
			}
			var id int
			fmt.Sscanf(line, "Sink Input #%d", &id)
			current = AppStream{ID: id, Volume: 100}
		} else if strings.HasPrefix(line, "\tMute: ") {
			current.Muted = strings.TrimSpace(strings.TrimPrefix(line, "\tMute: ")) == "yes"
		} else if strings.HasPrefix(line, "\tVolume: ") {
			for _, token := range strings.Fields(line) {
				if strings.HasSuffix(token, "%") {
					pct := strings.TrimSuffix(token, "%")
					if v, err := strconv.Atoi(pct); err == nil {
						current.Volume = v
					}
					break
				}
			}
		} else if strings.Contains(line, "application.name") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				current.App = strings.Trim(strings.TrimSpace(parts[1]), `" `)
			}
		} else if strings.Contains(line, "media.name") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				current.MediaName = strings.Trim(strings.TrimSpace(parts[1]), `" `)
			}
		}
	}

	if current.ID != 0 {
		streams = append(streams, current)
	}
	return streams
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
