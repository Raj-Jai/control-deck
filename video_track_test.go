package main

import "testing"

// "Toggle" sent track_id 0, which is *off* in both mpv and VLC, and "Cycle"
// sent track_id 1, which is *select the first track*. Neither cycled anything
// (BUG-031). nextTrackID is what makes the button do what it says.
func TestNextTrackIDCycles(t *testing.T) {
	tracks := []VideoTrack{
		{ID: 1, Title: "English"},
		{ID: 2, Title: "Espanol"},
		{ID: 3, Title: "Francais"},
	}

	// Forward from the first, and wrapping at the end.
	if got := nextTrackID(tracks, 1, 1); got != 2 {
		t.Errorf("next from 1 = %d, want 2", got)
	}
	if got := nextTrackID(tracks, 3, 1); got != 1 {
		t.Errorf("next from the last = %d, want a wrap to 1", got)
	}
	// Backward, and wrapping at the start.
	if got := nextTrackID(tracks, 2, -1); got != 1 {
		t.Errorf("prev from 2 = %d, want 1", got)
	}
	if got := nextTrackID(tracks, 1, -1); got != 3 {
		t.Errorf("prev from the first = %d, want a wrap to 3", got)
	}
	// Nothing active: start at an end, not at 0.
	if got := nextTrackID(tracks, 0, 1); got != 1 {
		t.Errorf("next with nothing active = %d, want 1", got)
	}
	if got := nextTrackID(tracks, 0, -1); got != 3 {
		t.Errorf("prev with nothing active = %d, want the last track", got)
	}
	// An id we do not know behaves like nothing active.
	if got := nextTrackID(tracks, 99, 1); got != 1 {
		t.Errorf("next from an unknown id = %d, want 1", got)
	}
}

// Track 0 means "off" in both players and must never appear in a cycle.
func TestNextTrackIDSkipsTheOffTrack(t *testing.T) {
	tracks := []VideoTrack{
		{ID: 0, Title: "Disable"},
		{ID: 1, Title: "English"},
		{ID: 2, Title: "Espanol"},
	}
	if got := nextTrackID(tracks, 2, 1); got != 1 {
		t.Errorf("next wrapping = %d, want 1 (never 0)", got)
	}
	only := []VideoTrack{{ID: 0, Title: "Disable"}}
	if got := nextTrackID(only, 0, 1); got != 0 {
		t.Errorf("with only the off track, got %d", got)
	}
	if got := nextTrackID(nil, 0, 1); got != 0 {
		t.Errorf("with no tracks, got %d", got)
	}
}
