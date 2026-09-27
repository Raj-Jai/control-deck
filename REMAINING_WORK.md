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
| 9 | BUG-043/051/052/053 service-stats sleep, nvidia-smi, bootTime race, SIGHUP | [ ] | |
| 10 | BUG-049 lyrics stall on the broadcast goroutine | [ ] | |
| 11 | BUG-023/041a/SEC-015/CF-07 device tracking + id over plain HTTP | [x] | (this commit) |
| 12 | BUG-026/043/052 service stats: wrong fields, blocking sleep, data race | [x] | (this commit) |
| 13 | BUG-041/022 feature-flag + command registration | [ ] | |
| 14 | BUG-034/035/036/037/039/040/044/045/050/054/055 functional | [ ] | |
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
- [ ] **SEC-010** (Medium) "Media Streamer" mode is not actually restricted.
- [x] **SEC-011** (Medium) audio WebSocket had no Origin check — same helper, and the
      `InsecureSkipVerify: true` option that disabled the library's own check is gone.
- [x] **SEC-012** (Medium) `X-Forwarded-For` trusted unconditionally — ignored entirely now;
      the socket address is the only source used for both the client list and the PIN lockout.
      The stray `Access-Control-Allow-Origin: *` on `/media-stream` is also gone.
- [ ] **SEC-013** (Info) command-injection review — **no exploitable shell injection found**.
- [x] **SEC-014** (Medium) unbounded, publicly served log containing window titles — the
      window watcher no longer logs once per second, only on change, and the log is no longer
      served at all.
- [ ] **SEC-015** (High) `device_id` empty over plain-HTTP LAN → per-device controls dead.
- [x] **SEC-016** (Low) `geo_sessions` was created 0755 with 0644 files. Now 0700/0600.

## 2. Backend reliability

- [ ] **BUG-001** (Critical) `close(done)` from two goroutines in `terminal.go`, no `sync.Once`
      → `panic: close of closed channel` kills the entire dashboard.
- [x] **BUG-043** `/api/service-stats` slept 200 ms per tracked service inside every handler
      invocation. CPU% is now derived from a background sampler publishing every 2 s, and the
      handler is a pure read of the last snapshot.
- [ ] **BUG-045** `wl-paste` and `xclip` share a single 2-second X selection context.
- [ ] **BUG-048** `killMusicPipeline` contains `pkill -9 -x mpv` / `pkill -9 -x yt-dlp`.
- [ ] **BUG-049** lyrics lookup stalls the whole state broadcast for up to 18 s per track.
- [ ] **BUG-050** VLC detection hardcoded to the dashboard's own HTTP port.
- [ ] **BUG-051** `nvidia-smi` / `intel_gpu_top` spawned every 500 ms with no timeout.
- [x] **BUG-052** `bootTimeCache` / `bootTimeOnce` were unsynchronised globals; two concurrent
      handlers could read a half-written `time.Time`. Now a `sync.Once`.
- [ ] **BUG-053** SIGHUP reload does not re-register the broadcast hotkey.
- [ ] **BUG-054** the advertised mDNS name is never set.
- [ ] **BUG-055** the systemd unit the README tells you to install does not exist.
- [ ] **SUS-002** `buildCommandMap` runs outside `configMu` at startup.
- [ ] **SUS-003** `sort.SliceStable` comparator in `buildVersions` is not a strict weak ordering.
- [ ] **SUS-004** `set_speed` accepts the wrong JSON type and silently pauses playback.
- [ ] **SUS-005** argument injection via `xesam:url` and `req.Player`.

## 3. Fabricated or incorrect values

- [ ] **BUG-020** the volume control looks fully functional when the audio stack is absent.
- [ ] **BUG-021** the per-app volume slider applies a quadratic curve to a linear slider.
- [x] **BUG-023** `trackClient` keyed on `RemoteAddr` including the ephemeral port, so one
      tab yielded four phantom "Linux (you)" rows. The device id is the key now, with the
      port-stripped socket address as a fallback.
- [ ] **BUG-025** the GPU bar can render the literal string `"GPU"` as a measurement.
- [x] **BUG-026** `/api/service-stats` read `cutime`/`cstime` and `vsize` instead of
      `utime`/`stime` and `starttime`. `parseProcStat` strips `pid (comm)`, so documented field
      N lives at index N-3; the code used 13/14/21. Verified against the kernel: real age
      3197s vs 3190s reported, real CPU 6.7% vs 8%, and the old indices read `cutime`=113890
      against a real `utime` of 12104.
- [ ] **BUG-027** weather day labels shift by one depending on the time of day.
- [x] **BUG-041a** `crypto.randomUUID()` needed a secure context, so over plain-HTTP LAN
      `deviceId` was `''` for the whole session. Fixed in `lib/deviceId.ts`; the id also moved
      from sessionStorage to localStorage so a reload no longer orphans the audio registration
      (CF-07).

## 4. Feature flags

- [ ] **BUG-022** WARP/ERP toggles gate on the binary existing, not on command registration.
- [ ] **BUG-041** `power`, `scenes`, `filedrop` accepted by the backend, ignored by the frontend.

## 5. Remaining functional bugs

- [ ] **BUG-004** seek position can stick forever after a failed seek.
- [ ] **BUG-005** the media seek slider is unusable from the keyboard.
- [ ] **BUG-006** carousel `dragging` flag sticks when a gesture starts on a slider.
- [ ] **BUG-007** the fullscreen lyrics modal has no focus trap, Escape, or focus restore.
- [ ] **BUG-008** the handoff device list is fetched once and never refreshed.
- [ ] **BUG-009** the mini player never recovers from a failed artwork load.
- [ ] **BUG-018** the service worker's scope excludes every request its fetch handler serves.
- [ ] **BUG-019** cache-first HTML breaks installed PWAs after a rebuild.
- [ ] **BUG-024** clipboard copy reports success even when the copy failed.
- [ ] **BUG-028** geo calibration is an O(n²) render and memory loop.
- [ ] **BUG-029** the BLE advertised name is never set; `stop()` never stops watching.
- [ ] **BUG-030** music-search responses can arrive out of order and overwrite newer results.
- [ ] **BUG-031** "Toggle subtitles" disables them; "Cycle audio" selects track 1.
- [ ] **BUG-033** `handleVideoCommand` returns HTTP 200 "ok" even when the command failed.
- [ ] **BUG-034** IDE "Step Out", "Stop" and "Restart" all send F5.
- [ ] **BUG-035** the terminal reconnects forever every 2 s and floods `[disconnected]`.
- [ ] **BUG-036** "Refresh" in the nav menu silently kills an active audio broadcast.
- [ ] **BUG-037** the LRC parser rejects single-digit minutes, mis-parses multi-timestamp lines.
- [ ] **BUG-038** `triggerCommand`/`seekTo`/`setVolume`/`setBrightness` never check the response.
      *(partially done: `triggerCommand` only)*
- [ ] **BUG-039** auto-focus yanks the deck to Home for any unrecognised window.
- [ ] **BUG-040** a capability-fetch failure hides every capability-gated card, no retry.
- [ ] **BUG-042** art theming silently fails for any art host without CORS, and sticks.
      *(partially done: accent contrast clamp only)*
- [ ] **BUG-044** `speed_*` commands ignore the player and always type into the focused window.
- [ ] **SUS-001** file-drop and Scenes features are entirely unwired (uncommitted WIP).
- [ ] **SUS-006..020** remaining suspected-bug items in §6.

## 6. Accessibility (21 findings)

- [ ] **A11Y-01** bottom nav / FAB not keyboard reachable with a visible focus ring.
- [ ] **A11Y-02/03** the seek slider has no `aria-label` / `aria-valuetext`; two nameless
      range inputs coexist in the DOM.
- [ ] **A11Y-04** the carousel arrows have no accessible name.
- [ ] **A11Y-05** the lyrics modal has no focus trap, Escape, or focus restore.
- [ ] **A11Y-06..21** `div role="button"` used instead of real buttons, missing labels on
      icon-only controls, no `aria-live` on the status banner, no `prefers-reduced-motion`,
      no global `:focus-visible` ring, contrast on dim text.

## 7. Performance (42 findings)

- [ ] **PERF-01/38** ~15 avoidable `playerctl` spawns per 500 ms tick.
- [ ] **PERF-04/05/16/17/23** deck bodies are not mounted lazily; the Video deck's 1 Hz poll
      and two 5 Hz ping intervals run even when their deck is closed; no `document.hidden`
      guard on the ping polls.
- [ ] **PERF-06/10** `lyricsCache` unbounded; duplicated lyric lookups.
- [ ] **PERF-25/26** no gzip/brotli on either listener; the SSE payload is not delta-encoded.
- [ ] **PERF-30/31** audio accumulator unbounded while suspended; 512-frame queue.
      *(done in the audio commit)*
- [ ] **PERF-37** `resolveArtURL`'s single-entry cache re-base64s a file every 500 ms.
- [ ] Single 625 kB bundle, no code splitting.

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

- [ ] **§8.3** the Media Browser deck never says where "Play/Pause" will be sent; 9 px key
      hints; current speed never shown; the "No media player detected" fallback never fires.
- [ ] **§8.4** the Video deck never renders `subtitles[]` / `audio_tracks[]`; aspect/speed pills
      at 27 px; ten pills mixing concepts without explanation.
- [ ] **§8.5** the IDE deck has no result surface and runs in the dashboard's CWD, not the
      focused project's.
- [ ] **§8.6** the terminal's `rebuild` button overwrites the binary with no confirmation.
- [ ] **§8.8** the clipboard card has no label, no `role="status"`, no size cap.
- [ ] **§8.10** the geo canvas has no `devicePixelRatio` scaling; no recording cap or auto-save;
      delete fires on `pointerDown` with no confirm.
- [ ] **§8.11** the BLE meter shows 62% green before any scan; unmounting stops advertising
      for every other client.
- [ ] **§8.15** the Media Streamer page uses `location.reload()`; 28 px exit button.
- [ ] **UX-29** no freshness indicator anywhere; a stale value looks current.
- [ ] **UX-31** the two PWAs share icons; `background.html` lacks the iOS meta tags.
- [ ] **§16** the 15 product/UX improvement proposals.

## 9. UI overhaul

Complete visual redesign: new design tokens, theme, and layout across every component.

- [ ] New design system: colour tokens, spacing scale, radii, shadows, typography.
- [ ] New theme (light + dark), replacing the current ad-hoc palette.
- [ ] Component-by-component restyle: deck shell, cards, nav, modals, sliders, buttons.
- [ ] Motion system with `prefers-reduced-motion` respected.
- [ ] Full `focus-visible` ring across every interactive element.

## 10. Tests, tooling, dead code

- [ ] **TEST-01..24** the audit's specified test cases; no CI, no frontend test runner.
- [ ] Delete the 892 lines of dead frontend code (12.5%), including two divergent lock
      screens, a second BLE implementation, and `SysStatsBar.tsx`.
- [ ] Extract shared `<VolumeSlider>` / `<BrightnessSlider>`.
- [ ] `gofmt -l` clean (8 files), `go vet` clean (3 `unsafe.Pointer` warnings).
- [ ] Add CI: `go vet`, `gofmt -l`, `go test -race ./...`, `npm ci`, `npm run build`, tests.
- [ ] Ship `tab-dashboard.service` in-repo and correct the README.
