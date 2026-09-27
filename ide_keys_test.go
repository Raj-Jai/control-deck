package main

import (
	"strings"
	"testing"
)

// The debugger deck's bindings are the one place where a wrong key is
// indistinguishable from a right one until the user notices their music
// stopped, so the map is pinned here.
func TestDebuggerCommandsUseDistinctRealKeys(t *testing.T) {
	// buildCommandMap reads the active config, which is nil until something
	// stores one.
	prev := appCfg.Load()
	if prev == nil {
		appCfg.Store(&Config{Features: map[string]bool{}})
		t.Cleanup(func() { appCfg.Store(prev) })
	}
	buildCommandMap()
	buildProfileCommandMap()

	// command -> the key argument it sends.
	got := map[string]string{}
	for _, name := range []string{
		"dbg_continue", "dbg_step_over", "dbg_step_into", "dbg_step_out",
		"dbg_stop", "dbg_restart", "dbg_toggle_break", "dbg_clear_all",
	} {
		args, ok := commandMap[name]
		if !ok {
			t.Fatalf("%s is not registered", name)
		}
		if len(args) < 2 {
			t.Fatalf("%s has no key argument: %v", name, args)
		}
		got[name] = args[len(args)-1]
	}

	want := map[string]string{
		"dbg_continue":     "F5",
		"dbg_step_over":    "F10",
		"dbg_step_into":    "F11",
		"dbg_step_out":     "shift+F11",
		"dbg_stop":         "shift+F5",
		"dbg_restart":      "ctrl+shift+F5",
		"dbg_toggle_break": "F9",
		"dbg_clear_all":    "ctrl+shift+F9",
	}
	for name, key := range want {
		if got[name] != key {
			t.Errorf("%s sends %q, want %q", name, got[name], key)
		}
	}

	// The three that were all F5 must now be distinguishable from Continue.
	seen := map[string]string{}
	for name, key := range got {
		if prev, dup := seen[key]; dup {
			t.Errorf("%s and %s both send %q", prev, name, key)
		}
		seen[key] = name
	}

	// "Toggle Breakpoint" used to shell out to playerctl and pause the user's
	// music. Only the debugger commands are checked: the transport commands
	// legitimately drive playerctl.
	for name := range want {
		for _, a := range commandMap[name] {
			if strings.Contains(a, "playerctl") {
				t.Errorf("%s drives playerctl: %v", name, commandMap[name])
			}
		}
	}
}
