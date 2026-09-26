package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The geo handlers concatenated a query-string name straight onto geoDir, which
// gave arbitrary file read, delete and write to anyone who could reach the port.
func TestSafeSessionNameRejectsTraversal(t *testing.T) {
	bad := []string{
		"", ".", "..", "../config", "..%2fconfig", "../../etc/passwd",
		"sub/dir", "sub\\dir", "with\x00null", ".hidden",
		strings.Repeat("a", 256),
		"has space/and/slash", "star*", "tilde~", "semi;colon",
	}
	for _, name := range bad {
		if got, err := safeSessionName(name); err == nil {
			t.Errorf("safeSessionName(%q) = %q, want an error", name, got)
		}
	}

	good := []string{
		"2026-01-02_15-04-05", "session_1", "room-a", "with space", "A.b_c-1",
	}
	for _, name := range good {
		if got, err := safeSessionName(name); err != nil || got != name {
			t.Errorf("safeSessionName(%q) = %q, %v; want the name back", name, got, err)
		}
	}
}

func TestGeoSessionPathStaysInsideGeoDir(t *testing.T) {
	root := t.TempDir()
	geo := filepath.Join(root, geoDir)
	if err := os.MkdirAll(geo, 0o700); err != nil {
		t.Fatal(err)
	}
	// A file the traversal would try to reach.
	secret := filepath.Join(root, "secret.txt")
	if err := os.WriteFile(secret, []byte("top secret"), 0o600); err != nil {
		t.Fatal(err)
	}

	prev, _ := os.Getwd()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(prev)

	for _, name := range []string{"../secret.txt", "../../secret.txt", "..", "sub/x"} {
		if got, err := geoSessionPath(name, ""); err == nil {
			t.Errorf("geoSessionPath(%q) = %q, want an error", name, got)
		}
	}

	got, err := geoSessionPath("session_1", ".json")
	if err != nil {
		t.Fatalf("geoSessionPath on a valid name: %v", err)
	}
	want := filepath.Join(geo, "session_1.json")
	if got != want {
		t.Errorf("geoSessionPath = %q, want %q", got, want)
	}
}

// A symlink planted inside geoDir must not become a bridge out of it.
func TestGeoSessionPathRefusesSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	geo := filepath.Join(root, geoDir)
	if err := os.MkdirAll(geo, 0o700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(root, "outside")
	if err := os.MkdirAll(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	// geoDir/evil -> outside
	if err := os.Symlink(outside, filepath.Join(geo, "evil")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	prev, _ := os.Getwd()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(prev)

	if got, err := geoSessionPath("evil", ""); err == nil {
		t.Errorf("geoSessionPath through a symlink = %q, want an error", got)
	}
}
