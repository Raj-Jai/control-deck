package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"
)

type Config struct {
	PIN               string              `json:"pin"`
	MediaPIN          string              `json:"media_pin"`
	BTMAC             string              `json:"bt_mac"`
	PingTarget        string              `json:"ping_target"`
	HTTPPort          int                 `json:"http_port"`
	HTTPSPort         int                 `json:"https_port"`
	CaffeineSchemaDir string              `json:"caffeine_schema_dir"`
	CustomCommands    map[string][]string `json:"custom_commands"`
	KDConnectPhone    string              `json:"kdeconnect_phone"`
	BroadcastHotkey   string              `json:"broadcast_hotkey"`
	// VLC's HTTP interface, which runs on its own port.
	VLCBaseURL  string        `json:"vlc_base_url"`
	VLCPassword string        `json:"vlc_password"`
	Scenes      []SceneConfig `json:"scenes"`
	// Features holds per-section feature flags. Absent map or absent key
	// means enabled, so existing configs behave exactly as before.
	// See KnownFeatures for the canonical key list.
	Features map[string]bool `json:"features"`
	// IDEWorkDir is the directory the IDE deck's git and task commands run in.
	// They used to inherit the dashboard's own working directory, so `git
	// stage` staged whatever the service happened to be started in, which is
	// not necessarily the repository the user was looking at.
	IDEWorkDir string `json:"ide_work_dir"`
}

// SceneConfig is a named one-tap macro of deck-command actions.
type SceneConfig struct {
	Name    string   `json:"name"`
	Icon    string   `json:"icon"`
	Actions []string `json:"actions"`
}

// Feature flag keys, one per major deck section. Add new sections here,
// in config.example.json, and in frontend/src/config/features.ts.
const (
	FeatureNowPlaying       = "now_playing"
	FeatureMixer            = "mixer"
	FeatureQuickSettings    = "quick_settings"
	FeatureGeoSurvey        = "geo_survey"
	FeatureBleProximity     = "ble_proximity"
	FeatureConnectedDevices = "connected_devices"
	FeatureWeather          = "weather"
	FeatureClipboard        = "clipboard"
	FeatureCommandLog       = "command_log"
	FeatureSystemStats      = "system_stats"
	FeatureServiceStats     = "service_stats"
	FeatureMediaBrowser     = "media_browser"
	FeatureVideoPlayer      = "video_player"
	FeatureIde              = "ide"
	FeatureTerminal         = "terminal"
	FeaturePower            = "power"
	FeatureScenes           = "scenes"
	FeatureFileDrop         = "filedrop"
)

// KnownFeatures is the canonical set of feature flag keys, used to warn
// about typos in config.json (a typo silently leaves the feature enabled).
var KnownFeatures = []string{
	FeatureNowPlaying,
	FeatureMixer,
	FeatureQuickSettings,
	FeatureGeoSurvey,
	FeatureBleProximity,
	FeatureConnectedDevices,
	FeatureWeather,
	FeatureClipboard,
	FeatureCommandLog,
	FeatureSystemStats,
	FeatureServiceStats,
	FeatureMediaBrowser,
	FeatureVideoPlayer,
	FeatureIde,
	FeatureTerminal,
	FeaturePower,
	FeatureScenes,
	FeatureFileDrop,
}

// unknownFeatureKeys returns configured keys outside the known set.
func unknownFeatureKeys(m map[string]bool) []string {
	var unknown []string
	for k := range m {
		known := false
		for _, kf := range KnownFeatures {
			if k == kf {
				known = true
				break
			}
		}
		if !known {
			unknown = append(unknown, k)
		}
	}
	return unknown
}

// IsEnabled reports whether a feature flag is on.
// A nil config, nil map, or absent key all default to true.
func (c *Config) IsEnabled(name string) bool {
	if c == nil || c.Features == nil {
		return true
	}
	v, ok := c.Features[name]
	return !ok || v
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return &cfg, nil
}

var appCfg atomic.Pointer[Config]

// configMu guards the derived globals rebuilt from the config
// (commandMap, dashPIN, dashMediaPIN, caffeineSD). The *Config pointer
// itself swaps atomically, but these package-level values are written by
// buildCommandMap/buildProfileCommandMap while request handlers read
// them — all sides must hold configMu.
var configMu sync.RWMutex

// getConfig returns the active config snapshot. The pointer is swapped
// atomically on SIGHUP reload, so per-request readers always see a
// complete config without locking.
func getConfig() *Config {
	if cfg := appCfg.Load(); cfg != nil {
		return cfg
	}
	// Before initConfig - in tests, or in the window before the first load -
	// this used to hand back nil, so any caller that read a field panicked.
	// A zero Config behaves like an empty config.json, which is what a missing
	// file already means.
	return &Config{}
}

func initConfig() {
	paths := []string{"config.json"}
	if p := os.Getenv("CONFIG_PATH"); p != "" {
		paths = append([]string{p}, paths...)
	}
	var cfg *Config
	var err error
	for _, p := range paths {
		cfg, err = loadConfig(p)
		if err == nil {
			appCfg.Store(cfg)
			log.Printf("config: loaded from %s", p)
			for _, k := range unknownFeatureKeys(cfg.Features) {
				log.Printf("config: warning: unknown feature flag %q (typo? known: %v)", k, KnownFeatures)
			}
			break
		}
	}
	if getConfig() == nil {
		log.Fatalf("config: no config.json found (%v)", err)
	}
}

// reloadConfig re-reads config.json (or CONFIG_PATH) and swaps it in,
// re-deriving PINs and the command map. A failed reload keeps the previous
// running config. NOTE: http/https ports are bound at startup and still
// require a restart. NOTE: changing PINs invalidates live sessions —
// intended (PIN rotation without restart), but be deliberate about it.
func reloadConfig() error {
	paths := []string{"config.json"}
	if p := os.Getenv("CONFIG_PATH"); p != "" {
		paths = append([]string{p}, paths...)
	}
	var lastErr error
	for _, p := range paths {
		cfg, err := loadConfig(p)
		if err != nil {
			lastErr = err
			continue
		}
		for _, k := range unknownFeatureKeys(cfg.Features) {
			log.Printf("config: warning: unknown feature flag %q (typo? known: %v)", k, KnownFeatures)
		}
		// Derive-then-swap under one lock: readers either see the full
		// old state or the full new state, never a mix. This also
		// serializes concurrent reloads.
		configMu.Lock()
		appCfg.Store(cfg)
		buildCommandMap()
		buildProfileCommandMap()
		configMu.Unlock()
		log.Printf("config: reloaded from %s", p)
		return nil
	}
	return lastErr
}
