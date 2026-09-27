package main

import (
	"container/list"
	"sync"
)

// The album-art cache used to hold exactly one file: the state payload was built
// per client, so alternating between two tracks re-read and re-base64 a file on
// every 500 ms tick, and a single entry had no size limit, so one high-resolution
// cover became a 13 MB string that was held for the life of the process and
// pushed down every SSE frame to every client (PERF-37).
//
// It was also unsynchronised: the broadcaster builds the payload once per
// client, so two clients meant two goroutines reading and writing the same two
// globals.

// artCacheMaxEntry bounds any single cached image. Covers are re-encoded from
// disk on the next tick if they exceed this, which is cheaper than holding one.
const artCacheMaxEntry = 4 << 20 // 4 MiB

// artCacheMaxBytes bounds the whole cache.
const artCacheMaxBytes = 16 << 20 // 16 MiB

type artEntry struct {
	path  string
	data  string
	bytes int
}

type artCache struct {
	mu      sync.Mutex
	order   *list.List               // front = most recently used
	items   map[string]*list.Element // path -> element
	bytes   int
	maxEach int
	maxAll  int
}

func newArtCache(maxEach, maxAll int) *artCache {
	return &artCache{
		order:   list.New(),
		items:   make(map[string]*list.Element),
		maxEach: maxEach,
		maxAll:  maxAll,
	}
}

// get returns the cached data URI for path, or ok=false.
func (c *artCache) get(path string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, found := c.items[path]
	if !found {
		return "", false
	}
	c.order.MoveToFront(el)
	return el.Value.(*artEntry).data, true
}

// put stores data for path, evicting least-recently-used entries to stay under
// the total budget.
func (c *artCache) put(path, data string) {
	size := len(data)
	if size > c.maxEach {
		// Too big to be worth holding. Drop any stale entry for this path so we
		// do not keep serving a smaller previous version.
		c.remove(path)
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, found := c.items[path]; found {
		c.bytes -= el.Value.(*artEntry).bytes
		el.Value.(*artEntry).data = data
		el.Value.(*artEntry).bytes = size
		c.order.MoveToFront(el)
		c.bytes += size
	} else {
		el := c.order.PushFront(&artEntry{path: path, data: data, bytes: size})
		c.items[path] = el
		c.bytes += size
	}
	for c.bytes > c.maxAll {
		back := c.order.Back()
		if back == nil {
			break
		}
		c.evict(back)
	}
}

// invalidate drops the entry for a path, so a cover that changed on disk is
// re-read instead of served stale forever.
func (c *artCache) invalidate(path string) {
	c.remove(path)
}

func (c *artCache) remove(path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, found := c.items[path]; found {
		c.evict(el)
	}
}

// evict removes an element. The caller must hold the lock, or be the only
// writer for a path that is not yet in the map.
func (c *artCache) evict(el *list.Element) {
	entry := el.Value.(*artEntry)
	c.order.Remove(el)
	delete(c.items, entry.path)
	c.bytes -= entry.bytes
	if c.bytes < 0 {
		c.bytes = 0
	}
}

func (c *artCache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

var albumArt = newArtCache(artCacheMaxEntry, artCacheMaxBytes)
