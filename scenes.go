package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

type sceneInfo struct {
	Name    string   `json:"name"`
	Icon    string   `json:"icon"`
	Actions []string `json:"actions"`
}

func listScenes() []sceneInfo {
	out := []sceneInfo{}
	if cfg := getConfig(); cfg != nil {
		for _, s := range cfg.Scenes {
			actions := s.Actions
			if actions == nil {
				actions = []string{}
			}
			out = append(out, sceneInfo{Name: s.Name, Icon: s.Icon, Actions: actions})
		}
	}
	return out
}

func handleSceneList(w http.ResponseWriter, r *http.Request) {
	if !requireFeature(w, FeatureScenes) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(listScenes())
}

func handleSceneRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureScenes) {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	var scene *SceneConfig
	if cfg := getConfig(); cfg != nil {
		for i := range cfg.Scenes {
			if cfg.Scenes[i].Name == req.Name {
				scene = &cfg.Scenes[i]
				break
			}
		}
	}
	if scene == nil {
		http.Error(w, "Unknown scene", http.StatusNotFound)
		return
	}
	// Validate everything before executing anything.
	for _, action := range scene.Actions {
		if !commandKnown(action) {
			http.Error(w, "Unknown action: "+action, http.StatusBadRequest)
			return
		}
		if isIdeCommand(action) && !getConfig().IsEnabled(FeatureIde) {
			http.Error(w, "Feature disabled: "+FeatureIde, http.StatusForbidden)
			return
		}
	}
	name, actions := scene.Name, append([]string{}, scene.Actions...)
	go func() {
		for i, action := range actions {
			if i > 0 {
				time.Sleep(400 * time.Millisecond)
			}
			if isIdeCommand(action) && !getConfig().IsEnabled(FeatureIde) {
				log.Printf("scene %q: action %q skipped (ide disabled)", name, action)
				continue
			}
			args, exists := lookupCommand(action)
			if !exists {
				if strings.HasPrefix(action, "speed_") {
					// Speed actions run through the async state machine.
					addLog("▶ " + action)
					go handleSpeedCommand(action)
				} else {
					// Config changed mid-scene; skip rather than misfire.
					log.Printf("scene %q: action %q vanished, skipped", name, action)
				}
				continue
			}
			addLog("▶ " + action + " (" + name + ")")
			if err := execDeckArgsSync(action, "", args); err != nil {
				log.Printf("scene %q: action %q: %v", name, action, err)
			}
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "ok", "scene": name, "actions": len(actions)})
}
