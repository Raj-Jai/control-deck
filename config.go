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
			break
		}
	}
	if appCfg == nil {
		log.Fatalf("config: no config.json found (%v)", err)
	}
}
