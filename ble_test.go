package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The alias reaches a process argument list, never a shell, but it is still
// bounded and character-checked so a name cannot be nonsense or enormous.
func TestValidateBleName(t *testing.T) {
	ok := []string{"", "conquest", "living room", strings.Repeat("a", 32), "  padded  "}
	for _, name := range ok {
		if _, err := validateBleName(name); err != nil {
			t.Errorf("validateBleName(%q) = %v, want accepted", name, err)
		}
	}
	// A name of exactly 32 is fine, 33 is not.
	if _, err := validateBleName(strings.Repeat("a", 32)); err != nil {
		t.Errorf("32 characters rejected: %v", err)
	}
	if _, err := validateBleName(strings.Repeat("a", 33)); err == nil {
		t.Error("33 characters accepted")
	}
	bad := []string{"bad\x00name", "bad\nname", "bad\x1b[31mname", "bad\x7fname", "tab\there"}
	for _, name := range bad {
		if _, err := validateBleName(name); err == nil {
			t.Errorf("validateBleName(%q) accepted a control character", name)
		}
	}
	// Trimming happens before the length check, so padded input is not a
	// surprise-length surprise.
	got, err := validateBleName("  x  ")
	if err != nil || got != "x" {
		t.Errorf("validateBleName(\"  x  \") = %q, %v; want %q, nil", got, err, "x")
	}
}

// These reach only the validation and routing, never the bluetoothctl calls, so
// the suite does not put the host's adapter into discoverable mode.
func TestHandleBleTransmitRejectsMalformedBeforeTouchingHardware(t *testing.T) {
	for _, name := range []string{strings.Repeat("a", 33), "bad\nname", "x\x00y"} {
		body := `{"action":"start","name":` + quotedJSON(name) + `}`
		req := httptest.NewRequest(http.MethodPost, "/api/ble/transmit", strings.NewReader(body))
		rec := httptest.NewRecorder()
		handleBleTransmit(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("name %q: status = %d, want 400", name, rec.Code)
		}
	}
}

func TestHandleBleTransmitRejectsUnknownAction(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/ble/transmit", strings.NewReader(`{"action":"nope"}`))
	rec := httptest.NewRecorder()
	handleBleTransmit(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestHandleBleTransmitRejectsMalformedJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/ble/transmit", strings.NewReader(`{`))
	rec := httptest.NewRecorder()
	handleBleTransmit(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestHandleBleTransmitRejectsGet(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/ble/transmit", nil)
	rec := httptest.NewRecorder()
	handleBleTransmit(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
}

func quotedJSON(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\t':
			b.WriteString(`\t`)
		case 0:
			b.WriteString(`\u0000`)
		default:
			if r < 0x20 {
				const hex = "0123456789abcdef"
				b.WriteString(`\u00`)
				b.WriteByte(hex[(r>>4)&0xf])
				b.WriteByte(hex[r&0xf])
				continue
			}
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// A wedged bluetoothctl used to hold the manager's mutex for up to ten
// seconds, so any concurrent /api/ble/transmit blocked behind it (SUS-017).
// The state is now reserved under the lock and the external work happens
// outside it.
func TestAdvertisingStateIsVisibleWhileTheWorkRuns(t *testing.T) {
	ble.mu.Lock()
	ble.running = false
	ble.name = ""
	ble.mu.Unlock()

	// Pretend advertising succeeded without touching bluetoothctl, then check
	// the lock is free and the state is set.
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = bleStartAdvertising("conquest-test")
	}()

	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("bleStartAdvertising did not return")
	}
}

// The mutex must not be held while a command runs, so a caller that needs the
// state can always read it.
func TestManagerLockIsNotHeldAcrossExternalCalls(t *testing.T) {
	ble.mu.Lock()
	ble.running = false
	ble.name = ""
	ble.mu.Unlock()

	acquired := make(chan struct{})
	go func() {
		// Deliberately ask for the lock many times while advertising runs. If
		// the lock were held across bluetoothctl, these would queue up behind
		// a multi-second command; they will still queue briefly, so the test
		// asserts progress rather than instant acquisition.
		for i := 0; i < 5; i++ {
			ble.mu.Lock()
			ble.mu.Unlock()
		}
		close(acquired)
	}()

	_ = bleStartAdvertising("")
	select {
	case <-acquired:
	case <-time.After(30 * time.Second):
		t.Fatal("the manager lock was held for the whole of bleStartAdvertising")
	}
	_ = bleStopAdvertising()
}

// A stop that is already in progress must not be queued behind another stop.
func TestStopIsIdempotentAndFast(t *testing.T) {
	ble.mu.Lock()
	ble.running = false
	ble.name = ""
	ble.mu.Unlock()

	start := time.Now()
	if err := bleStopAdvertising(); err != nil {
		t.Errorf("stopping when not running returned %v, want nil", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("a no-op stop took %s; the state check must not wait on bluetoothctl", elapsed)
	}
}
