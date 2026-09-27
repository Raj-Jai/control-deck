# Remaining Work — Control Deck

Live tracker for every finding in `CONTROL_DECK_AUDIT_REPORT.md` that is not yet fixed.
Each unit is committed atomically. Update this file in the **same commit** as the fix.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done (with commit sha)

---

## 0. Progress

| # | Unit | Status | Commit |
|---|------|--------|--------|
| 0 | Tracker created | [x] | (this file) |
| 1 | SEC-007 root file server → allow-list | [x] | (this commit) |
| 2 | SEC-001/002/003 geo path traversal | [x] | (this commit) |
| 3 | SEC-004/006/008/009 session tokens + CSRF guard + rate limit | [x] | (this commit) |
| 4 | SEC-005/SEC-011 WebSocket origin verification | [x] | (this commit) |
| 5 | SEC-006/008/009 clipboard + PIN brute force + gate | [x] | unit 3 |
| 6 | SEC-012/014 proxy header + log growth | [x] | 327ade1, d3f301a |
| 7 | BUG-001 terminal panic kills the server | [ ] | |
| 8 | BUG-048 pkill -9 mpv/yt-dlp | [ ] | |
| 9a | BUG-051 GPU helper timeouts | [x] | (this commit) |
| 9b | BUG-053 SIGHUP re-registers the hotkey | [x] | 5bfa718 |
| 9d | BUG-045 clipboard per-attempt deadlines | [x] | 5bfa718 |
| 9e | BUG-048 pkill -9 mpv/yt-dlp | [x] | (this commit) |
| 9c | BUG-050 VLC port configurable | [x] | (this commit) |
| 10 | BUG-049/006/010 lyrics stall, unbounded cache | [x] | (this commit) |
| 11 | BUG-023/041a/SEC-015/CF-07 device tracking + id over plain HTTP | [x] | (this commit) |
| 12a | BUG-025/021/027 GPU label, volume curve, weather day labels | [x] | (this commit) |
| 13 | BUG-041/022/SUS-001 feature-flag contract + command registration | [x] | (this commit) |
| 14a | BUG-034 IDE debugger keys | [x] | (this commit) |
| 14b | BUG-031/033 video track cycling + honest failures | [x] | (this commit) |
| 14c | BUG-035/036/039/040/024/008/019 terminal, refresh, auto-focus, capabilities, clipboard | [x] | (this commit) |
| 14d | BUG-004/005/007 + A11Y-02/03/05 seek + lyrics modal | [x] | (this commit) |
| 14e | BUG-037 LRC parser + first frontend test runner | [x] | (this commit) |
| 14f | BUG-018/019 service worker scope + stale HTML | [x] | (this commit) |
| 14g | BUG-054/055 mDNS name + ship the systemd unit | [x] | (this commit) |
| 14h | BUG-006/009/020/030/044 remaining functional | [x] | (this commit) |
| 15 | A11Y-01..21 accessibility | [ ] | |
| 16 | PERF lazy mount, poll guards, caches, gzip, geo O(n^2) | [ ] | |
| 17 | UX leftovers (Media Browser, Geo, BLE, Streamer, Clipboard) | [ ] | |
| 18 | UI overhaul: new theme + design system | [ ] | |
| 19 | Tests, CI, dead code, gofmt/vet/lint | [ ] | |

---

## 1. Security (16 findings — 4 Critical, 6 High, 4 Medium, 1 Low, 1 Info)

The project has no authorization boundary. A path-traversal class plus a CSRF class
together give unauthenticated RCE and arbitrary file access to anyone who can reach the port.

- [x] **SEC-007** (Critical) `http.FileServer(http.Dir("."))` at the root served `config.json`
      (both PINs), `server.key`, `server.log`, `.git/` and the source tree. Replaced with
      `newStaticHandler()`: only `/static/**` is reachable, dotfiles and sensitive names are
      refused, and every path is containment-checked. Covered by `static_server_test.go`.
- [x] **SEC-001** (Critical) `/api/geo/session` traversal → arbitrary file read. Now
      `geoSessionPath()` with an allow-list charset and a post-resolution containment check.
- [x] **SEC-002** (Critical) same handler → arbitrary file delete. Same containment.
- [x] **SEC-003** (High) same handler → arbitrary file write outside `geo_sessions/`. Same
      containment; `handleGeoSave` appends the extension after validating the base name.
- [x] **SEC-004** (Critical) `POST /api/command` accepted `text/plain` with no preflight and
      no Origin check, dispatching `git push` / `git reset HEAD~1` / `lock-session` from any
      web page the user visited. Now: every guarded route requires a session token, mutating
      requests must carry `X-Control-Deck-CSRF: 1` (a custom header, so cross-origin needs a
      preflight, and no `Access-Control-*` header is ever returned), and bodies must be JSON.
- [x] **SEC-006** (High) clipboard read/write unauthenticated — now behind the session.
- [ ] **SEC-007a** (Critical) rotate `server.key`, `pin`, `media_pin` — readable on the LAN.
- [x] **SEC-008** (High) no brute-force protection on the PIN endpoints — now 5 attempts then
      a doubling lockout per client IP, cleared on success, `Retry-After` on 429.
- [x] **SEC-009** (High) the dashboard lock was a client-side gate protecting nothing — every
      endpoint now requires a server-minted token, the remembered mode is only honoured while a
      live token exists, and the four data hooks do not connect while locked.
- [x] **SEC-010** (Medium) "Media Streamer" mode is not actually restricted.
      The mode is unlocked with a separate, weaker PIN and is described as "just listen to
      what is playing", but it rendered `ConnectedDevicesCard` whole - including the broadcast
      toggle, which mutes the workstation and pushes audio to every connected device, and
      the per-device start and stop. The card takes a `readOnly` prop that removes both, and
      the mode says so on screen. Verified in a browser with both PINs: the dashboard PIN
      gets the broadcast button and two per-device stream buttons; the media PIN gets the
      list, no controls, and the note.
- [x] **SEC-011** (Medium) audio WebSocket had no Origin check — same helper, and the
      `InsecureSkipVerify: true` option that disabled the library's own check is gone.
- [x] **SEC-012** (Medium) `X-Forwarded-For` trusted unconditionally — ignored entirely now;
      the socket address is the only source used for both the client list and the PIN lockout.
      The stray `Access-Control-Allow-Origin: *` on `/media-stream` is also gone.
- [x] **SEC-013** (Info) command-injection review — **no exploitable shell injection found**.
- [x] **SEC-014** (Medium) unbounded, publicly served log containing window titles — the
      window watcher no longer logs once per second, only on change, and the log is no longer
      served at all.
- [x] **SEC-015** (High) `device_id` empty over plain-HTTP LAN → per-device controls dead.
      `crypto.randomUUID()` only exists in a secure context, and the README documents reaching
      the dashboard from a phone over plain-HTTP LAN, so the id came out empty and every
      per-device control, the audio WebSocket registration and the whole hotkey broadcast path
      answered "404 device not connected". `lib/deviceId.ts` now builds a v4 UUID from
      `crypto.getRandomValues`, which is available in every context. Verified against a real
      LAN address over plain HTTP: `isSecureContext` false and `crypto.randomUUID` absent,
      yet the id is a valid v4 UUID and reaches the server.
      **A second path was still broken.** `ConnectedDevicesCard` read
      `sessionStorage.getItem('dash_device_id')` directly - a key nothing ever writes there,
      since the id lives in `localStorage` - so it sent `device_id=` empty regardless of
      context, and that read also bypassed the fallback. It now uses `getOrCreateDeviceId()`.
      Re-verified over the LAN address: zero requests with an empty id, where before there
      were two per poll.
- [x] **SEC-016** (Low) `geo_sessions` was created 0755 with 0644 files. Now 0700/0600.

## 2. Backend reliability

- [x] **BUG-001** (Critical) `close(done)` from two goroutines in `terminal.go`, no `sync.Once`
      → `panic: close of closed channel` kills the entire dashboard. *(done: the channel is
      closed through a `sync.Once`, with a test that closes from two goroutines)*
- [x] **BUG-043** `/api/service-stats` slept 200 ms per tracked service inside every handler
      invocation. CPU% is now derived from a background sampler publishing every 2 s, and the
      handler is a pure read of the last snapshot.
- [x] **BUG-045** `wl-paste` and `xclip` share a single 2-second X selection context.
      The shared context was already fixed - each helper gets its own deadline, so a
      `wl-paste` that uses the whole budget no longer launches the X11 fallback already
      expired. The second half was not: the error was whatever the last helper returned,
      "context deadline exceeded" or "signal: killed", naming neither the binary nor the
      cause. Both helpers now go through one `attempt` that distinguishes *not installed*,
      *did not respond within the deadline*, *exited with status N* (with the command's own
      stderr) and *could not be run*, and a both-failed error names both. `writeClipboard`
      was aligned with the same helper. Six tests.
- [x] **BUG-048** `killMusicPipeline` ran `pkill -9 -x mpv` and `pkill -9 -x yt-dlp`, so
      playing one song from the deck killed every media player and every download on the
      machine, including the user's own. The pipeline this service owns already runs in its
      own process group (`Setpgid`) and is killed as a group, so the blanket kill was both
      redundant and destructive.
- [x] **BUG-049** a lyrics lookup (four third-party HTTP requests with retries) ran inline on
      the broadcaster's goroutine, stalling every client for up to 18 s on each track change.
      It now runs on its own goroutine, at most one in flight per track, and the broadcaster
      only reads the cache. Measured on a live instance: 500 ms ticks, 532 ms worst stall.
- [x] **BUG-050** VLC detection was hardcoded to `localhost:8080` - the dashboard's own port,
      not VLC's. Now `vlc_base_url` in config, defaulting to VLC's 8081.
- [x] **BUG-051** `nvidia-smi` / `intel_gpu_top` were spawned twice a second with no timeout,
      so a wedged `nvidia-smi` (routine during a driver reset) blocked the state broadcaster
      indefinitely. Every helper now runs under `exec.CommandContext` with a finite deadline.
- [x] **BUG-052** `bootTimeCache` / `bootTimeOnce` were unsynchronised globals; two concurrent
      handlers could read a half-written `time.Time`. Now a `sync.Once`.
- [x] **BUG-053** SIGHUP reload did not re-register the broadcast hotkey; the new value was
      read into the config and ignored until a restart. Reload now re-registers the binding
      and re-reads the video player config.
- [x] **BUG-054** the Avahi file published the services but set no host name, so the dashboard
      was advertised under the machine's hostname rather than `control-deck.local` as the
      README claimed. `host-name` is set, and the README documents the hosts entry Avahi
      requires.
- [x] **BUG-055** the README said to `cp tab-dashboard.service`, and no such file existed in
      the repository — so installs got whatever the default was, including no restart. The
      unit now ships, matches the real deployment exactly (same ExecStart and
      WorkingDirectory), and uses `Restart=always` plus `KillMode=control-group`. The README
      also said `enable --now tab-dashboard` when the unit is `tab-dashboard.service`, and
      said nothing about rebuilding before restarting.
- [x] **SUS-002** `buildCommandMap` runs outside `configMu` at startup. **Not a defect.**
      Every derived global (`commandMap`, `dashPIN`, `dashMediaPIN`, `caffeineSD`) is
      written under `configMu.Lock()` in the reload path and read under `RLock()`, including
      in `auth.go` and `checkCaffeine`. Rather than assert that, `TestConfigReloadRacesWithAuthentication`
      now hammers a config reload against four concurrent readers under `-race`; it passes.
      `TestReloadChangesTheEffectivePIN` pins that a reload really does take effect and that
      removing the PIN falls back instead of keeping a stale one.
- [x] **SUS-003** `sort.SliceStable` comparator in `buildVersions` is not a strict weak ordering.
      It returned `true` for any pair of two labelled languages, claiming i<j and j<i at once,
      so the result was unspecified and a larger list would sort quadratically. The honest
      answer for two equivalent elements is "not less than", which is what stability already
      uses. Three tests: every triple checked for transitivity, plus irreflexivity and
      asymmetry; the intent (labelled first, unlabelled last, score order otherwise) pinned;
      and 2,000 versions sorting in well under a second.
- [x] **SUS-004** `set_speed` accepts the wrong JSON type and silently pauses playback.
      `speed, _ := cmd.Value.(float64)` turned `{"value":"1.5"}` into 0, and mpv reads speed 0
      as pause - so a malformed request stopped the video. Every command payload now goes
      through `numericValue`/`stringValue`, which refuse the wrong type with a message, and
      speed additionally rejects anything <= 0 as not playable. The same unchecked assertions
      existed for aspect, subtitle delay, audio delay and brightness; all are fixed.
- [x] **SUS-005** argument injection via `xesam:url` and `req.Player`.
      The share URL came from MPRIS metadata and was passed as a bare argument, so a value
      beginning with `--` became an option to gjs or kdeconnect-cli; there is now a `--`
      separator *and* the value must be http or https with a host. `req.Player` is
      client-supplied and was interpolated into a gdbus `--dest`; it is now restricted to
      letters, digits, `.`, `_`, `-` and `@`, with no leading dash, no `/` and no `..` so it
      cannot address a different object path on the bus. Sixteen tests cover the accept and
      reject lists, including `javascript:`, `data:` and `--help`.
- [x] **SUS-006** the same URL is handed to `window.open` on the client, so a `javascript:`
      value arriving via MPRIS metadata would have been executed by the browser. The
      open-in-browser path now applies the same scheme check.

## 3. Fabricated or incorrect values

- [x] **BUG-020** the volume row looked identical to a working one with no audio stack, so a
      user dragged a slider that did nothing. A negative volume is a "could not read this",
      not zero, so the row now says "no audio output detected" and disables itself.
- [x] **BUG-021** the volume and brightness sliders applied a quadratic curve, so dragging to
      50% set the value to 25% while the label read 50%. Linear now, and clamped.
- [x] **BUG-023** `trackClient` keyed on `RemoteAddr` including the ephemeral port, so one
      tab yielded four phantom "Linux (you)" rows. The device id is the key now, with the
      port-stripped socket address as a fallback.
- [x] **BUG-025** the GPU bar rendered the literal string `"GPU"` as its reading when the
      counters were unreadable. It now says "no data" - a backend that cannot read a counter
      is not a reading of zero.
- [x] **BUG-026** `/api/service-stats` read `cutime`/`cstime` and `vsize` instead of
      `utime`/`stime` and `starttime`. `parseProcStat` strips `pid (comm)`, so documented field
      N lives at index N-3; the code used 13/14/21. Verified against the kernel: real age
      3197s vs 3190s reported, real CPU 6.7% vs 8%, and the old indices read `cutime`=113890
      against a real `utime` of 12104.
- [x] **BUG-027** weather day labels shifted by one. Open-Meteo returns a bare calendar date,
      which `new Date()` parses as UTC midnight - the previous day anywhere west of Greenwich.
      Verified at UTC-8: the old code labelled today "Fri" and tomorrow "Today", i.e. every
      single day wrong. The calendar parts are now compared directly.
- [x] **BUG-041a** `crypto.randomUUID()` needed a secure context, so over plain-HTTP LAN
      `deviceId` was `''` for the whole session. Fixed in `lib/deviceId.ts`; the id also moved
      from sessionStorage to localStorage so a reload no longer orphans the audio registration
      (CF-07).

## 4. Feature flags

- [x] **BUG-022** WARP/ERP toggles gated on the binary existing rather than on the command being
      registered - `warpOn`, `warpOff` and `erpLogin` were in no command map at all, so the
      button rendered and the server answered "Unknown command". All three are registered now,
      and the capability check requires registration as well as the binary.
- [x] **BUG-041** `power`, `scenes` and `filedrop` were in the backend's KnownFeatures and in
      config.example.json but had no frontend key, so setting them to false did nothing. The
      keys exist now, the handlers are routed, and the cards render. `TestFeatureKeysMatchTheFrontend`
      fails the build if either side drifts again.

## 5. Remaining functional bugs

- [x] **BUG-004** a seek the player ignored left the optimistic position set forever, so the
      displayed time stayed stuck at the dragged-to value. It now gives up after 3s and shows
      the real position.
- [x] **BUG-005** the seek slider committed only on mouseup/touchend, so arrow keys moved it
      but never applied the value. Arrow/Home/End/PageUp/PageDown now commit on keyup.
- [x] **BUG-006** a carousel gesture starting on the seek slider set the dragging flag and
      then returned early on touchend without clearing it, so the carousel stopped responding
      for the rest of the session. The flag is now always released, including on touchcancel.
- [x] **BUG-007** the fullscreen lyrics modal has no focus trap, Escape, or focus restore.
      *(done in the seek/modal commit: a focus trap, Escape to close, and focus restored to
      the control that opened it)*
- [x] **BUG-038a** the mixer's sliders cleared their dragging flag on
      pointerup and touchend but not on keyup or blur, so a keyboard user who moved one left
      it flagged as dragging for the rest of the session and the handle stopped tracking the
      host. `onKeyUp` and `onBlur` now commit on every slider.
- [x] **BUG-009** one failed artwork load left the placeholder up for every subsequent track.
      The failure now resets when the artwork URL changes.
- [x] **BUG-018** the service worker's scope excludes every request its fetch handler serves.
      It is served from `/static/` but registered with `Service-Worker-Allowed: /`, so its
      scope is the whole origin and its handler saw every request the page made - Open-Meteo
      forecasts, YouTube thumbnails and the rest. Each of those got a cache lookup, and
      because the "is this the shell" test matched any pathname ending in `/`, some were
      written into our cache as well. The handler now returns immediately for a different
      origin. This also retires **PERF-24**, which was the same defect seen as a wasted
      round trip. Verified in a browser: after driving a cross-origin fetch, the cache
      contains only the five same-origin precache entries.
- [x] **BUG-019** the HTML shell was cache-first under a fixed cache name, so an installed PWA
      kept being served the previous `index.html` — which points at asset hashes the rebuild
      replaced. HTML is network-first now, and the cache name is stamped with the emitted
      bundle hash by a Vite plugin, so a rebuild invalidates the old cache.
- [x] **BUG-024** clipboard copy reported success even when `document.execCommand('copy')`
      returned false, which is what it does without a secure context. The result is now checked.
- [x] **BUG-028** geo calibration is an O(n²) render and memory loop.
      *(done: the calibration samples are accumulated into a running sum ref and published
      to state once a second instead of copying an array, and the recording is capped at
      5,000 points)*
- [x] **BUG-029** the BLE advertised name is never set; `stop()` never stops watching.
      Four separate defects made the feature non-functional end to end:
      the host advertised under whatever name the machine happened to have while the phone
      filtered on `conquest`; `stop()` passed a fresh arrow to `removeEventListener`, which
      matches nothing; it never called `unwatchAdvertisements`, so the radio kept scanning
      (now every deck switch, with lazy bodies); and cancelling the chooser was reported as
      an error. The adapter alias is now set via `busctl` with the name as a validated argv
      entry (32-char cap, no control characters, never a shell) and the name is sent with the
      start request.
- [x] **§8.11** the BLE meter showed a full green bar and a distance before any packet
      arrived, because `smoothed` starts at 0 and 0 dBm mapped to 100%. It now shows
      "No reading", and the advertiser and scanner controls are real 44px buttons that
      respond to click rather than pointerdown (they had no keyboard path at all).
- [x] **BUG-030** music-search responses can arrive out of order and overwrite newer results.
      *(done: the search now carries a request sequence and ignores a response that is not
      the newest)*
- [x] **BUG-031** "Toggle subtitles" sent `track_id: 0`, which is *off* in both players, and
      "Cycle audio" sent `track_id: 1`, which is *select the first track*. Neither cycled.
      The backend already parsed `subtitles[]` and `audio_tracks[]` and never used them; it now
      resolves a cycle against the reported list, and the deck renders the tracks as chips with
      the active one marked.
- [x] **BUG-033** `handleVideoCommand` logged a failure and still answered 200 "ok". It now
      answers 502 with the reason, and the frontend checks the status — which is why the delay
      nudges used to snap back with nothing reported.
- [x] **BUG-034** IDE "Step Out", "Stop" and "Restart" all sent a bare F5 - i.e. Continue -
      and "Toggle Breakpoint" shelled out to `playerctl play-pause` and paused the user's
      music. The comments claimed keys the code never sent. The bindings are now VS Code's
      real ones, and `sendkey` learned `ctrl+` / `shift+` prefixes so they can be expressed.
- [x] **BUG-035** the terminal reconnected on a flat 2 s forever and appended a
      `[disconnected]` line every 2 s, so the scrollback filled with them. Bounded exponential
      backoff now, and it says "disconnected — retrying" once.
- [x] **BUG-036** "Refresh" was `location.reload()` with no confirmation, which drops the
      client's socket and ends the broadcast for *every* device. It now always takes two taps
      and names the consequence when a broadcast is live.
- [x] **BUG-037** the LRC pattern demanded exactly two minute digits and a mandatory fraction,
      so any file using `[1:23.45]` lost every line, and it read only the first tag on a line,
      so a repeated chorus lost every repeat. Both fixed, with `.5` now correctly 500ms.
      This is the first frontend test in the project: `npm test` runs Node's built-in runner
      against the pure functions, with no new dependency.
- [x] **BUG-038** `triggerCommand`/`seekTo`/`setVolume`/`setBrightness` never check the response.
      `triggerCommand` already returned a boolean; these three awaited the fetch and threw
      the status away, so a 400 from a missing player, a 403 from a locked page or a 503 from
      a dead host looked exactly like success - the slider sat at the new value and the
      player never moved. They now go through one `postControl` helper that checks the status,
      logs the reason, and returns a boolean; the mixer's master volume and brightness revert
      to whatever the host reports and say so once, with a dismiss button. Verified in a
      browser against a stubbed 503: two requests, both reported, the alert rendered, and the
      handle back at the host's 66%.
      *(partially done: `triggerCommand` only)*
- [x] **BUG-039** auto-focus snapped the deck to Home for any window we do not map — a file
      manager, a settings dialog, a browser tab. Unrecognised windows now leave the deck alone.
- [x] **BUG-040** a capability-fetch failure hides every capability-gated card, no retry.
      *(done: capabilities fail open and the card offers a retry)*
- [x] **BUG-042** art theming silently fails for any art host without CORS, and sticks.
      The `art-themed` class was removed only in the image's `onerror` handler, so a host
      without CORS headers - or anything thrown while reading the pixels - left the previous
      cover's palette on screen with nothing to indicate the colours were stale. The
      palette is now cleared on *every* transition, before the new cover is even requested,
      and a null result or a throw falls back to the theme's own accent. The arithmetic moved
      into `lib/artPalette.ts` and the class/property handling into `lib/artTheme.ts` so
      both are testable without a DOM: 12 tests cover the palette (solid fields, dominant
      hue, complementary accent, greys, transparency, the legibility clamp) and the
      never-stick property specifically - a success followed by a failure leaves neither the
      class nor either custom property behind.
      *(partially done: accent contrast clamp only)*
- [x] **BUG-044** `speed_*` injected `shift+.` / `shift+,` with no idea which player they
      would reach, so pressing "Faster" while the focus was in an editor typed into the
      editor. The named player is now driven through MPRIS directly, and the keystroke fallback
      raises that window first.
- [x] **SUS-001** file-drop and Scenes were entirely unwired. The handlers existed in untracked
      `files.go` / `scenes.go` and the components in untracked `FileDropCard.tsx` /
      `ScenesCard.tsx`, but nothing imported or routed them. Both are now wired, behind their
      own feature flags and the session, and committed.
- [ ] **SUS-006..020** remaining suspected-bug items in §6.

## 6. Accessibility (21 findings)

- [x] **A11Y-01** every control now has a visible focus ring, via a global
      `:focus-visible` rule. Several utility classes suppress the browser default, so a keyboard
      user previously had no way to tell where they were. Verified across 14 real Tab stops.
- [x] **A11Y-02/03** the seek slider has an `aria-label` and a spoken `aria-valuetext`
      ("0:30 of 5:00") now.
- [x] **A11Y-04** the carousel arrows have no accessible name. *(done in the label sweep below)*
- [x] **A11Y-22** the last three hand-rolled `div role="button"` toggles are now real
      `<button>` elements: `QuickSettings`' quick toggles and `AudioStreamCard`'s transport
      tile. Each was re-implementing what the browser already provides - `tabIndex`, an Enter
      and Space handler, and a focus ring - and the hand-rolled versions could drift. The
      `aria-pressed` state is unchanged, so the toggle semantics the tests assert are intact.
- [x] **A11Y-05** the lyrics modal has a focus trap, Escape, and focus restore.
- [x] **A11Y-06..21** `prefers-reduced-motion` is honoured: continuous animations stop and the
      pulsing status dot stays visibly lit rather than disappearing with its animation. Every
      icon-only control on every deck has an accessible name - verified by walking all five
      decks in a browser and counting unnamed buttons, now zero. The service-stats strip is a
      `role="status"` live region.

## 7. Performance (42 findings)

- [x] **PERF-01/38** ~15 avoidable `playerctl` spawns per 500 ms tick.
      `playerctl -l` now goes through a 1.5 s cache, which collapses a state tick's
      several calls into one spawn; the per-player probes were left alone because their
      values genuinely change between ticks. Covered by `TestPlayerListIsCached`.
- [x] **PERF-05/23** all five deck bodies were mounted at once, so the terminal's PTY, the
      xterm canvases, the video deck's 1 Hz poll and both 5 Hz ping loops ran for decks the
      user was not looking at. Each body now renders only while its page is on screen (the
      page shells stay mounted so the carousel still scrolls). Measured over 5s windows:
      on the Terminal deck no endpoint polls at all; on the Video deck only
      `/api/video/status`; the 10/s ping only appears on the Home deck, where the two cards
      that own it are.
      *(the `document.hidden` half was done earlier: both ping loops idle while the tab is
      hidden and re-measure once on `visibilitychange`)*
- [x] **BUG (found by the above)** leaving a deck while its terminal socket was still
      handshaking orphaned it: the socket was only tracked in a ref assigned on `onopen`,
      and its `onclose` then scheduled a reconnect that nothing could clear. The result was
      an orphaned PTY and a reconnect loop against a deck that was no longer on screen, once
      per visit. Fixed with an explicit `cancelled` flag and a closure-held socket.
- [x] **BUG (found by the above)** with lazy bodies, a programmatic smooth scroll made
      `Math.round(scrollLeft / width)` flip the active page mid-animation and back, remounting
      the deck body each time - a terminal opened, closed and reopened within 200ms of being
      opened. The scroll handler now defers to the navigation target for 1.2s.
- [ ] **PERF-04/16/17** the video deck's 1 Hz poll still runs whenever the Video deck is on
      screen even if the user is looking at the browser tab behind it, and the bundle is still
      one 656 kB chunk with `@xterm/xterm` imported statically.
      *(xterm is now only fetched when the Terminal deck is first opened, via the lazy body)*
- [x] **PERF-09** the survey recording was unbounded: the canvas redraw is O(n) per point,
      so a long walk grew React state and re-rendered the whole polyline every 200 ms.
      Now capped at `MAX_RECORD_POINTS` (5,000, over 16 minutes at 5 Hz) with the dropped
      count shown to the user, in `frontend/src/lib/geoRecording.ts` with four tests.
- [x] **PERF-06/10** `lyricsCache` was never pruned, and a miss was re-queried every tick.
      Now bounded at 200 entries with a miss cached as a value, plus an in-flight set so a
      track is never looked up twice concurrently.
- [x] **PERF-25** no gzip on either listener.
      `compressHandler` wraps both `ListenAndServe` calls: the 656 kB bundle now transfers
      as 183 kB (72% smaller) and a 1,196 B HTML page as 545 B. Text-ish types only, with a
      `sync.Pool` of writers. Event streams and WebSocket upgrades pass through untouched -
      wrapping the writer removed `http.Hijacker` and broke every terminal handshake with
      501, which `TestCompressHandlerPassesThroughWebSocketUpgrade` now guards.
- [x] **PERF-26** the SSE payload is not delta-encoded.
      The state went out whole, twice a second, to every client, and almost all of it is
      identical between two consecutive frames. Unchanged top-level keys now go out as
      `event: delta` messages carrying only what moved, tracked per client because two
      clients that joined at different times have different bases. Measured over 8 s against
      the live host: 1 full frame (1,800 B) plus 15 deltas (2,958 B) = 4,758 B, against about
      28,800 B for the same run without them - **83% less on the wire**.
      Three properties make this safe rather than clever:
      - the format is a **superset** of the old one, so a client that does not know about
        deltas simply never sees them and keeps working on the full frames;
      - a **gap discards the accumulated base** and waits for the next full frame, so a
        client that misses a delta heals instead of drifting;
      - a key that **disappears** is sent as an explicit null and forces a whole frame,
        because JSON cannot express "unset" by omission and omission means "unchanged" here.
      A frame that repeats itself sends nothing at all. Describing a change is not free
      either, so a delta larger than the frame falls back to the frame.
      Known limit: the merge is one level deep, so a nested object that changes every
      tick - the `sys` block of CPU, RAM and disk figures - is resent in full. Going
      deeper was not worth the complexity against gzip, which already handles the
      repetition inside it. Nine Go tests and ten client tests, including a run that
      reconstructs the same state a whole frame each time would have produced.
- [x] **PERF-30/31** audio accumulator unbounded while suspended; 512-frame queue.
      *(done in the audio commit: the suspended-tab buffer is bounded and the queue is
      512 frames)*
- [x] **PERF-37** `resolveArtURL`'s single-entry cache re-base64s a file every 500 ms.
      Replaced with a bounded LRU in `artcache.go`: 4 MiB per entry, 16 MiB total, so
      alternating tracks both stay cached and one huge cover cannot be held for the life of
      the process. Seven tests cover the hit, the alternating case, LRU eviction, the
      oversized refusal, replace-without-double-counting, invalidation, and concurrent access.
- [x] **BUG (found by the above)** `artCachePath`/`artCacheData` were plain globals with no
      mutex, but the state payload is built once per client, so two clients meant two
      goroutines reading and writing the same pair. The LRU is now guarded, and
      `TestArtCacheConcurrentAccess` runs it under `-race`.

## 6b. Fixes from the latest verification pass

- [x] The geo canvas was drawn into a fixed 600x400 buffer and stretched to the card's
      real width, so an 8px label rendered at about 4.7px. The backing store now tracks the
      element's box times `devicePixelRatio` via a `ResizeObserver` (measured: 706x471 CSS
      -> 706x471 at DPR 1, 1412x941 at DPR 2), and the draw code applies `setTransform` once
      so every existing coordinate keeps its meaning.
- [x] Two 5 Hz ping intervals kept measuring host latency with no `document.hidden` guard,
      unlike every other poll in the app; a backgrounded tab kept the radio awake.
- [x] Enabling the terminal and geo decks in the verification pass exposed controls under
      40px on both: the terminal toolbar, key modifiers, cursor pad and quick chips, and the
      video frame-step, track, aspect and speed controls. All are now at least 44x44, and the
      full 59-check responsive suite is clean.
- [x] Single 656 kB bundle, no code splitting.
      Each deck is a `React.lazy` chunk fetched the first time its page is opened. The entry
      chunk is now 295 kB (86 kB gzip) instead of 656 kB (183 kB gzip) - 53% less on the
      critical path - and the terminal's 343 kB (88 kB gzip, mostly @xterm/xterm) is only
      paid for by someone who opens a terminal. Video is 10 kB, Media 5 kB, IDE 3 kB.
- [x] **BUG (found by the split)** the service-worker cache stamp took whichever `.js` file
      came first in the assets directory. Once the build was split that was a deck chunk, so
      the cache name was derived from `IdeDeck`'s hash - and a build that changed only the
      entry chunk would have kept the same cache name, serving the old HTML and old bundle to
      an installed PWA. It now looks for `index-*.js` specifically.
- [x] `xterm@5` was a dependency alongside `@xterm/xterm@6` and imported nowhere. Removed.
- [x] **MAINT-01** `ToggleGrid.tsx` (139 lines) was dead - nothing imported it - and it was the
      only remaining reason `.toggle-ripple`, `@keyframes rippleAnim` and their art-themed
      override existed. Deleted the component and all three CSS rules. This also retires
      **PERF-21**: its ripple appended a span outside React and removed it on `animationend`
      only, so under `prefers-reduced-motion` the node was never removed and one leaked per
      tap, and `onMouseDown` plus `onTouchStart` drew two ripples per tap on a touchscreen.

### Session model (added with unit 3)

- `POST /api/auth` and `/api/auth-media` mint a 32-byte hex token on a correct PIN.
- Tokens live 12 h, are capped at 64 live sessions, and are reaped every 10 min.
- Public: `/api/auth`, `/api/auth-media`, `/api/capabilities`, `/api/features`, `/api/ping`,
  everything under `/static/`.
- Everything else needs `X-Control-Deck-Token` (or `?token=` for EventSource/WebSocket).
- Mutating requests additionally need `X-Control-Deck-CSRF: 1` and a JSON content type.
- The token is in `sessionStorage`, so a second tab asks for the PIN again.
- `background.html` has its own unlock gate and stores its token in `localStorage`.
- `--toggle-broadcast` mints a token in-process rather than leaving a localhost hole.

## 8. UX / product leftovers

- [x] **§8.3** the Media Browser deck never says where "Play/Pause" will be sent; 9 px key
      hints. The deck now names the player it is sending to, shows what that player has
      loaded, and offers every running player as a radio choice so the target can be
      overridden - with an explicit note when more than one is running. The override follows
      the automatic choice again if that player goes away. The hints are 11 px and carry a
      screen-reader-only "keyboard shortcut", so the bare letter is at least announced as
      what it is.
      hints; current speed never shown; the "No media player detected" fallback never fires.
- [~] **§8.4** the Video deck now renders `subtitles[]` / `audio_tracks[]` as chips. Still to do:
      aspect/speed pills are still small, and the pills still mix concepts without explanation.
- [x] **§8.5** the IDE deck has no result surface and runs in the dashboard's CWD, not the
      focused project's. IDE commands now run inline with a two-minute deadline and return
      their combined output (tail, 32 KiB cap), which the deck shows in a scrollable panel
      with a pass/fail line and a timestamp - a failed `git push` no longer looks like a
      successful one. A new `ide_work_dir` config key chooses the directory, falling back to
      the repository the binary was built from. Verified end to end: `Stage All` reports
      "Succeeded" with the real `git status -s` output from the configured repo.
      Two bugs found while testing it: cancelling the context killed the direct child but
      `CombinedOutput` kept waiting on pipes its descendants still held, so the deadline was
      not real (fixed with `Cmd.WaitDelay`); and `getConfig()` returned nil before the first
      load, so any caller reading a field panicked (now a zero Config).
- [x] **§8.6** the terminal's `rebuild` button overwrites the binary with no confirmation.
      It now confirms first, and says plainly that the running process is not replaced until
      the service is restarted - verified in a browser that dismissing the dialog sends no
      `go build` at all.
- [x] **§8.8** the clipboard card had a placeholder but no label, a toast with no live region,
      and no size cap. All three fixed, with a character count and a note that Push writes to
      the host clipboard.
- [x] **§8.10** the geo canvas has no `devicePixelRatio` scaling; no recording cap or auto-save;
      delete fires on `pointerDown` with no confirm. *(all three done in the performance
      commit: DPR-aware backing store, a 5,000-point cap with the dropped count shown, and a
      confirm before a session is deleted)*
- [x] **§8.11** the BLE meter shows 62% green before any scan; unmounting stops advertising
      for every other client. *(done in the BLE commit)*
- [x] **§8.15** the Media Streamer page uses `location.reload()`; 28 px exit button.
      Exiting is a state change in `App` now, so the device id, the capability cache and the
      scroll position survive and nothing behind the lock screen is re-fetched. Verified on a
      390x844 touch viewport: 44x44 button, back at the lock screen, and zero page
      navigations caused by the exit.
- [x] **UX-29** no freshness indicator anywhere; a stale value looks current.
      The stream can stall - a lyrics lookup alone blocked the broadcaster for up to 18 s -
      so a value on screen and the truth diverge regularly with nothing to say so. A
      `FreshnessPill` in the top strip now says `Live`, `Ns ago`, `Stale · Ns ago` or
      `Not updating`, driven by when the last frame actually arrived, which the stream hook
      now reports. It is quiet when live and loud when not, is a polite live region with an
      icon as well as colour, and carries a full explanation for a screen reader. The
      thresholds are in `lib/freshness.ts` with eight tests; the hook clears the timestamp
      when it disconnects, so nothing on screen can look current when no frame has arrived.
      Verified in a browser: absent while locked, `Live` with its explanation once unlocked,
      and a polite `role="status"` with an icon.
- [x] **UX-31** the two PWAs share icons; `background.html` lacks the iOS meta tags.
      The background listener and the dashboard used byte-identical icons, so they were
      indistinguishable in a launcher, in the manifest shortcut list, and on a home screen.
      It now has its own maskable set (`icon-bg-*`, amber rather than cyan) referenced from
      its manifest, its `apple-touch-icon` links and the dashboard's shortcut entry; the
      main page also gained the `mobile-web-app-capable` and `apple-mobile-web-app-title`
      tags it was missing, without which iOS labels the icon "Web App". Verified in a
      browser: both manifests parse, every declared icon returns 200, and each manifest's
      icons are byte-distinct from the other's.
- [ ] **§16** the 15 product/UX improvement proposals.

## 9. UI overhaul

Complete visual redesign: new design tokens, theme, and layout across every component.

- [x] New design system: colour tokens, spacing scale, radii, shadows, typography.
      A `--cd-*` token layer in `index.css` is the single source of truth - surfaces, text,
      accent, status, radii, shadows, scrim - with Tailwind pointing at the RGB channels so
      opacity modifiers still work. Added named radii (`rounded-card`, `rounded-control`),
      shadows, a `spacing.touch` 44px token, and a type scale that starts at 11px: the old
      ad-hoc classes had drifted down to 9 and 10px, which is not readable at arm's length.
- [x] New theme (light + dark), replacing the current ad-hoc palette.
      Dark keeps the established look; light is a real second theme, not an inversion. The
      choice persists, follows `prefers-color-scheme` by default, and an inline script in
      `index.html` applies it before first paint so there is no flash of the wrong theme.
      A `ThemeToggle` in the top strip switches it and the `theme-color` meta follows.
- [x] Component-by-component restyle via the tokens, without touching 141 call sites.
      Every `bg-white/5`, `border-white/[0.08]`, `bg-black/30` and the literal
      `text-green-400` / `text-red-400` / `text-amber-400` status colours are now token
      references, and the stylesheet's own hard-coded hex (sliders, scrollbar, icon button,
      toggle and card primitives) is gone. The 474 existing `deck-*` classes follow the
      theme for free, because the token is what they resolve to.
- [x] Motion system with `prefers-reduced-motion` respected. *(done in the a11y commit)*
- [x] Full `focus-visible` ring across every interactive element. *(done in the a11y commit,
      but see below - the ring was not actually following the accent)*
- [x] **BUG (found by the overhaul)** the focus ring asked for `var(--deck-accent, #06b6d4)`.
      No variable by that name existed, so it silently fell back to a hard-coded cyan and
      never followed the accent or the theme at all. Now `--cd-accent`.
- [x] Contrast verified in both themes rather than assumed. A browser pass that composites
      translucent backgrounds before comparing (a 15%-tint pill otherwise measures 1:1
      against its own text) found and fixed:
      - the `Paused` status pill used a literal `bg-yellow-500/15 text-yellow-400`, which is
        1.25:1 in the light theme - effectively invisible;
      - the light accent was cyan-600, 3.68:1 on white, fine for a border but under 4.5:1
        for a label, so it is now cyan-700 (5.4:1);
      - the light warning token measured 3.91:1 on the pill tint, now amber-800;
      - the stats strip and several eyebrows used the muted token at 40-70% opacity.
      Both themes now report **zero** text nodes below their WCAG threshold, across every
      deck with the secondary cards expanded.

## 10. Tests, tooling, dead code

- [~] **TEST-01..24** the audit's specified test cases. There is now a frontend test runner
      (`npm test`, Node's built-in runner, no new dependency) and Go tests for the areas fixed
      so far. No CI yet, and most of TEST-01..24 remain.
- [x] Deleted 927 lines of provably dead frontend code: `DefaultDeck`, `AppMixerCard`,
      `CaffeineCard`, `StepperControls`, `GuestView`, `LockScreen`, `SysStatsBar`,
      `authStore`, `BleRssiMonitor`. `AppMixerCard`/`CaffeineCard`/`StepperControls` only
      referenced each other, and `DefaultDeck` was the only thing importing them.
- [x] Extract shared `<VolumeSlider>` / `<BrightnessSlider>`.
      Five hand-rolled copies of the same drag-throttle-commit-revert logic
      (master volume, master brightness, per-app-stream volume, the Media Browser
      volume, the Video deck volume) are now one `ValueSlider`. The copies had
      drifted: three of them cleared their dragging flag on pointerup and
      touchend but not on keyup or blur, so a keyboard user was left with a
      slider stuck showing its own value instead of the host's, and the
      per-app-stream copy discarded the response so it could not revert at all.
      The shared component commits on every way a drag can end, throttles
      while dragging, reverts to the host's value when a send is refused, and
      says why. Verified in a browser against a stubbed 503: the alert renders
      and the handle returns to the host's 66%.
- [x] `gofmt -l` clean, `go vet` clean. `gofmt` flagged `audio.go`; `go vet` flagged a dead
      `sync.Once` in the new gzip handler and, in `cmd/sendkey`, three "possible misuse of
      unsafe.Pointer" plus two self-assignments. The ioctls there all take an *integer* value
      - an event code, a request number, a key counter - so they now pass it as `uintptr`
      instead of an `unsafe.Pointer` round trip that meant nothing. The self-assignments
      (`wantCtrl, ctrlCode = true, ctrlCode`) were no-ops and are now just the flag change
      they always meant to be.
- [x] Add CI: `.github/workflows/ci.yml` with three jobs.
      - **Go:** gofmt as a hard failure with the diff printed, `go vet ./...`,
        `go build ./...`, `go test -race -count=1 ./...`.
      - **Frontend:** `npm ci`, `tsc --noEmit`, `npm test`, `npm run build`, then a check
        that `static/` is committed and matches the source - `static/` is tracked, so a
        build that changes it means the deployable assets and the source have drifted. That
        check immediately caught a commit of mine that had shipped source without its build.
      - **Contract:** the feature-key test, since a flag the backend advertises and the
        frontend does not know silently disables a deck.
      Every step was run locally before being committed.
- [x] Ship `tab-dashboard.service` in-repo and correct the README. *(done: the unit and
      `avahi-service.conf` are in the repo with the real paths and the README documents the
      install; note the deployed copy under `~/.config/systemd/user` is separate and still
      needs the final deploy)*
