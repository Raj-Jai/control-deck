package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestIsEnabled(t *testing.T) {
	cases := []struct {
		name string
		cfg  *Config
		key  string
		want bool
	}{
		{"nil config defaults on", nil, FeatureTerminal, true},
		{"nil map defaults on", &Config{}, FeatureTerminal, true},
		{"empty map defaults on", &Config{Features: map[string]bool{}}, FeatureTerminal, true},
		{"explicit true", &Config{Features: map[string]bool{FeatureTerminal: true}}, FeatureTerminal, true},
		{"explicit false", &Config{Features: map[string]bool{FeatureTerminal: false}}, FeatureTerminal, false},
		{"other key false leaves target on", &Config{Features: map[string]bool{FeatureWeather: false}}, FeatureTerminal, true},
		{"unknown key still resolves", &Config{Features: map[string]bool{"whatever": false}}, "whatever", false},
		{"keys are case-sensitive", &Config{Features: map[string]bool{"Terminal": false}}, FeatureTerminal, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.cfg.IsEnabled(tc.key); got != tc.want {
				t.Errorf("IsEnabled(%q) = %v, want %v", tc.key, got, tc.want)
			}
		})
	}
}

func TestUnknownFeatureKeys(t *testing.T) {
	m := map[string]bool{FeatureWeather: false, "termnal": false}
	unknown := unknownFeatureKeys(m)
	if len(unknown) != 1 || unknown[0] != "termnal" {
		t.Errorf("unknownFeatureKeys = %v, want [termnal]", unknown)
	}
	if got := unknownFeatureKeys(nil); len(got) != 0 {
		t.Errorf("unknownFeatureKeys(nil) = %v, want empty", got)
	}
}

func loadFixture(t *testing.T, name string) *Config {
	t.Helper()
	cfg, err := loadConfig(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("loadConfig(%s): %v", name, err)
	}
	return cfg
}

// A pre-flags config must behave exactly as before: everything enabled.
func TestLegacyConfigAllEnabled(t *testing.T) {
	cfg := loadFixture(t, "config_legacy.json")
	for _, k := range KnownFeatures {
		if !cfg.IsEnabled(k) {
			t.Errorf("legacy config: IsEnabled(%q) = false, want true", k)
		}
	}
}

func TestPartialConfigOnlyTargetOff(t *testing.T) {
	cfg := loadFixture(t, "config_partial.json")
	if cfg.IsEnabled(FeatureWeather) {
		t.Errorf("partial config: IsEnabled(weather) = true, want false")
	}
	for _, k := range KnownFeatures {
		if k == FeatureWeather {
			continue
		}
		if !cfg.IsEnabled(k) {
			t.Errorf("partial config: IsEnabled(%q) = false, want true", k)
		}
	}
}

func TestExampleConfigRoundTrips(t *testing.T) {

	data, err := os.ReadFile("config.example.json")
	if err != nil {
		t.Fatalf("read example: %v", err)
	}
	cfg, err := loadConfig("config.example.json")
	if err != nil {
		t.Fatalf("parse example: %v", err)
	}
	_ = data
	for _, k := range KnownFeatures {
		v, ok := cfg.Features[k]
		if !ok || !v {
			t.Errorf("example config: key %q missing or not true", k)
		}
	}
}

// SIGHUP path: a valid reload swaps the live config (flags + derived PINs).
func TestReloadConfigSwapsLive(t *testing.T) {
	t.Setenv("CONFIG_PATH", filepath.Join("testdata", "config_partial.json"))
	prev := getConfig()
	t.Cleanup(func() {
		if prev != nil {
			configMu.Lock()
			appCfg.Store(prev)
			buildCommandMap()
			buildProfileCommandMap()
			configMu.Unlock()
		}
	})
	if err := reloadConfig(); err != nil {
		t.Fatalf("reloadConfig: %v", err)
	}
	if getConfig().IsEnabled(FeatureWeather) {
		t.Errorf("after reload: IsEnabled(weather) = true, want false")
	}
	if !getConfig().IsEnabled(FeatureTerminal) {
		t.Errorf("after reload: IsEnabled(terminal) = false, want true")
	}
	// Derived state must swap too: partial fixture sets pin 0000, so the
	// re-derived dashPIN proves buildCommandMap ran on reload.
	configMu.RLock()
	pin, ok := dashPIN, commandMap["mute"] != nil
	configMu.RUnlock()
	if pin != "0000" {
		t.Errorf("after reload: dashPIN = %q, want 0000 from fixture", pin)
	}
	if !ok {
		t.Errorf("after reload: commandMap missing base entry mute")
	}
}

// A malformed config must not replace the running config.
func TestReloadConfigKeepsPreviousOnError(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.WriteFile("config.json", []byte("{not json"), 0644); err != nil {
		t.Fatalf("write bad config: %v", err)
	}
	before := &Config{Features: map[string]bool{FeatureWeather: true}}
	appCfg.Store(before)
	t.Cleanup(func() { appCfg.Store(&Config{}) })
	if err := reloadConfig(); err == nil {
		t.Fatalf("reloadConfig with malformed JSON: expected error, got nil")
	}
	if getConfig() != before {
		t.Errorf("malformed reload replaced the live config")
	}
	if !getConfig().IsEnabled(FeatureWeather) {
		t.Errorf("malformed reload corrupted live contents")
	}
}

// CONFIG_PATH wins over ./config.json in reload, same as init.
func TestReloadConfigPathPrecedence(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	writeJSON(t, "config.json", map[string]any{"features": map[string]bool{"weather": true}})
	other := filepath.Join(t.TempDir(), "override.json")
	writeJSONFile(t, other, map[string]any{"features": map[string]bool{"weather": false}})
	t.Setenv("CONFIG_PATH", other)
	prev := getConfig()
	t.Cleanup(func() {
		if prev != nil {
			appCfg.Store(prev)
		}
	})
	if err := reloadConfig(); err != nil {
		t.Fatalf("reloadConfig: %v", err)
	}
	if getConfig().IsEnabled(FeatureWeather) {
		t.Errorf("CONFIG_PATH did not take precedence over ./config.json")
	}
}

// Shrinking the config must drop entries: a removed custom command and a
// removed flag revert to defaults instead of lingering.
func TestReloadConfigShrink(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	writeJSON(t, "config.json", map[string]any{
		"features":        map[string]bool{"weather": false},
		"custom_commands": map[string][]string{"myCmd": {"echo", "hi"}},
	})
	prev := getConfig()
	t.Cleanup(func() {
		if prev != nil {
			configMu.Lock()
			appCfg.Store(prev)
			buildCommandMap()
			buildProfileCommandMap()
			configMu.Unlock()
		}
	})
	if err := reloadConfig(); err != nil {
		t.Fatalf("reloadConfig: %v", err)
	}
	configMu.RLock()
	_, hasCustom := commandMap["myCmd"]
	configMu.RUnlock()
	if !hasCustom {
		t.Fatalf("setup: custom command myCmd missing after first reload")
	}
	writeJSON(t, "config.json", map[string]any{})
	if err := reloadConfig(); err != nil {
		t.Fatalf("reloadConfig: %v", err)
	}
	if !getConfig().IsEnabled(FeatureWeather) {
		t.Errorf("removed flag did not revert to enabled")
	}
	configMu.RLock()
	_, hasCustom = commandMap["myCmd"]
	configMu.RUnlock()
	if hasCustom {
		t.Errorf("removed custom command lingered after reload")
	}
}

// Concurrent reloads vs. concurrent readers must be race-free. Run with
// -race: this is the test that decides whether the design can ship.
func TestReloadConfigConcurrent(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	writeJSON(t, "config.json", map[string]any{"features": map[string]bool{"weather": false}})
	t.Cleanup(func() { appCfg.Store(&Config{}) })
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				_ = getConfig().IsEnabled(FeatureWeather)
				configMu.RLock()
				_ = commandMap["mute"]
				_ = dashPIN
				configMu.RUnlock()
			}
		}()
	}
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				_ = reloadConfig()
			}
		}()
	}
	wg.Wait()
}

func writeJSON(t *testing.T, name string, v map[string]any) {
	t.Helper()
	writeJSONFile(t, filepath.Join(mustCwd(t), name), v)
}

func writeJSONFile(t *testing.T, path string, v map[string]any) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatalf("write %s: %v", err, err)
	}
}

func mustCwd(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	return dir
}
