package main

import (
	"fmt"
	"strings"
	"sync"
	"testing"
)

func TestArtCacheHitsOnSecondLookup(t *testing.T) {
	c := newArtCache(1<<20, 4<<20)
	if _, ok := c.get("/a.png"); ok {
		t.Fatal("empty cache reported a hit")
	}
	c.put("/a.png", "data:image/png;base64,AAA")
	got, ok := c.get("/a.png")
	if !ok || got != "data:image/png;base64,AAA" {
		t.Fatalf("get = %q, %v", got, ok)
	}
	if c.len() != 1 {
		t.Errorf("len = %d, want 1", c.len())
	}
}

// Two tracks alternating every 500 ms used to re-read and re-encode the file
// every single time, because only one image was ever held.
func TestArtCacheHoldsAlternatingTracks(t *testing.T) {
	c := newArtCache(1<<20, 4<<20)
	c.put("/one.png", "one")
	c.put("/two.png", "two")
	for i := 0; i < 10; i++ {
		if got, _ := c.get("/one.png"); got != "one" {
			t.Fatalf("iteration %d: /one.png = %q", i, got)
		}
		if got, _ := c.get("/two.png"); got != "two" {
			t.Fatalf("iteration %d: /two.png = %q", i, got)
		}
	}
	if c.len() != 2 {
		t.Errorf("len = %d, want 2", c.len())
	}
}

func TestArtCacheEvictsLeastRecentlyUsed(t *testing.T) {
	c := newArtCache(1<<20, 10)
	c.put("/a", strings.Repeat("a", 4)) // 4 bytes
	c.put("/b", strings.Repeat("b", 4))
	c.put("/c", strings.Repeat("c", 4)) // now 12 > 10, /a is oldest
	if _, ok := c.get("/a"); ok {
		t.Error("/a should have been evicted as least recently used")
	}
	if _, ok := c.get("/b"); !ok {
		t.Error("/b should still be cached")
	}
	if _, ok := c.get("/c"); !ok {
		t.Error("/c should still be cached")
	}
	if c.len() != 2 {
		t.Errorf("len = %d, want 2", c.len())
	}
}

func TestArtCacheRefusesOversizedEntry(t *testing.T) {
	c := newArtCache(8, 1024)
	c.put("/big", strings.Repeat("x", 100))
	if _, ok := c.get("/big"); ok {
		t.Error("an entry over the per-entry limit was stored")
	}
	if c.len() != 0 {
		t.Errorf("len = %d, want 0", c.len())
	}
}

// A cover that shrank must not be served from the old, larger entry.
func TestArtCachePutReplacesWithoutDoubleCounting(t *testing.T) {
	c := newArtCache(1<<20, 1<<20)
	c.put("/a", strings.Repeat("a", 100))
	c.put("/a", "small")
	got, ok := c.get("/a")
	if !ok || got != "small" {
		t.Fatalf("get = %q, %v", got, ok)
	}
	if c.bytes != len("small") {
		t.Errorf("bytes = %d, want %d", c.bytes, len("small"))
	}
	if c.len() != 1 {
		t.Errorf("len = %d, want 1", c.len())
	}
}

func TestArtCacheInvalidate(t *testing.T) {
	c := newArtCache(1<<20, 1<<20)
	c.put("/a", "v1")
	c.invalidate("/a")
	if _, ok := c.get("/a"); ok {
		t.Error("an invalidated path was still served")
	}
	c.invalidate("/never-cached") // must not panic or corrupt the accounting
	if c.len() != 0 {
		t.Errorf("len = %d, want 0", c.len())
	}
}

// The state payload is built once per client, so this ran on several
// goroutines with no synchronisation at all.
func TestArtCacheConcurrentAccess(t *testing.T) {
	c := newArtCache(1<<20, 1<<20)
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				p := fmt.Sprintf("/art-%d.png", i%5)
				c.put(p, strings.Repeat("d", 16))
				c.get(p)
				if i%50 == 0 {
					c.invalidate(p)
				}
			}
		}(g)
	}
	wg.Wait()
	if c.bytes < 0 {
		t.Errorf("bytes = %d, went negative", c.bytes)
	}
	if c.len() > 5 {
		t.Errorf("len = %d, want at most 5", c.len())
	}
}
