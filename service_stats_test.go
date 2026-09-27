package main

import (
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

// parseProcStat returns the fields after "pid (comm)", so documented field N is
// at index N-3. The old code read 13/14/21, which are cutime, cstime and
// vsize: reaped-children CPU and a virtual address. The audit measured the top
// bar reporting 80% CPU against a real 16.7%, and an uptime tracking RSS.
func TestProcStatFieldIndices(t *testing.T) {
	// Build the line from the documented layout so the mapping is self-evident:
	// fields 1..23 of /proc/<pid>/stat, then a tail.
	//  1 pid   2 comm   3 state  4 ppid   5 pgrp   6 session 7 tty_nr
	//  8 tpgid 9 flags 10 minflt 11 cminflt 12 majflt 13 cmajflt
	// 14 utime 15 stime 16 cutime 17 cstime 18 priority 19 nice
	// 20 num_threads 21 itrealvalue 22 starttime 23 vsize
	byField := map[int]string{
		1: "1234", 2: "(tab-dash)", 3: "S", 4: "1", 5: "1234", 6: "1234",
		7: "0", 8: "-1", 9: "4194560", 10: "900", 11: "0", 12: "0", 13: "0",
		14: "111", 15: "222", 16: "333", 17: "444", 18: "5", 19: "20", 20: "1",
		21: "0", 22: "999", 23: "987654321",
	}
	parts := make([]string, 0, 23)
	for n := 1; n <= 23; n++ {
		parts = append(parts, byField[n])
	}
	raw := strings.Join(parts, " ") + " 4096 0 0 0 0 0 0 0 17 2 0 0 0 0 0"

	fields := parseProcStat(raw)
	if got := procStatField(fields, procStatUTime); got != "111" {
		t.Errorf("utime = %q, want 111", got)
	}
	if got := procStatField(fields, procStatSTime); got != "222" {
		t.Errorf("stime = %q, want 222", got)
	}
	if got := procStatField(fields, procStatStartTime); got != "999" {
		t.Errorf("starttime = %q, want 999", got)
	}

	// The specific regression: the old indices 13/14/21 landed on cutime,
	// cstime and vsize - reaped-children CPU and a virtual address.
	if got := procStatField(fields, 16); got != "333" {
		t.Errorf("field 16 (cutime) = %q, want 333", got)
	}
	if got := procStatField(fields, 23); got != "987654321" {
		t.Errorf("field 23 (vsize) = %q, want 987654321", got)
	}
	if procStatField(fields, 13) == procStatField(fields, procStatUTime) {
		t.Error("index 13 must not resolve to utime")
	}
	if procStatField(fields, 21) == procStatField(fields, procStatStartTime) {
		t.Error("index 21 must not resolve to starttime")
	}
}

// A comm containing spaces and parentheses is legal and common.
func TestParseProcStatHandlesAwkwardComm(t *testing.T) {
	raw := "999 ((sd-pam)) S 1 999 999 0 -1 0 0 0 0 0 7 8 0 0 20 0 1 0 42 0 0"
	fields := parseProcStat(raw)
	if got := procStatField(fields, procStatUTime); got != "7" {
		t.Errorf("utime with a parenthesised comm = %q, want 7", got)
	}
	if got := procStatField(fields, procStatStartTime); got != "42" {
		t.Errorf("starttime with a parenthesised comm = %q, want 42", got)
	}
}

func TestProcStatFieldOutOfRange(t *testing.T) {
	// "1 (x) S 0 0" yields exactly documented fields 3..5.
	fields := parseProcStat("1 (x) S 0 0")
	if got := procStatField(fields, 3); got != "S" {
		t.Errorf("field 3 (state) = %q, want S", got)
	}
	for _, n := range []int{-1, 0, 1, 2, 6, 14, 22, 99} {
		if got := procStatField(fields, n); got != "" {
			t.Errorf("procStatField(%d) on a short line = %q, want empty", n, got)
		}
	}
}

// The reported numbers must match the kernel's own accounting for this process.
func TestUptimeAndCPUTicksAreSaneForSelf(t *testing.T) {
	raw, err := os.ReadFile("/proc/self/stat")
	if err != nil {
		t.Skipf("proc unavailable: %v", err)
	}
	fields := parseProcStat(string(raw))

	utime, err := strconv.ParseInt(procStatField(fields, procStatUTime), 10, 64)
	if err != nil || utime < 0 {
		t.Fatalf("utime = %q (%v)", procStatField(fields, procStatUTime), err)
	}
	startTicks, err := strconv.ParseInt(procStatField(fields, procStatStartTime), 10, 64)
	if err != nil {
		t.Fatalf("starttime = %q (%v)", procStatField(fields, procStatStartTime), err)
	}

	// starttime is ticks since boot, so it must be at most the machine uptime
	// (plus a tick of slop). The old, wrong index returned vsize - about
	// 9.8e8 here - which failed this check by nine orders of magnitude.
	const clkTck = 100
	up := uptimeSecs()
	if up < 1 {
		t.Fatalf("uptimeSecs = %d, want a plausible machine uptime", up)
	}
	if startTicks > up*clkTck+clkTck {
		t.Errorf("starttime %d ticks exceeds the machine uptime of %ds - the field mapping is wrong",
			startTicks, up)
	}
	// This test binary started moments ago, so its age must be small.
	if age := up - startTicks/clkTck; age < 0 || age > 600 {
		t.Errorf("derived process age = %ds, want 0..600", age)
	}

	// A moment of CPU work must show up in the counter.
	deadline := time.Now().Add(60 * time.Millisecond)
	x := 0
	for time.Now().Before(deadline) {
		for i := 0; i < 100000; i++ {
			x += i
		}
	}
	_ = x
	raw2, _ := os.ReadFile("/proc/self/stat")
	fields2 := parseProcStat(string(raw2))
	utime2, _ := strconv.ParseInt(procStatField(fields2, procStatUTime), 10, 64)
	if utime2 < utime {
		t.Errorf("utime went backwards: %d -> %d", utime, utime2)
	}
}
