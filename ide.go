package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// The IDE deck's git and task commands were the only deck actions whose result
// the user could not see anywhere: they ran in the background, the handler
// answered "ok" the moment they were queued, and their output went to the
// dashboard's own stdout. A failed `git push` looked exactly like a successful
// one. They also inherited the dashboard's working directory, so they acted on
// whichever repository the service happened to be started in.

// ideCommandTimeout bounds an IDE command. A build can be slow, but not
// unbounded: the deck is waiting on it. A variable so a test can shorten it.
var ideCommandTimeout = 2 * time.Minute

// ideWaitDelay is how long to keep reading a killed command's output before
// force-closing the pipes.
var ideWaitDelay = 2 * time.Second

// Enough to see a test failure or a git rejection, bounded so a runaway build
// cannot buffer without limit.
const ideOutputMaxBytes = 32 << 10

// runIdeCommand executes an IDE command in the configured work directory and
// returns whether it succeeded along with the tail of its combined output.
func runIdeCommand(name string, args []string) (bool, string) {
	if len(args) == 0 {
		return false, "no command registered"
	}

	ctx, cancel := context.WithTimeout(context.Background(), ideCommandTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir = ideWorkDir()
	cmd.Env = os.Environ()
	// Cancelling the context kills the direct child, but CombinedOutput then
	// blocks reading the pipes until every descendant has let go of them: a
	// command that backgrounds a child, or a shell that spawned one, kept the
	// request open long past the timeout. WaitDelay force-closes the pipes so
	// the deadline is real.
	cmd.WaitDelay = ideWaitDelay

	out, err := cmd.CombinedOutput()
	if len(out) > ideOutputMaxBytes {
		// Keep the end: that is where the error and the failing test are.
		out = out[len(out)-ideOutputMaxBytes:]
	}
	text := strings.TrimRight(string(out), "\n")
	if ctx.Err() == context.DeadlineExceeded {
		text = strings.TrimSpace(text + "\n\n[timed out after " +
			ideCommandTimeout.String() + "]")
		return false, text
	}
	if err != nil {
		text = strings.TrimSpace(text + "\n\n[" + err.Error() + "]")
	}
	return err == nil, text
}

// ideWorkDir is where IDE commands run. The configured directory wins, and a
// missing or non-directory value falls back to the repository this binary was
// built from rather than the dashboard's own CWD.
func ideWorkDir() string {
	if dir := strings.TrimSpace(getConfig().IDEWorkDir); dir != "" {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
		log.Printf("ide_work_dir %q is not a directory; falling back", dir)
	}
	if root := repoRootFromExecutable(); root != "" {
		return root
	}
	return "."
}

// repoRootFromExecutable walks up from the running binary looking for a Go
// module or a git checkout.
func repoRootFromExecutable() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	dir := filepath.Dir(exe)
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// handleIdeOutput lets the deck show what a command did, for callers that want
// the raw result rather than the dispatch acknowledgement.
func writeIdeResult(w http.ResponseWriter, name string, args []string) {
	ok, output := runIdeCommand(name, args)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "ok", "executed": name, "ok": ok, "output": output,
	})
}
