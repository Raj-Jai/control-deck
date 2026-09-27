package main

import (
	"testing"
	"time"
)

// A lyrics lookup is several HTTP requests to a third-party API. It used to run
// inline on the state broadcaster, so the whole broadcast stalled for its
// duration - the audit measured up to 18 seconds on every track change.
func TestRequestLyricsNeverBlocks(t *testing.T) {
	lyricsCacheMu.Lock()
	lyricsCache = map[string]*LyricData{}
	lyricsCacheMu.Unlock()
	lyricsInFlightMu.Lock()
	lyricsInFlight = map[string]bool{}
	lyricsInFlightMu.Unlock()

	start := time.Now()
	// An artist/title that will not resolve, so the real lookup path runs.
	got := requestLyrics("nonexistent artist xyzzy", "nonexistent track xyzzy", 200)
	elapsed := time.Since(start)

	if elapsed > 50*time.Millisecond {
		t.Errorf("requestLyrics blocked for %v; it must return immediately", elapsed)
	}
	if got != nil {
		t.Errorf("first call returned %v, want nil before the lookup completes", got)
	}
}

// A cached miss must not be retried on every tick: the miss is the value.
func TestRequestLyricsRemembersAMiss(t *testing.T) {
	lyricsCacheMu.Lock()
	lyricsCache = map[string]*LyricData{}
	lyricsCacheMu.Unlock()
	lyricsInFlightMu.Lock()
	lyricsInFlight = map[string]bool{}
	lyricsInFlightMu.Unlock()

	artist, track := "cached miss artist", "cached miss track"
	key := lyricsCacheKey(artist, track)

	requestLyrics(artist, track, 0)
	storeLyrics(key, nil)

	// Now mark the track as in-flight; if the miss were not remembered, a second
	// call would see it in flight and behave differently.
	lyricsInFlightMu.Lock()
	lyricsInFlight[key] = true
	lyricsInFlightMu.Unlock()

	start := time.Now()
	if got := requestLyrics(artist, track, 0); got != nil {
		t.Errorf("cached miss returned %v, want nil", got)
	}
	if elapsed := time.Since(start); elapsed > 20*time.Millisecond {
		t.Errorf("a cached miss took %v, want an immediate return", elapsed)
	}

	lyricsInFlightMu.Lock()
	delete(lyricsInFlight, key)
	lyricsInFlightMu.Unlock()
}

func TestStoreLyricsBoundsTheCache(t *testing.T) {
	lyricsCacheMu.Lock()
	lyricsCache = map[string]*LyricData{}
	lyricsCacheMu.Unlock()

	for i := 0; i < maxLyricsCacheEntries*2; i++ {
		storeLyrics(string(rune('a'+i%26))+itoaTest(i), &LyricData{TrackID: "t"})
	}
	lyricsCacheMu.RLock()
	n := len(lyricsCache)
	lyricsCacheMu.RUnlock()

	if n > maxLyricsCacheEntries {
		t.Errorf("cache holds %d entries, want at most %d", n, maxLyricsCacheEntries)
	}
}

func itoaTest(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
