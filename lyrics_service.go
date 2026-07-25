package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

type LyricData struct {
	TrackID      string `json:"track_id"`
	Instrumental bool   `json:"instrumental"`
	PlainLyrics  string `json:"plain_lyrics"`
	SyncedLyrics string `json:"synced_lyrics"`
}

type lrclibResult struct {
	SyncedLyrics string `json:"syncedLyrics"`
	PlainLyrics  string `json:"plainLyrics"`
	Instrumental bool   `json:"instrumental"`
	TrackName    string `json:"trackName"`
	ArtistName   string `json:"artistName"`
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

	// Try exact /api/get with best available metadata
	params := url.Values{}
	params.Set("track_name", searchTitle)
	params.Set("artist_name", searchArtist)
	if duration > 0 {
		params.Set("duration", fmt.Sprintf("%.0f", duration))
	}

	if resp := doLRCLIBGet(params); resp != nil {
		if data := responseToLyricData(resp, searchArtist, searchTitle); data != nil {
			log.Printf("lyrics: found for %s - %s (synced=%v)", artist, track, data.SyncedLyrics != "")
			lyricsCacheMu.Lock()
			lyricsCache[key] = data
			lyricsCacheMu.Unlock()
			return data
		}
	}

	// Search with cleaned artist + title
	if results := doLRCLIBSearch(searchArtist + " " + searchTitle); len(results) > 0 {
		if best := fuzzyPickBest(results, searchArtist, searchTitle); best != nil {
			if data := responseToLyricData(best, searchArtist, best.TrackName); data != nil {
				log.Printf("lyrics: found for %s - %s (synced=%v)", artist, track, data.SyncedLyrics != "")
				lyricsCacheMu.Lock()
				lyricsCache[key] = data
				lyricsCacheMu.Unlock()
				return data
			}
		}
	}

	// Search by track name only
	if results := doLRCLIBSearch(searchTitle); len(results) > 0 {
		if best := fuzzyPickBest(results, searchArtist, searchTitle); best != nil {
			if data := responseToLyricData(best, searchArtist, best.TrackName); data != nil {
				log.Printf("lyrics: found for %s - %s (synced=%v)", artist, track, data.SyncedLyrics != "")
				lyricsCacheMu.Lock()
				lyricsCache[key] = data
				lyricsCacheMu.Unlock()
				return data
			}
		}
	}

	// Broader search with original (uncleaned) artist + track
	if searchTitle != track || searchArtist != artist {
		if results := doLRCLIBSearch(artist + " " + cleanYouTubeTitle(track, artist).Title); len(results) > 0 {
			if best := fuzzyPickBest(results, artist, cleanYouTubeTitle(track, artist).Title); best != nil {
				if data := responseToLyricData(best, artist, best.TrackName); data != nil {
					log.Printf("lyrics: found for %s - %s (synced=%v)", artist, track, data.SyncedLyrics != "")
					lyricsCacheMu.Lock()
					lyricsCache[key] = data
					lyricsCacheMu.Unlock()
					return data
				}
			}
		}
	}

	log.Printf("lyrics: no results for %s - %s (cleaned: %s - %s)", artist, track, searchArtist, searchTitle)
	lyricsCacheMu.Lock()
	lyricsCache[key] = nil
	lyricsCacheMu.Unlock()
	return nil
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

func fuzzyPickBest(results []lrclibResult, artist, title string) *lrclibResult {
	if len(results) == 0 {
		return nil
	}

	aLower := strings.ToLower(artist)
	tLower := strings.ToLower(title)

	score := func(r lrclibResult) float64 {
		titleSim := jaroWinkler(strings.ToLower(r.TrackName), tLower)
		artistSim := jaroWinkler(strings.ToLower(r.ArtistName), aLower)
		return titleSim*0.6 + artistSim*0.4
	}

	bestSynced := -1
	bestSyncedScore := 0.0
	bestAny := 0
	bestAnyScore := 0.0

	for i, r := range results {
		s := score(r)
		if s > bestAnyScore {
			bestAnyScore = s
			bestAny = i
		}
		if r.SyncedLyrics != "" && s > bestSyncedScore {
			bestSyncedScore = s
			bestSynced = i
		}
	}

	if bestSynced >= 0 && bestSyncedScore >= 0.5 {
		return &results[bestSynced]
	}
	if bestAnyScore >= 0.6 {
		return &results[bestAny]
	}

	log.Printf("lyrics: no good match (best=%.3f) for %s - %s (closest: %s - %s)",
		bestAnyScore, artist, title, results[bestAny].ArtistName, results[bestAny].TrackName)
	return nil
}

func responseToLyricData(r *lrclibResult, artist, track string) *LyricData {
	trackID := strings.ToLower(strings.TrimSpace(artist)) + "-" + strings.ToLower(strings.TrimSpace(track))
	return &LyricData{
		TrackID:      trackID,
		Instrumental: r.Instrumental,
		PlainLyrics:  r.PlainLyrics,
		SyncedLyrics: r.SyncedLyrics,
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
