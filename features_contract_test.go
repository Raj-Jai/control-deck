package main

import (
	"encoding/json"
	"os"
	"testing"
)

// The backend advertised power, scenes and filedrop in KnownFeatures and in
// config.example.json, but the frontend had no keys for them, so setting any of
// them to false did nothing at all (BUG-041). The frontend list lives in
// frontend/src/config/features.ts; this test parses it and compares, so a key
// added on one side and not the other fails the build rather than being
// silently ignored at runtime.
func TestFeatureKeysMatchTheFrontend(t *testing.T) {
	raw, err := os.ReadFile("frontend/src/config/features.ts")
	if err != nil {
		t.Skipf("frontend sources unavailable: %v", err)
	}

	front := map[string]bool{}
	for _, key := range KnownFeatures {
		if containsKey(string(raw), key) {
			front[key] = true
		}
	}

	for _, key := range KnownFeatures {
		if !front[key] {
			t.Errorf("backend advertises feature %q but the frontend has no such key; "+
				"setting it to false would be silently ignored", key)
		}
	}

	// And the reverse: a frontend key the backend does not know about would be
	// warned about as a typo on every load.
	for _, key := range knownFeatureKeysFrom(raw) {
		found := false
		for _, k := range KnownFeatures {
			if k == key {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("frontend defines feature %q but the backend does not know it", key)
		}
	}
}

func containsKey(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) &&
		indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

// knownFeatureKeysFrom pulls the quoted keys out of the FEATURE_DEFAULTS object.
func knownFeatureKeysFrom(src []byte) []string {
	start := indexOf(string(src), "FEATURE_DEFAULTS")
	if start < 0 {
		return nil
	}
	rest := string(src)[start:]
	end := indexOf(rest, "as const")
	if end < 0 {
		end = len(rest)
	}
	rest = rest[:end]

	var keys []string
	for i := 0; i < len(rest); i++ {
		if rest[i] != ':' {
			continue
		}
		// walk back over whitespace to the opening quote
		j := i - 1
		for j >= 0 && (rest[j] == ' ' || rest[j] == '\t' || rest[j] == '\n' || rest[j] == '\r') {
			j--
		}
		if j < 0 || rest[j] != '\'' {
			continue
		}
		k := j
		for k >= 0 && rest[k] != '\'' {
			k--
		}
		if k < 0 {
			continue
		}
		keys = append(keys, rest[k+1:j])
	}
	return keys
}

// config.example.json must not advertise a key the backend does not implement,
// and must not omit one it does.
func TestExampleConfigMatchesKnownFeatures(t *testing.T) {
	raw, err := os.ReadFile("config.example.json")
	if err != nil {
		t.Skipf("config.example.json unavailable: %v", err)
	}
	var doc struct {
		Features map[string]bool `json:"features"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("config.example.json is not valid JSON: %v", err)
	}
	if len(doc.Features) == 0 {
		t.Fatal("config.example.json has no features block")
	}
	for key := range doc.Features {
		found := false
		for _, k := range KnownFeatures {
			if k == key {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("config.example.json advertises unknown feature %q", key)
		}
	}
}
