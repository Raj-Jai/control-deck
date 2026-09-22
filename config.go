package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
)

type Config struct {
	PIN               string              `json:"pin"`
	MediaPIN          string              `json:"media_pin"`
	BTMAC             string              `json:"bt_mac"`
	PingTarget       string              `json:"ping_target"`
	HTTPPort         int                 `json:"http_port"`
	HTTPSPort        int                 `json:"https_port"`
	CaffeineSchemaDir string             `json:"caffeine_schema_dir"`
	CustomCommands   map[string][]string `json:"custom_commands"`
	KDConnectPhone   string              `json:"kdeconnect_phone"`
	// Features holds per-section feature flags. Absent map or absent key
	// means enabled, so existing configs behave exactly as before.
	// See KnownFeatures for the canonical key list.
	Features map[string]bool `json:"features"`
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

var appCfg *Config

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
			appCfg = cfg
			log.Printf("config: loaded from %s", p)
			for _, k := range unknownFeatureKeys(cfg.Features) {
				log.Printf("config: warning: unknown feature flag %q (typo? known: %v)", k, KnownFeatures)
			}
			break
		}
	}
	if appCfg == nil {
		log.Fatalf("config: no config.json found (%v)", err)
	}
}
