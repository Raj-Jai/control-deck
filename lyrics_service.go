package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// LyricVersion is a single language/format variant of a track's lyrics.
type LyricVersion struct {
	Lang         string `json:"lang"`
	PlainLyrics  string `json:"plain_lyrics"`
	SyncedLyrics string `json:"synced_lyrics"`
	Instrumental bool   `json:"instrumental"`
}

type LyricData struct {
	TrackID      string         `json:"track_id"`
	Instrumental bool           `json:"instrumental"`
	PlainLyrics  string         `json:"plain_lyrics"`
	SyncedLyrics string         `json:"synced_lyrics"`
	Versions     []LyricVersion `json:"versions,omitempty"`
}

type lrclibResult struct {
	SyncedLyrics string  `json:"syncedLyrics"`
	PlainLyrics  string  `json:"plainLyrics"`
	Instrumental bool    `json:"instrumental"`
	TrackName    string  `json:"trackName"`
	ArtistName   string  `json:"artistName"`
	Duration     float64 `json:"duration"`
	Lang         string  `json:"lang"`
}

var (
	lyricsCache   = make(map[string]*LyricData)
	lyricsCacheMu sync.RWMutex
	lyricsClient  = &http.Client{Timeout: 6 * time.Second}

	youtubeNoise = regexp.MustCompile(`(?i)[\(\[\{].*?(official|video|audio|lyric|live|remastered|version|concert|full\s*song|hd|4k|8k|visualizer|music\s*video|lyrical|song).*?[\)\]\}]`)
	pipeNoise    = regexp.MustCompile(`(?i)\s*\|.*`)
	multiSpace   = regexp.MustCompile(`\s+`)
)

type cleanedMetadata struct {
	Artist string
	Title  string
}

func cleanYouTubeTitle(rawTitle, mprisArtist string) cleanedMetadata {
	s := rawTitle

	s = youtubeNoise.ReplaceAllString(s, "")
	s = pipeNoise.ReplaceAllString(s, "")
	s = multiSpace.ReplaceAllString(strings.TrimSpace(s), " ")

	s = strings.Split(s, "Full Song")[0]
	s = strings.Split(s, "Full Video")[0]
	s = strings.Split(s, "Full Audio")[0]
	s = strings.Split(s, "Official Video")[0]
	s = strings.Split(s, "Official Music")[0]
	s = strings.Split(s, " (Official)")[0]
	s = strings.Split(s, " (Lyrics)")[0]
	s = strings.Split(s, " (Audio)")[0]
	s = strings.TrimSpace(s)

	if idx := strings.Index(s, " - "); idx > 0 {
		left := strings.TrimSpace(s[:idx])
		right := strings.TrimSpace(s[idx+3:])

		leftSim := jaroWinkler(strings.ToLower(left), strings.ToLower(mprisArtist))
		rightSim := jaroWinkler(strings.ToLower(right), strings.ToLower(mprisArtist))

		if leftSim > 0.7 && leftSim >= rightSim {
			return cleanedMetadata{Artist: left, Title: right}
		}
		if rightSim > 0.7 && rightSim >= leftSim {
			return cleanedMetadata{Artist: right, Title: left}
		}

		return cleanedMetadata{Title: s}
	}

	return cleanedMetadata{Title: s}
}

func jaroWinkler(s1, s2 string) float64 {
	if s1 == s2 {
		return 1.0
	}
	if len(s1) == 0 || len(s2) == 0 {
		return 0.0
	}

	matchDist := max(len(s1), len(s2))/2 - 1
	if matchDist < 0 {
		matchDist = 0
	}

	m1 := make([]bool, len(s1))
	m2 := make([]bool, len(s2))
	matches := 0

	for i := 0; i < len(s1); i++ {
		low := i - matchDist
		if low < 0 {
			low = 0
		}
		high := i + matchDist + 1
		if high > len(s2) {
			high = len(s2)
		}
		for j := low; j < high; j++ {
			if !m2[j] && s1[i] == s2[j] {
				m1[i] = true
				m2[j] = true
				matches++
				break
			}
		}
	}

	if matches == 0 {
		return 0.0
	}

	transpositions := 0
	j := 0
	for i := 0; i < len(s1); i++ {
		if m1[i] {
			for !m2[j] {
				j++
			}
			if s1[i] != s2[j] {
				transpositions++
			}
			j++
		}
	}

	jaro := (float64(matches)/float64(len(s1)) +
		float64(matches)/float64(len(s2)) +
		float64(matches-transpositions/2)/float64(matches)) / 3.0

	prefix := 0
	limit := min(4, min(len(s1), len(s2)))
	for i := 0; i < limit && s1[i] == s2[i]; i++ {
		prefix++
	}

	return jaro + 0.1*float64(prefix)*(1.0-jaro)
}

func lyricsCacheKey(artist, track string) string {
	a := strings.ToLower(strings.TrimSpace(artist))
	t := strings.ToLower(strings.TrimSpace(track))
	return a + "||" + t
}

func fetchCachedLyrics(key string) *LyricData {
	lyricsCacheMu.RLock()
	defer lyricsCacheMu.RUnlock()
	return lyricsCache[key]
}

func fetchLyrics(artist, track string, duration float64) *LyricData {
	artist = strings.TrimSpace(artist)
	track = strings.TrimSpace(track)
	if artist == "" || track == "" {
		return nil
	}

	key := lyricsCacheKey(artist, track)
	lyricsCacheMu.RLock()
	if cached, ok := lyricsCache[key]; ok {
		lyricsCacheMu.RUnlock()
		return cached
	}
	lyricsCacheMu.RUnlock()

	cleanMeta := cleanYouTubeTitle(track, artist)
	searchArtist := artist
	searchTitle := cleanMeta.Title
	if cleanMeta.Artist != "" {
		searchArtist = cleanMeta.Artist
	}

	// Try exact /api/get with best available metadata. This typically returns a
	// single result but may include multiple language versions.
	params := url.Values{}
	params.Set("track_name", searchTitle)
	params.Set("artist_name", searchArtist)
	if duration > 0 {
		params.Set("duration", fmt.Sprintf("%.0f", duration))
	}

	if resp := doLRCLIBGet(params); resp != nil {
		if data := responseToLyricData(resp, searchArtist, searchTitle); data != nil {
			log.Printf("lyrics: found for %s - %s (synced=%v)", artist, track, data.SyncedLyrics != "")
			storeLyrics(key, data)
			return data
		}
	}

	// Collect candidates from all search strategies, merged and deduped by language.
	var results []lrclibResult

	// Search with cleaned artist + title
	if r := doLRCLIBSearch(searchArtist + " " + searchTitle); len(r) > 0 {
		results = append(results, r...)
	}

	// Search by track name only
	if len(results) == 0 {
		if r := doLRCLIBSearch(searchTitle); len(r) > 0 {
			results = append(results, r...)
		}
	}

	// Broader search with original (uncleaned) artist + track
	if searchTitle != track || searchArtist != artist {
		if r := doLRCLIBSearch(artist + " " + cleanYouTubeTitle(track, artist).Title); len(r) > 0 {
			results = append(results, r...)
		}
	}

	if len(results) > 0 {
		if data := buildVersions(results, searchArtist, searchTitle, duration); data != nil {
			log.Printf("lyrics: found %d version(s) for %s - %s (synced=%v)",
				len(data.Versions), artist, track, data.SyncedLyrics != "")
			data.TrackID = lyricsCacheKey(artist, track)
			storeLyrics(key, data)
			return data
		}
	}

	log.Printf("lyrics: no results for %s - %s (cleaned: %s - %s)", artist, track, searchArtist, searchTitle)
	// Cache the miss so a track with no lyrics is not re-queried every tick.
	storeLyrics(key, nil)
	return nil
}

// buildVersions scores all candidate results, keeps the best version per
// language (and dedupes identical content), and returns a LyricData whose
// active fields point at the overall best version while Versions lists every
// distinct language so the frontend can offer a language switcher.
func buildVersions(results []lrclibResult, artist, title string, duration float64) *LyricData {
	type scored struct {
		r   lrclibResult
		scr float64
	}

	aLower := strings.ToLower(artist)
	tLower := strings.ToLower(title)

	score := func(r lrclibResult) float64 {
		titleSim := jaroWinkler(strings.ToLower(r.TrackName), tLower)
		artistSim := jaroWinkler(strings.ToLower(r.ArtistName), aLower)
		s := titleSim*0.6 + artistSim*0.4
		if duration > 0 && r.Duration > 0 {
			diff := duration - r.Duration
			if diff < 0 {
				diff = -diff
			}
			durSim := 1.0 - diff/30.0
			if durSim < 0 {
				durSim = 0
			}
			s += durSim * 0.1
		}
		return s
	}

	// Rank all results.
	ranked := make([]scored, 0, len(results))
	for _, r := range results {
		ranked = append(ranked, scored{r: r, scr: score(r)})
	}
	// Stable-ish sort by descending score.
	// (Simple insertion sort since result counts are small.)
	for i := 1; i < len(ranked); i++ {
		for j := i; j > 0 && ranked[j].scr > ranked[j-1].scr; j-- {
			ranked[j], ranked[j-1] = ranked[j-1], ranked[j]
		}
	}

	// Filter weak matches.
	var strong []scored
	for _, s := range ranked {
		if s.r.SyncedLyrics == "" && s.r.PlainLyrics == "" {
			continue
		}
		if s.scr >= 0.5 {
			strong = append(strong, s)
		}
	}
	if len(strong) == 0 {
		return nil
	}

	// Group by language: normalise empty/lang names; pick the best per group.
	type key struct {
		lang   string
		lyrics string // content fingerprint to catch same-content duplicates
	}
	langBest := make(map[key]scored)

	for _, s := range strong {
		lang := s.r.Lang
		if lang == "" || lang == "null" || strings.EqualFold(lang, "und") || strings.EqualFold(lang, "unknown") {
			lang = ""
		}
		fp := s.r.SyncedLyrics
		if fp == "" {
			fp = s.r.PlainLyrics
		}
		k := key{lang: lang, lyrics: fp}
		if cur, ok := langBest[k]; !ok || s.scr > cur.scr {
			langBest[k] = s
		}
	}

	versions := make([]LyricVersion, 0, len(langBest))
	best := LyricVersion{}
	bestSet := false
	var bestScr float64

	for _, s := range langBest {
		lang := s.r.Lang
		if lang == "" || lang == "null" || strings.EqualFold(lang, "und") || strings.EqualFold(lang, "unknown") {
			lang = ""
		}
		v := LyricVersion{
			Lang:         lang,
			PlainLyrics:  s.r.PlainLyrics,
			SyncedLyrics: s.r.SyncedLyrics,
			Instrumental: s.r.Instrumental,
		}
		versions = append(versions, v)
		if !bestSet || s.scr > bestScr {
			best = v
			bestSet = true
			bestScr = s.scr
		}
	}

	// Sort versions: labelled languages first, then the unlabelled one last,
	// and otherwise leave the score order alone.
	//
	// This used to `return true` when both were labelled, which claims i < j
	// and j < i at the same time. That is not a strict weak ordering, so the
	// result of the sort was unspecified - and for a larger list it is the
	// shape that sends the sort quadratic. Stability already preserves the
	// order of equivalent elements, so the honest answer for two labelled
	// languages is "not less than".
	sort.SliceStable(versions, func(i, j int) bool {
		iUnlabelled := versions[i].Lang == ""
		jUnlabelled := versions[j].Lang == ""
		if iUnlabelled == jUnlabelled {
			return false
		}
		return !iUnlabelled
	})

	return &LyricData{
		Instrumental: best.Instrumental,
		PlainLyrics:  best.PlainLyrics,
		SyncedLyrics: best.SyncedLyrics,
		Versions:     versions,
	}
}

func doLRCLIBGet(params url.Values) *lrclibResult {
	req, err := http.NewRequest("GET", "https://lrclib.net/api/get?"+params.Encode(), nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "ControlDeck/1.0 (https://github.com/Raj-Jai/control-deck)")
	req.Header.Set("Accept", "application/json")

	resp, err := lyricsClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var r lrclibResult
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil
	}
	return &r
}

func doLRCLIBSearch(query string) []lrclibResult {
	urlStr := "https://lrclib.net/api/search?q=" + url.QueryEscape(query)
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "ControlDeck/1.0 (https://github.com/Raj-Jai/control-deck)")
	req.Header.Set("Accept", "application/json")

	resp, err := lyricsClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var results []lrclibResult
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil
	}
	return results
}

func responseToLyricData(r *lrclibResult, artist, track string) *LyricData {
	trackID := strings.ToLower(strings.TrimSpace(artist)) + "-" + strings.ToLower(strings.TrimSpace(track))
	return &LyricData{
		TrackID:      trackID,
		Instrumental: r.Instrumental,
		PlainLyrics:  r.PlainLyrics,
		SyncedLyrics: r.SyncedLyrics,
		Versions: []LyricVersion{{
			Lang:         r.Lang,
			PlainLyrics:  r.PlainLyrics,
			SyncedLyrics: r.SyncedLyrics,
			Instrumental: r.Instrumental,
		}},
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ─── Async lyrics ──────────────────────────────────────────────
//
// A lyrics lookup is four HTTP requests to a third-party API with retries, and
// it used to run inline on the state broadcaster's goroutine. The audit
// measured the whole broadcast stalling for up to 18 seconds on every track
// change: no client received a position, a volume or a play/pause event for
// the duration, because the ticker itself was blocked inside the fetch.
//
// The lookup now happens on its own goroutine, at most one in flight per
// track, and the broadcaster only ever reads the cache. The first state for a
// new track ships without lyrics and the next tick carries them, which is
// imperceptible and no longer blocks anything.

var (
	lyricsInFlight   = map[string]bool{}
	lyricsInFlightMu sync.Mutex
)

// requestLyrics returns whatever is cached, and schedules a lookup if this
// track has not been seen. It never blocks.
func requestLyrics(artist, title string, length float64) *LyricData {
	artist = strings.TrimSpace(artist)
	title = strings.TrimSpace(title)
	key := lyricsCacheKey(artist, title)

	lyricsCacheMu.RLock()
	cached, seen := lyricsCache[key]
	lyricsCacheMu.RUnlock()
	if seen {
		return cached // includes a cached nil, i.e. "we looked, there are none"
	}
	if artist == "" || title == "" {
		return nil
	}

	lyricsInFlightMu.Lock()
	if lyricsInFlight[key] {
		lyricsInFlightMu.Unlock()
		return nil
	}
	lyricsInFlight[key] = true
	lyricsInFlightMu.Unlock()

	go func() {
		defer func() {
			// A panic in a lookup must not take the process with it.
			if r := recover(); r != nil {
				log.Printf("lyrics: lookup for %q panicked: %v", key, r)
				// Cache the failure so it is not retried every tick.
				lyricsCacheMu.Lock()
				lyricsCache[key] = nil
				lyricsCacheMu.Unlock()
			}
			lyricsInFlightMu.Lock()
			delete(lyricsInFlight, key)
			lyricsInFlightMu.Unlock()
		}()
		fetchLyrics(artist, title, length)
	}()

	return nil
}

// capLyricsCache keeps the map from growing without bound. A long session
// listening to a playlist inserts one entry per track, including the misses,
// and the map was never pruned.
const maxLyricsCacheEntries = 200

func storeLyrics(key string, data *LyricData) {
	lyricsCacheMu.Lock()
	defer lyricsCacheMu.Unlock()
	if len(lyricsCache) >= maxLyricsCacheEntries {
		// Map iteration order is random, so evicting an arbitrary entry is
		// both cheap and good enough for a cache of this size.
		for k := range lyricsCache {
			delete(lyricsCache, k)
			if len(lyricsCache) < maxLyricsCacheEntries/2 {
				break
			}
		}
	}
	lyricsCache[key] = data
}
