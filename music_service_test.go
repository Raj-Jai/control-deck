package main

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Playing one song from the deck ran "pkill -9 -x mpv" and "pkill -9 -x
// yt-dlp", which killed every media player and every download on the machine -
// including the user's own music, which this service did not start. The
// pipeline it does own already runs in its own process group and is killed as a
// group, so the blanket kill was both redundant and destructive.
func TestKillMusicPipelineLeavesForeignProcessesAlone(t *testing.T) {
	// The old code ran "pkill -9 -x mpv", so the process has to actually be
	// named mpv for this to be a faithful reproduction. A copy of sleep under
	// that name is the cheapest stand-in.
	binDir := t.TempDir()
	shim := filepath.Join(binDir, "mpv")
	if err := copyExecutable("/bin/sleep", shim); err != nil {
		t.Skipf("cannot stage an mpv stand-in: %v", err)
	}

	victim := exec.Command(shim, "300")
	if err := victim.Start(); err != nil {
		t.Skipf("cannot start helper process: %v", err)
	}
	pid := victim.Process.Pid
	defer func() {
		syscall.Kill(pid, syscall.SIGKILL)
		victim.Wait()
	}()

	// No tracked pipeline, so this is the path a stale socket used to trigger.
	killMusicPipeline()

	// Give any signal time to land.
	// It must still be running: this is the process the user started, not us.
	if exitedWithin(pid, 700*time.Millisecond) {
		t.Fatalf("an unrelated mpv process (pid %d) was killed by killMusicPipeline", pid)
	}
}

// The pipeline the service does own must still be torn down, or a second song
// would stack up mpv instances.
func TestKillMusicPipelineStopsTrackedProcessGroup(t *testing.T) {
	cmd := exec.Command("sleep", "300")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot start helper process: %v", err)
	}
	pid := cmd.Process.Pid

	musicPipelineMu.Lock()
	prev := musicPipeline
	musicPipeline = cmd
	musicPipelineMu.Unlock()
	defer func() {
		musicPipelineMu.Lock()
		musicPipeline = prev
		musicPipelineMu.Unlock()
		if cmd.Process != nil {
			syscall.Kill(-pid, syscall.SIGKILL)
		}
		cmd.Wait()
	}()

	killMusicPipeline()

	if !exitedWithin(pid, 700*time.Millisecond) {
		t.Errorf("the tracked pipeline (pid %d) survived killMusicPipeline", pid)
	}

	musicPipelineMu.Lock()
	still := musicPipeline
	musicPipelineMu.Unlock()
	if still != nil {
		t.Error("musicPipeline should be cleared after teardown")
	}
}

// copyExecutable makes a runnable copy of src at dst, preserving the mode.
func copyExecutable(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode()|0o111)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// exitedWithin reports whether pid is gone within d. A killed child stays in
// the process table as a zombie until it is reaped, and signal 0 succeeds on a
// zombie, so liveness is read from /proc rather than probed with a signal.
func exitedWithin(pid int, d time.Duration) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
		if err != nil {
			return true // gone entirely
		}
		if idx := strings.LastIndex(string(raw), ")"); idx >= 0 {
			fields := strings.Fields(string(raw)[idx+1:])
			if len(fields) > 0 && fields[0] == "Z" {
				return true // killed; awaiting reaping
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}
