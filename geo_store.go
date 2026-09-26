package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Geo session names arrive straight from the query string or the request body
// and were concatenated onto geoDir unchecked:
//
//	os.ReadFile(geoDir + "/" + name)   // read   -> arbitrary file read
//	os.Remove(geoDir + "/" + name)      // delete -> arbitrary file delete
//	os.WriteFile(geoDir+"/"+name+".json") // write -> arbitrary file write
//
// The same containment pattern the uncommitted files.go already uses
// (safeDropName) is applied here, plus a final check after symlink resolution
// so a symlink planted inside geoDir cannot be used as a bridge.

var errUnsafeGeoName = errors.New("invalid session name")

// safeSessionName rejects traversal, separators, and degenerate names.
func safeSessionName(name string) (string, error) {
	if name == "" || name == "." || name == ".." || len(name) > 255 {
		return "", errUnsafeGeoName
	}
	if strings.ContainsAny(name, "/\\\x00") {
		return "", errUnsafeGeoName
	}
	if strings.HasPrefix(name, ".") {
		return "", errUnsafeGeoName
	}
	if filepath.Base(name) != name {
		return "", errUnsafeGeoName
	}
	// Only the characters a timestamped session name needs.
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_', r == '.', r == ' ':
		default:
			return "", errUnsafeGeoName
		}
	}
	return name, nil
}

// geoSessionPath resolves a client-supplied session name to an absolute path
// inside geoDir, or an error if it would land anywhere else.
func geoSessionPath(name string, suffix string) (string, error) {
	clean, err := safeSessionName(name)
	if err != nil {
		return "", err
	}
	absDir, err := filepath.Abs(geoDir)
	if err != nil {
		return "", err
	}
	target := filepath.Join(absDir, clean+suffix)

	// Resolve the directory, not the file: the file may not exist yet, and it is
	// the directory that must not be a symlink pointing elsewhere.
	realDir, err := filepath.EvalSymlinks(absDir)
	if err != nil {
		if !os.IsNotExist(err) {
			return "", err
		}
		realDir = absDir
	}
	if err := os.MkdirAll(realDir, 0o700); err != nil {
		return "", err
	}
	realDir, err = filepath.EvalSymlinks(realDir)
	if err != nil {
		return "", err
	}
	if realDir != absDir {
		return "", fmt.Errorf("geo directory resolves outside itself")
	}
	if filepath.Dir(target) != absDir {
		return "", errUnsafeGeoName
	}

	// If the target already exists, resolve it: geoDir/evil may be a symlink to
	// somewhere else entirely, and os.ReadFile would happily follow it.
	if resolved, err := filepath.EvalSymlinks(target); err == nil {
		if resolved != absDir && !strings.HasPrefix(resolved, absDir+string(os.PathSeparator)) {
			return "", errUnsafeGeoName
		}
	}
	return target, nil
}
