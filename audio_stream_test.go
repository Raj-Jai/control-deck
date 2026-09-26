package main

import (
	"os/exec"
	"testing"
	"time"
)

func newTestStreamManager() *StreamManager {
	return &StreamManager{listeners: make(map[chan []byte]bool)}
}

// A capture pipeline that dies on its own leaves ffCmd nil while the restart
// backoff is still pending. A client disconnecting in that window used to hit
// an early return in stopLocked, so the generation never advanced and the
// pending restart went on to resurrect a stream the user had stopped.
func TestStopInvalidatesPendingRestartAfterCrash(t *testing.T) {
	m := newTestStreamManager()
	m.ffCmd = nil // readLoop already cleared it after the pipe broke

	before := m.gen
	m.mu.Lock()
	m.stopLocked()
	after := m.gen
	m.mu.Unlock()

	if after == before {
		t.Fatalf("stopLocked did not advance the generation with no live process: gen stayed %d", before)
	}
}

func TestStopKillsLiveProcessAndAdvancesGeneration(t *testing.T) {
	m := newTestStreamManager()
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot start helper process: %v", err)
	}
	m.ffCmd = cmd
	m.stopCh = make(chan struct{})

	before := m.gen
	m.mu.Lock()
	m.stopLocked()
	after := m.gen
	m.mu.Unlock()

	if after == before {
		t.Errorf("stopLocked did not advance the generation: gen stayed %d", before)
	}
	if m.ffCmd != nil {
		t.Error("stopLocked left ffCmd set after a live stop")
	}
	if err := cmd.Wait(); err == nil {
		t.Error("expected a non-nil Wait error for a killed process")
	}
}

// If the generation moved on while the backoff was sleeping, the retry loop
// must abandon quietly. Reporting failure here would call failAll and tear down
// a stream that had just been started or intentionally stopped.
func TestRestartBackoffAbandonsWhenGenerationChanged(t *testing.T) {
	m := newTestStreamManager()
	stale := m.gen
	m.gen++ // a Stop() or a fresh start happened after the crash

	m.scheduleRestart(stale)
	time.Sleep(restartBaseDelay + 1500*time.Millisecond)

	m.mu.Lock()
	lastErr := m.lastErr
	m.mu.Unlock()

	if lastErr != "" {
		t.Errorf("stale restart backoff recorded an error: %q", lastErr)
	}
	if len(m.listeners) != 0 {
		t.Errorf("stale restart backoff touched %d listener(s)", len(m.listeners))
	}
}

func TestFrameSizeMatchesDeclaredFormat(t *testing.T) {
	if got := frameSamples * channels * bytesPerSample; got != frameBytes {
		t.Errorf("frameBytes = %d, want %d", frameBytes, got)
	}
}
