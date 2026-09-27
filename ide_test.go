package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunIdeCommandReturnsOutput(t *testing.T) {
	ok, out := runIdeCommand("echo-ok", []string{"sh", "-c", "echo hello from the task"})
	if !ok {
		t.Errorf("ok = false, want true (output %q)", out)
	}
	if !strings.Contains(out, "hello from the task") {
		t.Errorf("output = %q, want it to contain the command's stdout", out)
	}
}

func TestRunIdeCommandReportsFailure(t *testing.T) {
	// A failing command must not look like a successful one.
	ok, out := runIdeCommand("boom", []string{"sh", "-c", "echo nope >&2; exit 3"})
	if ok {
		t.Error("ok = true for a command that exited 3")
	}
	if !strings.Contains(out, "nope") {
		t.Errorf("output = %q, want the stderr text", out)
	}
	if !strings.Contains(out, "exit status 3") {
		t.Errorf("output = %q, want the exit status", out)
	}
}

func TestRunIdeCommandTruncatesLongOutput(t *testing.T) {
	// A runaway build must not buffer without limit; the tail is kept because
	// that is where the error is.
	ok, out := runIdeCommand("flood", []string{"sh", "-c", "yes x | head -c 200000"})
	if !ok {
		t.Error("ok = false, want true")
	}
	if len(out) > ideOutputMaxBytes+200 {
		t.Errorf("output is %d bytes, want at most about %d", len(out), ideOutputMaxBytes)
	}
	if !strings.HasSuffix(strings.TrimSpace(out), "x") {
		t.Error("the kept output should be the tail, ending mid-stream")
	}
}

// A hanging build must not hang the deck forever. The timeout is shortened
// rather than waited out.
func TestRunIdeCommandTimesOut(t *testing.T) {
	prev := ideCommandTimeout
	ideCommandTimeout = 300 * time.Millisecond
	t.Cleanup(func() { ideCommandTimeout = prev })

	start := time.Now()
	ok, out := runIdeCommand("sleepy", []string{"sh", "-c", "sleep 30"})
	if ok {
		t.Error("ok = true for a command that was killed")
	}
	if !strings.Contains(out, "timed out") {
		t.Errorf("output = %q, want a timeout note", out)
	}
	if elapsed := time.Since(start); elapsed > 20*time.Second {
		t.Errorf("took %s, expected it to be cut off at 300ms", elapsed)
	}
}

// The command map is built at startup; a test that registers a command needs it
// to exist first.
func init() {
	if commandMap == nil {
		buildCommandMap()
	}
}

func TestRunIdeCommandEmptyArgs(t *testing.T) {
	ok, out := runIdeCommand("nothing", nil)
	if ok || out == "" {
		t.Errorf("ok = %v, out = %q; want a failure with an explanation", ok, out)
	}
}

// The commands used to inherit the dashboard's own working directory, so they
// acted on whichever repository the service happened to be started in.
// withConfig swaps the loaded config for the duration of a test.
func withConfig(t *testing.T, cfg Config) {
	t.Helper()
	prev := getConfig()
	appCfg.Store(&cfg)
	t.Cleanup(func() { appCfg.Store(prev) })
}

func TestIdeWorkDirHonoursConfig(t *testing.T) {
	dir := t.TempDir()
	withConfig(t, Config{IDEWorkDir: dir})
	if got := ideWorkDir(); got != dir {
		t.Errorf("ideWorkDir() = %q, want %q", got, dir)
	}
}

func TestIdeWorkDirIgnoresMissingDirectory(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "nope")
	withConfig(t, Config{IDEWorkDir: missing})
	if got := ideWorkDir(); got == missing {
		t.Error("a missing ide_work_dir was accepted")
	}
}

// A file is not a directory.
func TestIdeWorkDirIgnoresFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	withConfig(t, Config{IDEWorkDir: file})
	if got := ideWorkDir(); got == file {
		t.Error("a file was accepted as the work directory")
	}
}

// The command handler used to answer "ok" the moment the work was queued.
func TestHandleCommandReportsIdeResult(t *testing.T) {
	// The task_ prefix is what routes this down the IDE path.
	configMu.Lock()
	commandMap["task_test_echo"] = []string{"sh", "-c", "echo reported"}
	configMu.Unlock()
	defer func() {
		configMu.Lock()
		delete(commandMap, "task_test_echo")
		configMu.Unlock()
	}()

	req := httptest.NewRequest(http.MethodPost, "/api/command",
		strings.NewReader(`{"command":"task_test_echo"}`))
	rec := httptest.NewRecorder()
	handleCommand(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		OK     bool   `json:"ok"`
		Output string `json:"output"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if !body.OK {
		t.Error("ok = false, want true")
	}
	if !strings.Contains(body.Output, "reported") {
		t.Errorf("output = %q, want the command's own output", body.Output)
	}
}

func TestHandleCommandReportsIdeFailure(t *testing.T) {
	configMu.Lock()
	commandMap["task_test_fail"] = []string{"sh", "-c", "echo bad >&2; exit 1"}
	configMu.Unlock()
	defer func() {
		configMu.Lock()
		delete(commandMap, "task_test_fail")
		configMu.Unlock()
	}()

	req := httptest.NewRequest(http.MethodPost, "/api/command",
		strings.NewReader(`{"command":"task_test_fail"}`))
	rec := httptest.NewRecorder()
	handleCommand(rec, req)

	var body struct {
		OK     bool   `json:"ok"`
		Output string `json:"output"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decoding: %v", err)
	}
	if body.OK {
		t.Error("ok = true for a failing command")
	}
	if !strings.Contains(body.Output, "bad") {
		t.Errorf("output = %q, want the stderr text", body.Output)
	}
}
