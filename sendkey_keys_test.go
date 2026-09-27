package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Every key the command map asks sendkey to send must be one sendkey accepts.
// A typo there is a button that silently does nothing, which is exactly how
// Step Out, Stop and Restart all became Continue.
func TestEveryCommandKeyIsAcceptedBySendkey(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("no go toolchain to build sendkey")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "sendkey")
	build := exec.Command("go", "build", "-o", bin, "./cmd/sendkey")
	if out, err := build.CombinedOutput(); err != nil {
		t.Skipf("cannot build sendkey: %v\n%s", err, out)
	}
	if _, err := os.Stat(bin); err != nil {
		t.Skipf("sendkey not built: %v", err)
	}

	prev := appCfg.Load()
	if prev == nil {
		appCfg.Store(&Config{Features: map[string]bool{}})
		t.Cleanup(func() { appCfg.Store(prev) })
	}
	buildCommandMap()
	buildProfileCommandMap()

	checked := 0
	for name, args := range commandMap {
		key, direct := sendkeyKeyArg(args)
		if !direct {
			continue // a shell wrapper, not a bare key spec
		}
		out, _ := exec.Command(bin, key).CombinedOutput()
		if strings.Contains(string(out), "unknown key") {
			t.Errorf("%s asks sendkey for %q, which it rejects: %s",
				name, key, strings.TrimSpace(string(out)))
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no sendkey invocations found - the command map shape changed")
	}
	t.Logf("checked %d sendkey invocations", checked)
}

// sendkeyKeyArg returns the key argument of a command that invokes sendkey
// directly. Commands that wrap it in "sh -c" return false, because there the
// key is embedded in a shell string rather than being its own argv entry.
func sendkeyKeyArg(args []string) (string, bool) {
	idx := -1
	for i, a := range args {
		if strings.HasSuffix(a, "sendkey") {
			idx = i
			break
		}
	}
	if idx < 0 {
		return "", false
	}
	// Direct form: [sendkey, key]. Anything with "sh"/"-c" is a wrapper.
	if args[0] == "sh" || (len(args) > 1 && args[1] == "-c") {
		return "", false
	}
	if len(args) <= idx+1 {
		return "", false
	}
	return args[idx+1], true
}
