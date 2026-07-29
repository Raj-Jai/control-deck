package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"sync"
	"time"
)

type bleManager struct {
	mu      sync.Mutex
	running bool
}

var ble = &bleManager{}

func bleStartAdvertising() error {
	ble.mu.Lock()
	defer ble.mu.Unlock()

	if ble.running {
		return nil
	}

	exec.Command("bluetoothctl", "--timeout", "5", "power", "on").Run()
	time.Sleep(200 * time.Millisecond)
	exec.Command("bluetoothctl", "--timeout", "5", "discoverable", "on").Run()

	cmd := exec.Command("bash", "-c", `bluetoothctl <<'BLEEOF'
advertise on
BLEEOF
`)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Run()

	ble.running = true
	log.Printf("BLE: advertising started")
	return nil
}

func bleStopAdvertising() error {
	ble.mu.Lock()
	defer ble.mu.Unlock()

	if !ble.running {
		return nil
	}

	exec.Command("bash", "-c", `bluetoothctl <<'BLEEOF'
advertise off
BLEEOF
`).Run()
	exec.Command("bluetoothctl", "--timeout", "3", "discoverable", "off").Run()

	ble.running = false
	log.Printf("BLE: advertising stopped")
	return nil
}

func handleBleTransmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	switch req.Action {
	case "start":
		if err := bleStartAdvertising(); err != nil {
			log.Printf("BLE start error: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	case "stop":
		if err := bleStopAdvertising(); err != nil {
			log.Printf("BLE stop error: %v", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	default:
		http.Error(w, "Invalid action", http.StatusBadRequest)
	}
}
