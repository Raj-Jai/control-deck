package main

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type GPUStats struct {
	Present  bool    `json:"present"`
	Name     string  `json:"name,omitempty"`
	Util     float64 `json:"util"`
	MemUsed  float64 `json:"mem_used"`
	MemTotal float64 `json:"mem_total"`
	Temp     float64 `json:"temp"`
}

type gpuBackend int

const (
	gpuNone gpuBackend = iota
	gpuNvidia
	gpuAMD
	gpuIntel
)

var detectedGPU gpuBackend = gpuNone
var gpuName string

// runTimeout executes a helper command with a hard deadline and kills it if it
// overruns. A wedged nvidia-smi - common while a driver resets - otherwise
// blocks the caller forever.
func runTimeout(timeout time.Duration, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return exec.CommandContext(ctx, name, args...).Output()
}

const (
	gpuProbeTimeout = 3 * time.Second
	gpuQueryTimeout = 2 * time.Second
)

func detectGPU() gpuBackend {
	if _, err := runTimeout(gpuProbeTimeout, "nvidia-smi", "--version"); err == nil {
		gpuName = "NVIDIA"
		return gpuNvidia
	}
	if out, err := runTimeout(gpuProbeTimeout, "sh", "-c", "ls /sys/class/drm/card0/device/ | grep -q gpu_busy_percent 2>/dev/null && echo amd"); err == nil && strings.TrimSpace(string(out)) == "amd" {
		gpuName = "AMD"
		return gpuAMD
	}
	if _, err := runTimeout(gpuProbeTimeout, "intel_gpu_top", "--version"); err == nil {
		gpuName = "Intel"
		return gpuIntel
	}
	return gpuNone
}

func fetchGPUStats() *GPUStats {
	if detectedGPU == gpuNone {
		detectedGPU = detectGPU()
	}
	if detectedGPU == gpuNone {
		return nil
	}

	switch detectedGPU {
	case gpuNvidia:
		return fetchNvidiaGPU()
	case gpuAMD:
		return fetchAMDGPU()
	case gpuIntel:
		return fetchIntelGPU()
	}
	return nil
}

func fetchNvidiaGPU() *GPUStats {
	out, err := runTimeout(gpuQueryTimeout, "nvidia-smi",
		"--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name",
		"--format=csv,noheader,nounits")
	if err != nil {
		return nil
	}
	parts := strings.Split(strings.TrimSpace(string(out)), ", ")
	if len(parts) < 5 {
		return nil
	}
	util, _ := strconv.ParseFloat(parts[0], 64)
	memUsed, _ := strconv.ParseFloat(parts[1], 64)
	memTotal, _ := strconv.ParseFloat(parts[2], 64)
	temp, _ := strconv.ParseFloat(parts[3], 64)
	name := strings.TrimSpace(parts[4])
	if name != "" {
		gpuName = name
	}
	return &GPUStats{
		Present:  true,
		Name:     gpuName,
		Util:     util,
		MemUsed:  memUsed,
		MemTotal: memTotal,
		Temp:     temp,
	}
}

func fetchAMDGPU() *GPUStats {
	util := readFloat("/sys/class/drm/card0/device/gpu_busy_percent")
	memUsed := readFloat("/sys/class/drm/card0/device/mem_info_vram_used") / 1024 / 1024
	memTotal := readFloat("/sys/class/drm/card0/device/mem_info_vram_total") / 1024 / 1024
	temp := readAMDTemp()
	return &GPUStats{
		Present:  true,
		Name:     gpuName,
		Util:     util,
		MemUsed:  memUsed,
		MemTotal: memTotal,
		Temp:     temp,
	}
}

func readAMDTemp() float64 {
	out, err := runTimeout(gpuQueryTimeout, "sh", "-c", "cat /sys/class/drm/card0/device/hwmon/hwmon*/temp1_input 2>/dev/null")
	if err != nil {
		return -1
	}
	v, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	return v / 1000
}

func readFloat(path string) float64 {
	out, err := runTimeout(gpuQueryTimeout, "cat", path)
	if err != nil {
		return -1
	}
	v, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	return v
}

func fetchIntelGPU() *GPUStats {
	// intel_gpu_top samples for 500ms by design, so it gets a longer deadline
	// than a query, but still a finite one.
	out, err := runTimeout(4*time.Second, "sh", "-c", "intel_gpu_top -J -s 500 -n 1 2>/dev/null")
	if err != nil {
		return nil
	}
	// Parse JSON output for render/balance utilization
	// Simplified: look for "render/3d" or "render" busy value
	if strings.Contains(string(out), `"busy"`) {
		// Extract first busy value found as rough util
		idx := strings.Index(string(out), `"busy":`)
		if idx >= 0 {
			end := strings.Index(string(out[idx:]), ",")
			if end < 0 {
				end = strings.Index(string(out[idx:]), "}")
			}
			if end > 0 {
				valStr := strings.TrimSpace(string(out[idx+7 : idx+end]))
				util, _ := strconv.ParseFloat(valStr, 64)
				return &GPUStats{
					Present: true,
					Name:    gpuName,
					Util:    util,
					Temp:    -1,
				}
			}
		}
	}
	return &GPUStats{Present: true, Name: gpuName}
}
