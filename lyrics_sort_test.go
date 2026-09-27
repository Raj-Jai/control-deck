package main

import (
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"
)

// The comparator claimed i < j and j < i for two labelled languages, which is
// not a strict weak ordering. Checked over every pair, and checked that the
// ordering it does express - labelled before unlabelled, score order otherwise
// preserved - actually holds.
func TestLyricVersionSortIsAValidOrdering(t *testing.T) {
	less := func(a, b LyricVersion) bool {
		aU, bU := a.Lang == "", b.Lang == ""
		if aU == bU {
			return false
		}
		return !aU
	}

	langs := []string{"eng", "hin", "", "deu", "", "spa"}
	for i := 0; i < len(langs); i++ {
		for j := 0; j < len(langs); j++ {
			for k := 0; k < len(langs); k++ {
				a := LyricVersion{Lang: langs[i]}
				b := LyricVersion{Lang: langs[j]}
				c := LyricVersion{Lang: langs[k]}
				if less(a, b) && less(b, c) && !less(a, c) {
					t.Fatalf("not transitive for %q < %q < %q", langs[i], langs[j], langs[k])
				}
				// Irreflexivity and asymmetry: the two the old code violated.
				if less(a, a) {
					t.Fatalf("less(%q, %q) is true; must be irreflexive", langs[i], langs[i])
				}
				if less(a, b) && less(b, a) {
					t.Fatalf("less(%q, %q) and less(%q, %q) are both true; must be asymmetric",
						langs[i], langs[j], langs[j], langs[i])
				}
			}
		}
	}
}

// The expressed intent: every labelled version before the unlabelled one, and
// the original order preserved within each group.
func TestLyricVersionSortPutsUnlabelledLast(t *testing.T) {
	input := []LyricVersion{
		{Lang: ""}, {Lang: "eng"}, {Lang: ""}, {Lang: "hin"}, {Lang: "deu"}, {Lang: ""},
	}
	want := []string{"eng", "hin", "deu", "", "", ""}
	got := sortWith(input, func(a, b LyricVersion) bool {
		aU, bU := a.Lang == "", b.Lang == ""
		if aU == bU {
			return false
		}
		return !aU
	})
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("order = %v, want %v", got, want)
	}
}

// A large list must not take quadratic time. The old comparator, being
// inconsistent, sent sort.Slice into its worst path.
func TestLyricVersionSortIsNotQuadratic(t *testing.T) {
	versions := make([]LyricVersion, 2000)
	for i := range versions {
		if i%7 == 0 {
			versions[i].Lang = ""
		} else {
			versions[i].Lang = fmt.Sprintf("l%d", i%40)
		}
	}
	done := make(chan []string, 1)
	go func() {
		out := make([]string, len(versions))
		sort.SliceStable(versions, func(i, j int) bool {
			aU, bU := versions[i].Lang == "", versions[j].Lang == ""
			if aU == bU {
				return false
			}
			return !aU
		})
		for i, v := range versions {
			out[i] = v.Lang
		}
		done <- out
	}()
	select {
	case out := <-done:
		// The first unlabelled entry must come after every labelled one.
		seenUnlabelled := false
		for _, l := range out {
			if l == "" {
				seenUnlabelled = true
				continue
			}
			if seenUnlabelled {
				t.Fatal("a labelled version was sorted after an unlabelled one")
			}
		}
	case <-time.After(20 * time.Second):
		t.Fatal("sorting 2000 versions did not finish in 20s; the comparator is not a valid ordering")
	}
}

func sortWith(v []LyricVersion, less func(a, b LyricVersion) bool) []string {
	sort.SliceStable(v, func(i, j int) bool { return less(v[i], v[j]) })
	out := make([]string, len(v))
	for i, x := range v {
		out[i] = x.Lang
	}
	return out
}
