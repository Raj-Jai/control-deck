package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type ServiceInfo struct {
	Name         string  `json:"name"`
	PID          int     `json:"pid"`
	CPUPercent   float64 `json:"cpu_percent"`
	MemRSSKB     int64   `json:"mem_rss_kb"`
	Status       string  `json:"status"`
	UptimeSecs   int64   `json:"uptime_secs"`
}

var trackedServices = []string{
	"tab-dashboard",
	"ffmpeg",
}

func collectServiceStats() []ServiceInfo {
	now := time.Now()
	var results []ServiceInfo
	for _, name := range trackedServices {
		results = append(results, queryProcessByName(name, now))
	}
	return results
}

func queryProcessByName(name string, now time.Time) ServiceInfo {
	si := ServiceInfo{Name: name, Status: "stopped"}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return si
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		comm, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "comm"))
		if err != nil {
			continue
		}
		commStr := strings.TrimSpace(string(comm))
		if commStr != name {
			continue
		}
		// Found matching process
		si.PID = pid
		si.Status = "running"

		// Read stat
		statRaw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if err == nil {
			fields := parseProcStat(string(statRaw))
			if len(fields) >= 22 {
				// utime + stime (fields 13, 14) in clock ticks
				utime, _ := strconv.ParseInt(fields[13], 10, 64)
				stime, _ := strconv.ParseInt(fields[14], 10, 64)
				totalTicks := utime + stime
				// starttime (field 21) in clock ticks since boot
				startTimeTicks, _ := strconv.ParseInt(fields[21], 10, 64)
				clkTck := int64(100) // sysconf(_SC_CLK_TCK)
				bootTime := now.Unix() - uptimeSecs()
				startTimeUnix := bootTime + startTimeTicks/clkTck
				si.UptimeSecs = now.Unix() - startTimeUnix
				if si.UptimeSecs < 0 {
					si.UptimeSecs = 0
				}
				_ = totalTicks // could compute CPU% over interval with sampling
			}
		}

		// Read status for RSS
		statusRaw, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "status"))
		if err == nil {
			for _, line := range strings.Split(string(statusRaw), "\n") {
				if strings.HasPrefix(line, "VmRSS:") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						si.MemRSSKB, _ = strconv.ParseInt(fields[1], 10, 64)
					}
				}
			}
		}

		// Quick CPU% snapshot: sample over 100ms
		cpuPct := sampleCPU(pid)
		if cpuPct >= 0 {
			si.CPUPercent = cpuPct
		}

		break
	}
	return si
}

func sampleCPU(pid int) float64 {
	start, err := readProcStat(pid)
	if err != nil {
		return -1
	}
	time.Sleep(200 * time.Millisecond)
	end, err := readProcStat(pid)
	if err != nil {
		return -1
	}

	totalDelta := end.totalCPU - start.totalCPU
	timeDeltaMs := end.time.Sub(start.time).Milliseconds()
	if timeDeltaMs <= 0 {
		return -1
	}
	clkTck := float64(100)
	pct := (float64(totalDelta) / clkTck) / (float64(timeDeltaMs) / 1000.0) * 100
	if pct < 0 {
		return 0
	}
	return pct
}

type procStatSample struct {
	totalCPU int64
	time     time.Time
}

func readProcStat(pid int) (procStatSample, error) {
	raw, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "stat"))
	if err != nil {
		return procStatSample{}, err
	}
	fields := parseProcStat(string(raw))
	if len(fields) < 15 {
		return procStatSample{}, fmt.Errorf("too few fields")
	}
	utime, _ := strconv.ParseInt(fields[13], 10, 64)
	stime, _ := strconv.ParseInt(fields[14], 10, 64)
	return procStatSample{totalCPU: utime + stime, time: time.Now()}, nil
}

func parseProcStat(raw string) []string {
	// Find last ')' to handle comm with spaces/parens
	idx := strings.LastIndex(raw, ")")
	if idx < 0 {
		return nil
	}
	rest := strings.TrimSpace(raw[idx+1:])
	return strings.Fields(rest)
}

var bootTimeCache time.Time
var bootTimeOnce bool

func uptimeSecs() int64 {
	if !bootTimeOnce {
		bootTimeOnce = true
		raw, err := os.ReadFile("/proc/stat")
		if err == nil {
			for _, line := range strings.Split(string(raw), "\n") {
				if strings.HasPrefix(line, "btime ") {
					secs, _ := strconv.ParseInt(strings.TrimSpace(line[6:]), 10, 64)
					bootTimeCache = time.Unix(secs, 0)
				}
			}
		}
		if bootTimeCache.IsZero() {
			bootTimeCache = time.Now()
		}
	}
	return int64(time.Since(bootTimeCache).Seconds())
}

func handleServiceStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(collectServiceStats())
}
