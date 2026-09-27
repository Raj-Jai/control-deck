package main

import (
	"encoding/json"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ServiceInfo struct {
	Name       string  `json:"name"`
	PID        int     `json:"pid"`
	CPUPercent float64 `json:"cpu_percent"`
	MemRSSKB   int64   `json:"mem_rss_kb"`
	Status     string  `json:"status"`
	UptimeSecs int64   `json:"uptime_secs"`

	// CPUTicks is the raw utime+stime counter, kept internal so the sampler can
	// derive a rate between ticks without re-reading /proc on the request path.
	CPUTicks int64 `json:"-"`
}

var trackedServices = []string{
	"tab-dashboard",
	"ffmpeg",
}

// Sampling CPU means reading /proc twice with a gap in between, so it cannot
// happen inside an HTTP handler. handleServiceStats used to block for
// 200ms per tracked service - roughly 600ms of pure sleep in the request path,
// on a poller the browser hits every few seconds. The sampler runs in the
// background and the handler is a pure read of the last snapshot.
const cpuSampleInterval = 2 * time.Second
const cpuSampleWindow = 200 * time.Millisecond

var (
	statsSnapshot atomic.Pointer[[]ServiceInfo]
	prevCPUTicks  = map[string]int64{}
	prevCPUSample time.Time
	prevCPUMu     sync.Mutex
)

// collectServiceStats returns the most recent background sample, or takes a
// fresh one if the sampler has not run yet.
func collectServiceStats() []ServiceInfo {
	if s := statsSnapshot.Load(); s != nil {
		return *s
	}
	return sampleServiceStats(time.Now())
}

func sampleServiceStats(now time.Time) []ServiceInfo {
	var results []ServiceInfo
	for _, name := range trackedServices {
		results = append(results, queryProcessByName(name, now))
	}

	// Derive CPU% from the delta against the previous tick.
	prevCPUMu.Lock()
	if prevCPUSample.IsZero() {
		prevCPUSample = now
	} else if elapsed := now.Sub(prevCPUSample); elapsed > 0 {
		const clkTck = 100.0
		for i := range results {
			name := results[i].Name
			if results[i].PID == 0 {
				delete(prevCPUTicks, name)
				continue
			}
			prev, seen := prevCPUTicks[name]
			prevCPUTicks[name] = results[i].CPUTicks
			if !seen {
				continue
			}
			delta := results[i].CPUTicks - prev
			if delta < 0 {
				// The process was replaced, not wrapped.
				continue
			}
			// Ticks per second across all CPUs.
			pct := float64(delta) / clkTck / elapsed.Seconds() * 100
			results[i].CPUPercent = math.Round(pct*10) / 10
		}
		prevCPUSample = now
	}
	prevCPUMu.Unlock()

	snap := results
	statsSnapshot.Store(&snap)
	return results
}

// startServiceStatsSampler keeps the snapshot fresh off the request path.
func startServiceStatsSampler() {
	go func() {
		for {
			sampleServiceStats(time.Now())
			time.Sleep(cpuSampleInterval)
		}
	}()
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
			utime, _ := strconv.ParseInt(procStatField(fields, procStatUTime), 10, 64)
			stime, _ := strconv.ParseInt(procStatField(fields, procStatSTime), 10, 64)
			startTimeTicks, _ := strconv.ParseInt(procStatField(fields, procStatStartTime), 10, 64)
			clkTck := int64(100) // sysconf(_SC_CLK_TCK)
			bootTime := now.Unix() - uptimeSecs()
			startTimeUnix := bootTime + startTimeTicks/clkTck
			si.UptimeSecs = now.Unix() - startTimeUnix
			if si.UptimeSecs < 0 {
				si.UptimeSecs = 0
			}
			si.CPUTicks = utime + stime
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

		break
	}
	return si
}

// procStatFields are the /proc/<pid>/stat fields this package needs, expressed
// as their 1-based index in the documented layout.
//
// parseProcStat returns the fields *after* "pid (comm)", so documented field N
// lives at index N-3. The previous code used 13/14/21, which are cutime, cstime
// and vsize - reaped-children CPU and a virtual address. That is why the top
// bar reported 80% CPU against a real 16.7%, and an uptime that tracked RSS.
const (
	procStatUTime     = 14 // user CPU time, clock ticks
	procStatSTime     = 15 // kernel CPU time, clock ticks
	procStatStartTime = 22 // start time, clock ticks since boot
	procStatFieldsOff = 3  // fields 1..3 are pid, comm and state
)

func parseProcStat(raw string) []string {
	// Find last ')' to handle comm with spaces/parens
	idx := strings.LastIndex(raw, ")")
	if idx < 0 {
		return nil
	}
	rest := strings.TrimSpace(raw[idx+1:])
	return strings.Fields(rest)
}

// procStatField returns documented field n (1-based) from a parsed stat line.
func procStatField(fields []string, n int) string {
	i := n - procStatFieldsOff
	if i < 0 || i >= len(fields) {
		return ""
	}
	return fields[i]
}

// The boot time never changes, so it is computed once behind a sync.Once. Two
// bare globals guarded only by a bool meant two concurrent HTTP handlers could
// both read a half-written time.Time.
var (
	bootTimeOnce  sync.Once
	bootTimeCache time.Time
)

func uptimeSecs() int64 {
	bootTimeOnce.Do(func() {
		bootTimeCache = time.Now()
		raw, err := os.ReadFile("/proc/stat")
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(raw), "\n") {
			if strings.HasPrefix(line, "btime ") {
				if secs, err := strconv.ParseInt(strings.TrimSpace(line[6:]), 10, 64); err == nil {
					bootTimeCache = time.Unix(secs, 0)
				}
			}
		}
	})
	return int64(time.Since(bootTimeCache).Seconds())
}

func handleServiceStats(w http.ResponseWriter, r *http.Request) {
	if !requireFeature(w, FeatureServiceStats) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(collectServiceStats())
}
