package main

import (
	"fmt"
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

const (
	defaultBroadcastHotkey = "<Control><Alt>b"
	hotkeyName             = "Toggle Tab-Dashboard Broadcast"
)

// ensureBroadcastHotkey registers a GNOME custom keybinding that toggles
// broadcast (mute + stream to all devices) without opening the dashboard.
// It is idempotent and safe to call on every startup.
func ensureBroadcastHotkey() {
	cfg := getConfig()
	if cfg == nil {
		return
	}
	hotkey := strings.TrimSpace(cfg.BroadcastHotkey)
	if hotkey == "" {
		hotkey = defaultBroadcastHotkey
	}
	lower := strings.ToLower(hotkey)
	if lower == "disabled" || lower == "none" || lower == "off" {
		log.Printf("hotkey: broadcast hotkey disabled via config")
		return
	}

	port := cfg.HTTPPort
	if port == 0 {
		port = 8080
	}
	// Command executed by GNOME when the hotkey is pressed. Uses curl to
	// hit the toggle endpoint so no dashboard UI is needed.
	command := fmt.Sprintf(
		`sh -c 'curl -s -X POST http://localhost:%d/api/stream/broadcast -H "Content-Type: application/json" -d "{\"action\":\"toggle\"}" > /dev/null'`,
		port,
	)

	if err := ensureGnomeKeybinding(hotkeyName, command, hotkey); err != nil {
		log.Printf("hotkey: failed to ensure GNOME keybinding: %v", err)
	} else {
		log.Printf("hotkey: ensured GNOME keybinding %q -> %q", hotkey, command)
	}
}

// ensureGnomeKeybinding makes sure a custom keybinding with the given name
// exists and points to command+binding. It creates or updates the entry.
func ensureGnomeKeybinding(name, command, binding string) error {
	if _, err := exec.LookPath("gsettings"); err != nil {
		return fmt.Errorf("gsettings not found (not GNOME?)")
	}

	// Check existing bindings for a match by name.
	existing, err := getCustomKeybindings()
	if err != nil {
		return err
	}

	for _, path := range existing {
		n, _ := gsettingsGet(path, "name")
		if strings.Trim(n, "'") == name {
			// Found our entry — update if needed.
			curCmd, _ := gsettingsGet(path, "command")
			curBind, _ := gsettingsGet(path, "binding")
			// gsettings returns quoted strings; compare trimmed.
			trimCmd := strings.Trim(curCmd, "'")
			trimBind := strings.Trim(curBind, "'")
			if trimCmd != command || trimBind != binding {
				if err := gsettingsSet(path, "command", command); err != nil {
					return err
				}
				if err := gsettingsSet(path, "binding", binding); err != nil {
					return err
				}
				if err := gsettingsSet(path, "name", name); err != nil {
					return err
				}
			}
			return nil
		}
	}

	// Also check if a binding already claims the same key combo for a different
	// command — warn but don't overwrite the user's other shortcut.
	for _, path := range existing {
		b, _ := gsettingsGet(path, "binding")
		if strings.Trim(b, "'") == binding {
			n, _ := gsettingsGet(path, "name")
			log.Printf("hotkey: warning: binding %q already used by %q (%s), will still create %q", binding, strings.Trim(n, "'"), path, name)
			break
		}
	}

	// Find next free custom index.
	nextIdx := findNextCustomIndex(existing)
	newPath := fmt.Sprintf("/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom%d/", nextIdx)

	// Append to the list.
	newList := append(existing, newPath)
	if err := setCustomKeybindings(newList); err != nil {
		return err
	}

	// Set the three keys for the new entry.
	if err := gsettingsSet(newPath, "name", name); err != nil {
		return err
	}
	if err := gsettingsSet(newPath, "command", command); err != nil {
		return err
	}
	if err := gsettingsSet(newPath, "binding", binding); err != nil {
		return err
	}
	return nil
}

func getCustomKeybindings() ([]string, error) {
	out, err := exec.Command("gsettings", "get", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings").Output()
	if err != nil {
		return nil, fmt.Errorf("gsettings get custom-keybindings: %w", err)
	}
	s := strings.TrimSpace(string(out))
	if s == "@as []" || s == "[]" {
		return nil, nil
	}
	// Extract quoted paths: '...'
	re := regexp.MustCompile(`'([^']+)'`)
	matches := re.FindAllStringSubmatch(s, -1)
	var res []string
	for _, m := range matches {
		res = append(res, m[1])
	}
	return res, nil
}

func setCustomKeybindings(paths []string) error {
	// Build GVariant array string: "['/path1/', '/path2/']"
	var quoted []string
	for _, p := range paths {
		quoted = append(quoted, fmt.Sprintf("'%s'", p))
	}
	val := "[" + strings.Join(quoted, ", ") + "]"
	cmd := exec.Command("gsettings", "set", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings", val)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("gsettings set custom-keybindings: %w | %s", err, string(out))
	}
	return nil
}

func findNextCustomIndex(existing []string) int {
	used := make(map[int]bool)
	re := regexp.MustCompile(`custom(\d+)/`)
	for _, p := range existing {
		if m := re.FindStringSubmatch(p); m != nil {
			if n, err := strconv.Atoi(m[1]); err == nil {
				used[n] = true
			}
		}
	}
	for i := 0; i < 100; i++ {
		if !used[i] {
			return i
		}
	}
	return len(existing)
}

func gsettingsGet(path, key string) (string, error) {
	schema := "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:" + path
	out, err := exec.Command("gsettings", "get", schema, key).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func gsettingsSet(path, key, value string) error {
	schema := "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:" + path
	cmd := exec.Command("gsettings", "set", schema, key, value)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("gsettings set %s %s: %w | %s", schema, key, err, string(out))
	}
	return nil
}
