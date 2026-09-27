package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type bleManager struct {
	mu      sync.Mutex
	running bool
	name    string
}

var ble = &bleManager{}

// bleDeviceName is the name the phone-side scanner filters on. It has to match
// what the adapter actually advertises, so it is applied in the same file that
// starts advertising.
const bleDeviceName = "conquest"

// setAdapterAlias sets the adapter's advertised name.
//
// The advertiser never set it, so the name stayed whatever the host happened to
// be called while the phone's `requestDevice({ filters: [{ name: ... }] })`
// looked for this dashboard's name. The scan could not match, so the feature
// did not work end to end (BUG-029).
//
// Passed as separate argv entries with no shell, and validated before it gets
// here, so a name can never be a command.
func setAdapterAlias(name string) error {
	out, err := exec.Command(
		"busctl", "set-property", "org.bluez",
		"/org/bluez/hci0", "org.bluez.Adapter", "Alias", "s", name,
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("set adapter alias: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// validateBleName trims and bounds the alias. The value reaches a process
// argument list, never a shell, but it is still checked so a name cannot be
// enormous, contain control characters, or be a surprise.
func validateBleName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if len(name) > 32 {
		return "", fmt.Errorf("name too long: %d characters, max 32", len(name))
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return "", fmt.Errorf("name contains a control character")
		}
	}
	return name, nil
}

func bleStartAdvertising(name string) error {
	ble.mu.Lock()
	defer ble.mu.Unlock()

	if ble.running && (name == "" || name == ble.name) {
		return nil
	}

	exec.Command("bluetoothctl", "--timeout", "5", "power", "on").Run()
	time.Sleep(200 * time.Millisecond)
	exec.Command("bluetoothctl", "--timeout", "5", "discoverable", "on").Run()

	if name != "" {
		if err := setAdapterAlias(name); err != nil {
			// Not fatal: the alias can be denied by policy, and advertising
			// without it is better than refusing to advertise at all. Say so,
			// though, because a mismatched name means the phone cannot find us.
			log.Printf("BLE: could not set advertised name to %q: %v", name, err)
		}
	}

	cmd := exec.Command("bash", "-c", `bluetoothctl <<'BLEEOF'
advertise on
BLEEOF
`)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Run()

	ble.running = true
	ble.name = name
	log.Printf("BLE: advertising started (name %q)", name)
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
	ble.name = ""
	log.Printf("BLE: advertising stopped")
	return nil
}

func handleBleTransmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireFeature(w, FeatureBleProximity) {
		return
	}
	var req struct {
		Action string `json:"action"`
		Name   string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	// The alias goes to a process argument list, never a shell, but it is still
	// bounded and character-checked so a name cannot be nonsense or enormous.
	name := strings.TrimSpace(req.Name)
	if len(name) > 32 {
		http.Error(w, "Name too long", http.StatusBadRequest)
		return
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			http.Error(w, "Name contains control characters", http.StatusBadRequest)
			return
		}
	}
	switch req.Action {
	case "start":
		if err := bleStartAdvertising(name); err != nil {
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
