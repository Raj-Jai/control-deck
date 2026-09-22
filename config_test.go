package main

import (
	"os"
	"path/filepath"
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
