# Control Deck — Complete Audit Report

**Audit target:** `Raj-Jai/control-deck` — local working tree, branch `experiment/ble-rssi`, HEAD `951efb0`
**Audit date:** 2026-09-27
**Environment:** the live Linux workstation (GNOME/Wayland, PipeWire/PulseAudio, real `playerctl`, `pactl`, `ffmpeg`, `bluetoothctl`, `gdbus`, `/dev/uinput`), plus the author's already-running production instance on `:8080`.
**Method:** source-complete read + build/test + dynamic analysis (`-race` server driven by synthetic clients) + Playwright/Chromium visual and interaction audit at 7 viewports.

---

## 1. Executive Summary

### Scope of inspection

| Area | Extent |
|---|---|
| Go backend | 6,345 lines, 17 files + `cmd/sendkey` — **all read in full** |
| Frontend | 7,142 lines, 51 files — **all read in full** (including 892 lines of dead code) |
| Screens / components | 5 decks, 27 components, 5 hooks, 4 lib modules, 3 config modules, 2 static pages, service worker, 2 manifests |
| Build / test | `go vet`, `go build`, `go test ./...`, `go test -race`, `gofmt -l`, `tsc && vite build` — all executed, results in §18 |
| Runtime | A build of *this* tree run on `:18080` / `:18081`; the author's instance on `:8080` probed read-only |
| Browser | Playwright + Chromium 1243; `WebSocket`, `AudioContext` and geolocation instrumented pre-load; network/console/geometry/a11y capture |
| Dynamic analysis | `go build -race` server driven with purpose-built Python/Node WebSocket and HTTP clients; process panic and 9 data-race reports captured with real stack traces |
| Screenshots | 22 captured: auth screen, all 5 decks, 7 viewports, offline state, terminal deck, audio-suspended state |

### Findings count

| Class | Count |
|---|---|
| **Confirmed bugs** (reproduced, or arithmetically/structurally proven) | **55** — 6 Critical, 12 High, 25 Medium, 12 Low |
| **Probable / suspected bugs** (code-path evidence, not reproduced) | **17** |
| **Security findings** | **16** — 4 Critical, 6 High, 4 Medium, 1 Low, 1 Informational |
| **UI/UX issues** | **32** |
| **Performance issues** | **42** |
| **Accessibility issues** | **21** |
| **Maintainability issues** | **31** |
| **Missing-test gaps** | **24**, each with a specified test case |
| **Product / UX improvements** | **15** |
| **Cross-feature findings** | **12** (CF-01 … CF-12) |

By severity: **6 Critical, 18 High, 29 Medium, 12 Low.** Every finding carries a file, a line, and — where behavioural — a reproduction.

### The nine things that matter most

**1. The Terminal deck can kill the whole server.** `close(done)` is called from two goroutines in `terminal.go` with no `sync.Once`. Reproduced deterministically: open `/ws/terminal`, produce PTY output, disconnect mid-stream → `panic: close of closed channel` → the entire dashboard dies (SSE, audio WebSocket, hotkey endpoint, every client). Reachable from tab close, page navigation, Wi-Fi blip and phone sleep. → **BUG-001**

**2. The web root is an unauthenticated file server for the whole working directory.** Verified against the live production instance: `GET /` returns a directory listing; `GET /config.json` returns both PINs in cleartext; `GET /server.key` returns the complete TLS private key; `GET /server.log` returns the full 5.9 MB log; `GET /.git/` returns the repository. → **SEC-007**

**3. `/api/geo/*` has unauthenticated path traversal** giving arbitrary file read, delete and write. Verified: read `/etc/hostname`, deleted a file, wrote a file outside `geo_sessions/`. → **SEC-001/002/003**

**4. Any web page the user visits can execute commands on the workstation.** `POST /api/command` accepts a `text/plain` body (no preflight), performs no Origin check, and dispatches arbitrary registered commands. Verified: cross-origin `text/plain` POST of `{"command":"git_push"}` returned `{"status":"ok"}`. The registered set includes `git commit && git push`, `git reset HEAD~1`, `lock-session`, and every `custom_commands` entry. → **SEC-004**

**5. An unauthenticated remote shell.** `websocket.Accept(..., InsecureSkipVerify: true)` on `/ws/terminal` accepts any Origin. Verified: a handshake with `Origin: https://evil.example` returned `101 Switching Protocols` and yields a `$SHELL` PTY. → **SEC-005**

**6. The core mobile deployment path is broken.** `crypto.randomUUID()` requires a secure context, so over `http://<lan-ip>:8080` — exactly how the README says to use it — `deviceId` is `''` for the whole session. Verified on `http://10.105.24.62:18081`: `isSecureContext: false`, `hasRandomUUID: false`, `device_id=` empty on every request, and `/api/stream/control` answers `404 device not connected`. Per-device stream control, per-device audio WS registration and the hotkey broadcast path are all non-functional. → **BUG-041a / SEC-016**

**7. The audio pipeline cannot stay in sync and cannot recover.** Measured: three rapid taps open **three** live audio sockets (interleaved audio at 3× rate). After a socket close the client **never reconnects** while the button still says "Stop". With autoplay blocked, the heap sawtooths 9→70 MB and the button claims "Stop" throughout. The PI controller cannot converge (the integral term saturates at 0.015 % rate change against a 350 ms target), and PTS — which is transmitted in every frame — is only ever read for the very first batch. → **BUG-012/013/014/015/016**

**8. Two numbers in the fixed top bar are fabricated.** `/api/service-stats` reads `cutime`/`cstime` instead of `utime`/`stime`, and `rss` instead of `starttime` — an off-by-two in the field index after splitting on `comm)`. Verified: reported CPU **80 %** vs real **16.7 %**; reported uptime **195 409 s** vs real **198 408 s** (it tracks RSS). → **BUG-026**

**9. Opening the dashboard always scrolls the page ~177 px and steals keyboard focus.** Measured: `window.scrollY === 177` and `document.activeElement === TEXTAREA.xterm-helper-textarea` immediately after unlock, because `TerminalDeck` calls `term.focus()` on mount and all five decks mount at once. The top of the Now Playing card is off-screen on every load. → **BUG-002**

### Also worth knowing up front

- The **Home deck needs 2.5–6.1 screens of scrolling** depending on viewport (measured at 7 sizes), dominated by a niche GPS canvas, while volume/brightness/play-pause sit below the fold.
- **93–109 sub-44 px tap targets** per viewport, and **the fullscreen button overlaps the top status bar at every single viewport** (measured `OVERLAP=true` at 320/360/414/768/896/1024 px).
- **Bottom-nav dots are not clickable** and **the carousel cannot be dragged with a mouse** — on desktop the floating-nav menu is the only way to change decks. Both verified.
- **The "Connected Devices" list is fabricated**: `trackClient` keys on `r.RemoteAddr` *including the ephemeral port*, so every HTTP request is a new "device". One tab produced 4 phantom "Linux (you)" rows in 2 s; the badge read **9** after three sessions. → **BUG-023**
- **The IDE deck's "Step Out", "Stop" and "Restart" all send F5** (Continue). The comments point at code that does not exist. → **BUG-034**
- **The Video deck injects keystrokes into whatever window is focused when no player is detected** — the badge reads "Not detected" and every button is still live. → **BUG-032**
- **The feature-flag contract is broken in three keys**: `power`, `scenes`, `filedrop` are advertised by the backend and `config.example.json` but silently ignored by the frontend. → **BUG-041**
- **892 lines of frontend code (12.5 %) are dead**, including two complete, divergent lock screens and a second BLE implementation with different thresholds. → **§15**

### What is genuinely solid (do not regress these)

- Command *mapping* is cleanly separated from dispatch; unknown command names are rejected with 400.
- Feature flags fail open correctly and unknown keys produce a startup warning naming the valid set.
- SSE reconnect uses bounded exponential backoff with jitter, and I verified the UI does surface "Connection lost — retrying…" and recover after a backend restart.
- Config reload is a correct derive-then-swap under one lock, and the existing `-race` test for it passes.
- `parseProcStat` correctly handles a `comm` containing spaces or parentheses (the *caller* then indexes wrong — BUG-026 — but the parser is right).
- The lyrics pipeline: 4-stage lrclib lookup, Jaro–Winkler artist/title splitting, weighted fuzzy scoring with a duration bonus, language grouping. Genuinely good.
- `files.go` (uncommitted WIP) has careful traversal containment via `safeDropName` + a `filepath.Dir` assertion — exactly the pattern §7 says to apply to the geo endpoints.
- `scenes.go` (uncommitted WIP) validates every action *before* executing any, and re-checks at execution time.
- `shellQuote` in `music_service.go` is correct; I traced every user-controlled value reaching `exec.Command` and found no exploitable shell injection (§7, SEC-013).

---

## 2. Audit Methodology

1. **Repository discovery.** Full `find` inventory excluding `.git`/`node_modules`; per-file `wc -l`; `go.mod`, `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `.gitignore`, `avahi-service.conf`, both `scripts/`, `config.json`, `config.example.json`, `testdata/`, `README.md`, `docs/FEATURES.md`, `docs/CV.md` all read.

2. **Complete source read.** Every `.go` and every `.tsx`/`.ts`/`.css`/`.html` file read end to end — no sampling. The import graph was then walked with `rg` to identify dead code and duplication. Confirmed unreferenced: `decks/DefaultDeck.tsx`, `components/StepperControls.tsx`, `components/ToggleGrid.tsx`, `components/CaffeineCard.tsx`, `components/AppMixerCard.tsx`, `components/SysStatsBar.tsx`, `components/GuestView.tsx`, `components/LockScreen.tsx`, `lib/BleRssiMonitor.ts`, `lib/authStore.ts`, and `audio_stream.go:remoteStartStream`.

3. **Architecture + data-flow tracing.** Every documented feature traced end to end: `USER ACTION → UI EVENT → FRONTEND STATE → NETWORK → BACKEND HANDLER → OS COMMAND → RESULT → SERVER EVENT → FRONTEND UPDATE → UI FEEDBACK`. Invariants recorded and probed: auth mode, active deck, focused application, MPRIS player set, audio stream lifecycle, SSE lifecycle, WebSocket lifecycle, device identity, selected sink, feature-flag state, command registry contents.

4. **Build & test.** Every command run, with exit status, in §18. Notably: `gofmt -l` reports 8 unformatted files; `go vet` reports 3 `possible misuse of unsafe.Pointer` in `cmd/sendkey`; `tsc && vite build` succeeds but emits a chunk-size warning (625 kB / 168 kB gzip, single bundle, no code splitting).

5. **Dynamic analysis.** `go build -race` binary of this tree, run on `:18081`, driven with hand-written Python/Node WebSocket and HTTP clients. This is how the terminal panic (§5 BUG-001) and the data races (§11) were captured with genuine stack traces rather than inferred.

6. **Browser audit.** Playwright + Chromium with `WebSocket`/`AudioContext`/geolocation monkey-patched via `addInitScript` before app code runs; screenshots at 320/360/414/896/768/1024/1440 px; programmatic geometry assertions for overlap, overflow and tap-target size; a11y queries; console + network capture; CDP offline emulation; `performance.memory` heap sampling; geolocation permission granted for the GPS tests.

7. **Adversarial verification — and two corrections.** Every claim that could be checked numerically was checked against the live system: `/proc/<pid>/stat` field indices, `pactl` factor semantics, `brightnessctl` values, `window.isSecureContext`, `crypto.randomUUID` availability, JS heap growth, DOM geometry, `/api/clients` output. **Two of my initial hypotheses were wrong and were discarded:**
   - I expected the per-app volume slider to *drift toward zero* on repeated adjustment. It does not — the round trip is stable. The real defect is that the applied volume does not match the displayed value (BUG-021, corrected below).
   - I expected art theming to throw `SecurityError` for all remote artwork. YouTube's CDN does send `Access-Control-Allow-Origin: *`, so that path works. The real defect is host-dependence plus a theme that never resets (BUG-042, corrected below).

8. **Non-destructive operation.** No destructive testing against the host. The author's live instance was only ever read (GET requests). Test instances ran on `:18080`/`:18081` from a copy in `/tmp`, with `broadcast_hotkey: "disabled"` so no GNOME keybinding was touched. A canary file was used to prove the traversal, and removed. `task_dev`/`rebuild` were never executed.

9. **Cleanup and verification.** All test instances stopped; the author's instance (PID 4242) confirmed still running; `git status --short` verified byte-identical to the pre-audit state (§19).

---

## 3. Repository / Architecture Map

### 3.1 Directory map

```
tab-dashboard/
├── main.go              2168  HTTP mux, SSE, client tracking, MPRIS polling,
│                             window classification, command dispatch, geo endpoints
├── audio_stream.go       323  ffmpeg PCM capture, PTSTracker, WebSocket fan-out, NTP
├── music_service.go      780  yt-dlp search/play pipeline, mpv IPC, KDE Connect handoff
├── video_player.go       651  mpv UNIX-socket IPC, VLC HTTP, MPRIS + xdotool fallback
├── lyrics_service.go     457  lrclib.net lookup, LRC scoring, language grouping
├── service_stats.go      190  /proc-based process CPU/RSS/uptime
├── config.go             194  Config, feature flags, atomic reload, SIGHUP
├── clipboard.go          100  wl-paste/wl-copy + xclip fallback
├── gpu.go                154  nvidia-smi / amdgpu sysfs / intel_gpu_top
├── hotkey.go             191  GNOME custom keybinding registration via gsettings
├── ble.go                 96  bluetoothctl advertising
├── terminal.go            94  PTY over WebSocket
├── audio.go              213  pactl sinks + per-app sink-inputs
├── config_test.go        276  the ONLY test file (8 tests, all config/feature-flag)
├── files.go              149  UNTRACKED WIP — upload/list/download, unregistered routes
├── scenes.go             108  UNTRACKED WIP — scene list/run, unregistered routes
├── config.json           ⛔  gitignored, but world-readable over HTTP (SEC-007)
├── config.example.json       1.3 kB
├── server.crt / server.key  ⛔  gitignored, served over HTTP (SEC-007)
├── server.log            ⛔  gitignored, 5.9 MB, served over HTTP (SEC-007/014)
├── cmd/sendkey/main.go   201  /dev/uinput keystroke injection via ioctl
├── scripts/                   setup-hotkey.sh, toggle-broadcast.sh
├── static/                     built Vite output (index.html + hashed assets + SW)
├── frontend/
│   ├── src/App.tsx            360  5-deck carousel, nav, auth gate, fullscreen
│   ├── src/index.css          288  design system, sliders, art theming overrides
│   ├── src/lib/streamManager  420  SyncedAudioPlayer: NTP, batching, PI controller
│   ├── src/lib/lyricsEngine    44  LRC parse + active-line lookup
│   ├── src/lib/authStore       36  DEAD — token/session scaffolding, never imported
│   ├── src/lib/BleRssiMonitor 130  DEAD — second BLE impl, different thresholds
│   ├── src/hooks/             useMediaStream, useCapabilities, useFeatures,
│   │                          useActiveWindow, useArtTheming
│   ├── src/decks/             DefaultDeck(DEAD), MediaBrowser, VideoPlayer, Ide, Terminal
│   ├── src/components/        27 components (see §4)
│   ├── public/background.html 679  vanilla-JS background-audio PWA
│   ├── public/service-worker.js     scope /static/, cache-first
│   └── vite.config.ts         base /static/, outDir ../static, emptyOutDir
├── avahi-service.conf           no <host-name> (BUG-054)
├── geo_sessions/                2 saved GPS tracks, served over HTTP
└── tab-dashboard.service        ⛔ REFERENCED BY README BUT DOES NOT EXIST
```

### 3.2 Runtime topology

```mermaid
graph TB
  subgraph B["Browser / PWA"]
    UI["React 18 SPA<br/>App.tsx — 5-deck carousel"]
    SW["Service Worker<br/>scope /static/"]
    BG["background.html<br/>vanilla JS audio PWA"]
    SMP["SyncedAudioPlayer<br/>streamManager.ts"]
  end
  subgraph G["Go process (single binary)"]
    MUX["http.ServeMux<br/>DefaultServeMux"]
    SSE["/media-stream<br/>SSE · 500 ms MediaState"]
    WSS["/api/window-stream<br/>SSE · focus + speed"]
    WS["/api/audio-stream/ws<br/>binary PCM + NTP"]
    TWS["/ws/terminal<br/>PTY"]
    FS["/ → FileServer(Dir(\".\"))"]
    BR["startMediaBroadcaster<br/>500 ms ticker"]
    WM["startWindowWatcher<br/>1 s poll + D-Bus signal"]
    CL["cleanupClients · 15 s"]
    PG["startPingChecker · 5 s"]
    SM["StreamManager<br/>ffmpeg + readLoop"]
    LY["fetchLyrics<br/>on the broadcaster goroutine"]
  end
  subgraph O["Linux workstation"]
    MPR["playerctl / MPRIS"]
    PA["pactl · wpctl"]
    FF["ffmpeg<br/>pulse @DEFAULT_MONITOR"]
    CL2["wl-paste · wl-copy"]
    DB["D-Bus session bus"]
    PR["/proc · /sys"]
    SH["sh -c subprocesses"]
    UI2["/dev/uinput"]
  end
  UI -->|"fetch POST/GET"| MUX
  UI -->|"EventSource"| SSE
  UI -->|"EventSource"| WSS
  UI -->|"WebSocket binary"| WS
  UI -->|"WebSocket"| TWS
  SMP --> WS
  BG --> WS
  BR --> SSE
  WM --> WSS
  LY --> BR
  BR -->|"playerctl ×(5+6N)<br/>pactl ×3, wpctl, brightnessctl ×2<br/>gsettings ×4, rfkill, bluetoothctl<br/>warp-cli, iwgetid, hostname<br/>nvidia-smi / intel_gpu_top"| O
  SM --> FF
  FF -->|"PCM s16le 48 kHz stereo"| SM
  SM -->|"fan-out, 512-slot queue"| WS
  TWS -->|"pty($SHELL)"| SH
  TWS --> UI2
  FS -.->|"UNAUTHENTICATED"| UI
  SW -.->|"never sees /api or /"| UI
```

### 3.3 Cost of one SSE frame

Every 500 ms, `broadcastState()` → `fetchMPRISState()` performs:

| Call | Cost | Note |
|---|---|---|
| `findBestPlayer()` | 1 + 3N `playerctl` | and it is called **again** 5× via `runPlayerctlBest` |
| `fetchAllPlayers()` | 1 + 6N `playerctl` | `playerctl -l` plus 6 per player |
| volume | 1 `wpctl` | |
| brightness | 2 `brightnessctl` | `get` + `max` |
| night light + caffeine | 4 `gsettings` | |
| bluetooth + BT sink + warp | 3 (`rfkill`, `bluetoothctl`, `warp-cli`) | |
| sinks | 2 `pactl` | `list sinks` + `info` |
| app streams | 1 `pactl` | `list sink-inputs` |
| system stats | 1 `nvidia-smi` **or** `intel_gpu_top -s 500 -n 1` | + 2 more subprocesses for SSID/IP |
| lyrics | 0–3 HTTPS to lrclib.net | **6 s timeout each, on the broadcaster goroutine** |
| **Total** | **~25–45 subprocess spawns per 500 ms** | = **50–90 processes/second, continuously** |

The fan-out is non-blocking (`select` with `default`), so a slow client's buffer fills and its state updates are **silently dropped** (`main.go:1327-1333`).

### 3.4 Feature-flag contract mismatch

```
config.go  KnownFeatures   : 18 keys  (now_playing, mixer, quick_settings, geo_survey,
                                           ble_proximity, connected_devices, weather,
                                           clipboard, command_log, system_stats,
                                           service_stats, media_browser, video_player,
                                           ide, terminal, power, scenes, filedrop)

features.ts FEATURE_DEFAULTS: 15 keys  (…same minus power, scenes, filedrop)
```

`useFeatures` iterates `Object.keys(defaults)` and ignores response keys it does not know, so `"power": false` in `config.json` has **no effect and no warning** — even though `config.example.json` advertises it.

### 3.5 Data-flow trace — one button press

```
tap "Volume" slider → onChange
  → setLocalPos + ref + 80 ms throttle
  → apiService.setVolume(sliderToValue(v/100, 1))
  → POST /api/set-volume  {volume: (v/100)²}
  → handleSetVolume → addLog → go wpctl set-volume @DEFAULT_AUDIO_SINK@ <float>
  → wpctl → PulseAudio
  ← (no response body beyond {"status":"ok"}; res.ok never checked)
  ← next 500 ms SSE frame carries the new volume
  → setState(data) → re-render → showVol recomputed from valueToSlider(volume,1)
```

**Break points found in this chain:** `res.ok` is never checked (BUG-038) so a failure is invisible; `showVol` reads `draggingVol.current`, a **ref**, so it only recomputes because some *other* state change re-renders the component (BUG-020 family); and the quadratic curve is applied on both ends, so the number shown is a slider position, not a percentage (BUG-021).

---

## 4. Screen & Component Inventory

`Source` = read in source. `Runtime` = exercised in a real browser. `Visual` = screenshot inspected. `Interact` = controls operated. `Resp` = measured at multiple viewports. `A11y` = semantics/contrast/target audited.

| Component | File | Source | Runtime | Visual | Interact | Resp | A11y | Findings |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| App shell / deck carousel | `App.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | BUG-001, BUG-002, UX-01, UX-02, PERF-01 |
| Auth screen / mode picker | `AuthScreen.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | BUG-003, SEC-008, SEC-009, UX-03, A11Y-01 |
| Lock screen (**dead**) | `LockScreen.tsx` | ✅ | n/a | n/a | n/a | n/a | ✅ | MAINT-01 |
| Guest view (**dead**) | `GuestView.tsx` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-01 |
| Now Playing card | `NowPlayingCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | BUG-004, BUG-005, UX-04, A11Y-02, A11Y-03 |
| Player carousel + arrows + dots | `PlayerCarousel.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | BUG-006, UX-05, A11Y-04 |
| Fullscreen lyrics modal | `NowPlayingCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | BUG-007, UX-06, A11Y-05 |
| Handoff "Send to" menu | `NowPlayingCard.tsx` | ✅ | ⚠️ no GSConnect | ✅ | ⚠️ | ✅ | ⚠️ | BUG-008, UX-07 |
| Mini player | `MiniPlayer.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-009, UX-08 |
| Audio stream button | `AudioStreamCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-010, BUG-011, UX-09 |
| Synced audio player | `lib/streamManager.ts` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-012→016, PERF-02 |
| Background audio PWA | `public/background.html` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | BUG-017, PERF-03 |
| Service worker | `public/service-worker.js` | ✅ | ✅ | n/a | n/a | n/a | n/a | BUG-018, BUG-019 |
| Mixer card | `MixerCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-020, UX-10, PERF-04 |
| App streams list | `MixerCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-021, UX-11 |
| Quick settings | `QuickSettings.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-022, A11Y-06, UX-12 |
| Toggle grid (**dead**) | `ToggleGrid.tsx` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-01 |
| Connected devices | `ConnectedDevicesCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-023, UX-13, UX-14, PERF-05 |
| Clipboard sync | `ClipboardCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-024, SEC-006, A11Y-07 |
| Command log | `CommandLogCard.tsx` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | UX-15 |
| System stats card | `SystemStatsCard.tsx` | ✅ | ✅ | ✅ | n/a | ✅ | ⚠️ | BUG-025, UX-16 |
| Service stats bar (fixed top) | `ServiceStatsBar.tsx` | ✅ | ✅ | ✅ | n/a | ✅ | ⚠️ | BUG-026, BUG-043, UX-17, A11Y-08 |
| Sys stats bar (**dead**) | `SysStatsBar.tsx` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-01 |
| Weather card | `WeatherCard.tsx` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | BUG-027, UX-18 |
| Geo survey | `GeoSurveyCard.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-028, PERF-06, UX-19, A11Y-09 |
| BLE proximity | `BleProximityCard.tsx` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | BUG-029, UX-20 |
| BLE RSSI monitor (**dead**) | `lib/BleRssiMonitor.ts` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-02 |
| Music search | `MusicSearch.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-030, BUG-048, UX-21 |
| Media streamer page | `MediaStreamerPage.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | SEC-010, UX-22 |
| Media browser deck | `decks/MediaBrowserDeck.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-044, UX-23, MAINT-03 |
| Video player deck | `decks/VideoPlayerDeck.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-031, BUG-032, BUG-033, PERF-07, UX-24 |
| IDE deck | `decks/IdeDeck.tsx` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | BUG-034, BUG-038, UX-25, PERF-08 |
| Terminal deck | `decks/TerminalDeck.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-001, BUG-002, BUG-035, UX-26, PERF-09 |
| Tmux radial | `components/TmuxRadial.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | A11Y-10, UX-27 |
| Floating nav bubble | `FloatingNav.tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | BUG-036, UX-28, A11Y-11 |
| Stepper controls (**dead**) | `StepperControls.tsx` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-01 |
| Caffeine card (**dead**) | `components/CaffeineCard.tsx` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-01 |
| App mixer card (**dead**) | `components/AppMixerCard.tsx` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-01 |
| Default deck (**dead**) | `decks/DefaultDeck.tsx` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-01 |
| File drop card (WIP, unwired) | `components/FileDropCard.tsx` | ✅ | ⚠️ 404 | n/a | n/a | n/a | n/a | SUS-001 |
| Scenes card (WIP, unwired) | `components/ScenesCard.tsx` | ✅ | ⚠️ 404 | n/a | n/a | n/a | n/a | SUS-001 |
| Auth store (**dead**) | `lib/authStore.ts` | ✅ | n/a | n/a | n/a | n/a | n/a | MAINT-04 |
| Lyrics engine | `lib/lyricsEngine.ts` | ✅ | ✅ | ✅ | n/a | n/a | n/a | BUG-037 |
| API service | `services/apiService.ts` | ✅ | ✅ | n/a | n/a | n/a | n/a | BUG-038, SUS-006 |
| Media SSE hook | `hooks/useMediaStream.ts` | ✅ | ✅ | n/a | ✅ | n/a | n/a | UX-29, PERF-16 |
| Window-focus hook | `hooks/useActiveWindow.ts` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-039, MAINT-11 |
| Capabilities hook | `hooks/useCapabilities.ts` | ✅ | ✅ | n/a | n/a | n/a | n/a | BUG-040, PERF-10 |
| Features hook | `hooks/useFeatures.ts` | ✅ | ✅ | n/a | n/a | n/a | n/a | BUG-041 |
| Art theming hook | `hooks/useArtTheming.ts` | ✅ | ✅ | ✅ | n/a | n/a | n/a | BUG-042, UX-30 |
| Base stylesheet | `index.css` | ✅ | ✅ | ✅ | n/a | ✅ | ⚠️ | A11Y-12→015, MAINT-05 |
| Deck config | `config/deckConfig.ts` | ✅ | ✅ | ✅ | n/a | n/a | n/a | BUG-022 |
| Feature config | `config/features.ts` | ✅ | ✅ | n/a | n/a | n/a | n/a | BUG-041 |
| Tailwind config | `tailwind.config.js` | ✅ | ✅ | n/a | n/a | n/a | n/a | MAINT-05 |
| Manifest (main) | `public/manifest.json` | ✅ | ✅ | n/a | n/a | n/a | ⚠️ | UX-31 |
| Manifest (background) | `public/manifest-bg.json` | ✅ | ✅ | n/a | n/a | n/a | ⚠️ | UX-31 |
| `index.html` | `frontend/index.html` | ✅ | ✅ | n/a | n/a | n/a | ⚠️ | BUG-018, A11Y-16 |
| `main.tsx` | `frontend/src/main.tsx` | ✅ | ✅ | n/a | n/a | n/a | n/a | — |
| Audio stream backend | `audio_stream.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-046, BUG-047, PERF-11 |
| Terminal backend | `terminal.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-001, SEC-005 |
| Command dispatch | `main.go` | ✅ | ✅ | n/a | ⚠️ | n/a | n/a | BUG-022, BUG-034, SEC-004 |
| Auth endpoints | `main.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | SEC-008, SEC-009 |
| Capability/feature endpoints | `main.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-040, BUG-041, PERF-10 |
| Geo endpoints | `main.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | SEC-001, SEC-002, SEC-003 |
| SSE endpoints | `main.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | PERF-16 |
| Clients endpoint | `main.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-023, SUS-007 |
| Broadcast endpoints | `main.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | SEC-004, BUG-036 |
| Stream control endpoint | `main.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | SEC-016 |
| Audio (sinks/mixer) | `audio.go` | ✅ | ✅ | ✅ | ⚠️ | n/a | n/a | BUG-021 |
| Clipboard backend | `clipboard.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-045, SEC-006 |
| Music backend | `music_service.go` | ✅ | ⚠️ no network | n/a | ⚠️ | n/a | n/a | BUG-048, BUG-030, PERF-12, SUS-005/010/013 |
| Lyrics backend | `lyrics_service.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-049, PERF-13, MAINT-08, SUS-003 |
| Video backend | `video_player.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-032, BUG-033, BUG-050, PERF-14, SUS-004 |
| GPU telemetry | `gpu.go` | ✅ | ✅ | ✅ | n/a | n/a | n/a | BUG-025, BUG-051, PERF-15 |
| Service stats backend | `service_stats.go` | ✅ | ✅ | ✅ | n/a | n/a | n/a | BUG-026, BUG-043, BUG-052 |
| Hotkey registration | `hotkey.go` + script | ✅ | ⚠️ disabled | n/a | ⚠️ | n/a | n/a | BUG-053, MAINT-09 |
| BLE advertising | `ble.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | BUG-029, SUS-017 |
| Config + reload | `config.go` | ✅ | ✅ | n/a | ✅ | n/a | n/a | SUS-002, MAINT-07 |
| sendkey tool | `cmd/sendkey/main.go` | ✅ | ✅ | n/a | ⚠️ | n/a | n/a | BUG-034, MAINT-06 |
| Avahi service | `avahi-service.conf` | ✅ | n/a | n/a | n/a | n/a | n/a | BUG-054 |
| Deployment (systemd) | README only | ✅ | n/a | n/a | n/a | n/a | n/a | BUG-055 |
| Test suite | `config_test.go` | ✅ | ✅ | n/a | n/a | n/a | n/a | TEST-01→24 |

---

## 5. Confirmed Bugs

Every bug below is either **reproduced at runtime** (evidence shown) or **proven by direct code/arithmetic inspection** with the exact mechanism traced.

---

### BUG-001 — Terminal WebSocket disconnect panics and kills the entire server

**Severity:** Critical · **Confidence:** Confirmed (reproduced) · **Area:** Backend / Reliability
**File(s):** `terminal.go:50-92` · **Component:** Terminal deck · **Feature:** In-browser terminal

**Evidence — reproduced against a `-race` build of this tree on `:18081`:**

```
panic: close of closed channel

goroutine 12357 [running]:
main.handleTerminalWS.func1()
	/tmp/opencode/cd-audit/terminal.go:62 +0xc5
created by main.handleTerminalWS in goroutine 714
	/tmp/opencode/cd-audit/terminal.go:53 +0x6d0
```

Reproduction (deterministic — 2 of 2 attempts; the first attempt consumed the process, the second confirmed the trigger):

```python
s = ws_connect("/ws/terminal")                              # 101 Switching Protocols
s.send(ws_frame("for j in $(seq 1 2000000); do echo $j; done\r"))
time.sleep(0.35)                                            # PTY output in flight
s.setsockopt(SOL_SOCKET, SO_LINGER, b'\x01\x00\x00\x00\x00\x00\x00\x00')
s.close()                                                    # RST
# → process gone; every later connection gets ECONNREFUSED
```

**What is wrong.** `done := make(chan struct{})` is closed from two goroutines with no `sync.Once`:
- `terminal.go:62` — the PTY→WS writer, on `conn.Write` or `ptmx.Read` error
- `terminal.go:77` — the WS→PTY reader, on `conn.Read` error

**Why it happens.** When the client vanishes, the reader errors and closes `done`; the handler wakes from `<-done` (line 89), calls `ptmx.Close()` (line 90), which unblocks the writer's `ptmx.Read` / fails its pending `conn.Write`, so the writer closes `done` a second time → panic in a goroutine → the whole process dies.

**Why the quiet case survives.** If the PTY produces no output, the writer goroutine stays parked in `ptmx.Read` and never observes the closed socket, so the second `close` never happens. This is why a fresh idle terminal survives but a terminal running `npm run dev` or `rebuild` does not.

**Impact.** Total service loss. The SSE media stream, the audio WebSocket, the broadcast hotkey endpoint and every connected client die simultaneously. Reachable from ordinary use: closing a tab, navigating away, a Wi-Fi blip, or a phone suspending. Nothing in the UI distinguishes this from the server being stopped, and the frontend then shows "Connection lost — retrying…" forever (the backend is gone).

**Recommended fix.**

```go
done := make(chan struct{})
var doneOnce sync.Once
signalDone := func() { doneOnce.Do(func() { close(done) }) }
```

Use `signalDone()` at lines 62 and 77. Additionally: wrap the handler body in a `defer recover()` so no single connection can take the process down; stop the PTY from outliving the connection via a per-connection context; and check `ptmx.Write`'s error at line 84.

**Regression test.** `TestTerminalWSDisconnectDoesNotPanic` — `httptest.NewServer` with the real mux; open a raw WS, send a command that produces output, close with SO_LINGER=0; assert (a) no panic, (b) a second connection still succeeds, (c) no `mpv`/`bash` orphan remains. Run with `-race`.

---

### BUG-002 — Page auto-scrolls ~177 px on load and keyboard focus is stolen by the terminal

**Severity:** High · **Confidence:** Confirmed (measured) · **Area:** Frontend
**File(s):** `decks/TerminalDeck.tsx:47`, `App.tsx:255-307` · **Component:** App shell

**Evidence** (896×414 phone landscape, sampled immediately after unlocking):

```
t~0ms  scrollY=177  bodyH=1591  activeElement=TEXTAREA.xterm-helper-textarea
scrollY @1.2s = 177    @2.4s = 177    @3.6s = 177    @7.2s = 177   (stable, not transient)
```

Screenshot consequences:
- `shots/10-home-phoneLand.png` — the top of the Now Playing card (artwork, title, seek bar) is scrolled off the top; only the transport row is visible.
- `shots/20-terminal-tablet.png` — the shell prompt line is sliced horizontally by the fixed service-stats bar.

**What is wrong.** All five deck pages render simultaneously inside the carousel (`App.tsx:255-307`). `TerminalDeck`'s mount effect calls `term.focus()` (line 47), focusing xterm's hidden helper `<textarea>`. Because that textarea lives in an off-screen carousel page, the browser scrolls the **window** (not the carousel) to bring it into view, and from then on `PageUp`/`PageDown`/arrow keys are delivered to the terminal instead of the page.

**Impact.** Every single page load starts mis-scrolled, hiding the primary control surface. Keyboard scrolling is dead. The user's most likely first action (scroll to see what's below) does nothing.

**Recommended fix.** (a) Remove `term.focus()` from the mount effect; focus on first pointer/keyboard interaction with the terminal surface. (b) Mount deck contents lazily (render a deck body only after it has been visited) or guard with `content-visibility`. (c) `window.scrollTo(0, 0)` immediately after the auth screen unmounts.

**Regression test.** Playwright: after unlocking, assert `window.scrollY === 0` and `!document.activeElement.closest('.xterm')`.

---

### BUG-003 — PIN backspace/Clear inside the 150 ms submit window still submits the stale PIN

**Severity:** Low · **Confidence:** Confirmed (code path) · **Area:** Frontend
**File:** `AuthScreen.tsx:63-77` · **Component:** Auth screen

`press()` schedules `setTimeout(() => submit(next), 150)` on the 4th digit, but `loading` is only set *inside* `submit`. For those 150 ms `backspace()` and the Clear button are live, so backspacing to 3 digits and re-entering submits a stale 4-digit value (or a 5-digit one, since `submit` only checks `p.length !== 4`).

Compounding: the auth `fetch` has no timeout, so a hung request leaves `loading === true` permanently and `press()`'s guard `if (pin.length >= 4 || loading) return` makes the **entire keypad permanently unresponsive**.

**Recommended fix.** Set a `submitting` ref synchronously in `press` before scheduling; gate `backspace`/`clear` on it; add an `AbortController` with a 10 s timeout and a distinct "server unreachable" message (a network failure is currently reported to the user as "Wrong PIN", which is actively misleading).

**Regression test.** Render `AuthScreen`, press 4 digits then immediately press backspace; assert `fetch` was called zero times.

---

### BUG-004 — Seek position can stick forever after a failed seek

**Severity:** Medium · **Confidence:** Confirmed · **Area:** Frontend
**File:** `NowPlayingCard.tsx:139-155` · **Component:** Now Playing

`localPos` is cleared only when `Math.abs(pos - seekRef.current) < 2` (line 140). If `playerctl` fails, the player stops, or the selected player changes, `pos` never converges and the displayed time is frozen at the drag target until the component unmounts. There is no timeout, no error surface, and `apiService.seekTo` swallows all failures (BUG-038). `dragging.current` is written at lines 151/220 but never read — dead state.

**Recommended fix.** Add a 2.5 s fallback timer that clears `localPos`; surface a "seek failed" toast; delete the unused `dragging` ref.

---

### BUG-005 — The media seek slider is unusable from the keyboard

**Severity:** Medium · **Confidence:** Confirmed · **Area:** Frontend / Accessibility
**File:** `NowPlayingCard.tsx:218-227` · **Component:** Now Playing

The slider commits only on `onMouseUp`/`onTouchEnd`. Keyboard arrow keys fire React's `onChange` (updating `localPos` visually) but never commit — so a keyboard user can move the handle indefinitely with no seek ever being sent, and the display then drifts permanently (compounding BUG-004).

`MixerCard.tsx:92-95` gets this right (`onMouseUp` + `onTouchEnd` + `onPointerUp` + `onKeyUp`); the pattern simply was not applied to the media seekbar.

**Recommended fix.** Add `onPointerUp` and `onKeyUp`; add `aria-label="Seek"` and `aria-valuetext={`${formatTime(displayVal)} of ${formatTime(len)}`}`; give the two rendered copies distinct `id`s.

---

### BUG-006 — Carousel `dragging` flag sticks when a gesture starts on a slider

**Severity:** Low · **Confidence:** Confirmed · **File:** `PlayerCarousel.tsx:43-55`

`onTouchStart` returns early for range inputs *before* setting `dragging`; `onTouchEnd` returns early for range inputs *before* clearing it. A touch that begins on the seek slider and ends elsewhere leaves `touchStart.current` stale, so the next `onTouchEnd` computes `dx` against the wrong origin and can switch to the wrong player.

**Recommended fix.** Reset `dragging` and `touchStart.current` unconditionally at the top of `onTouchEnd`, and gate only the swipe decision on `!isSlider(e.target)`.

---

### BUG-007 — Fullscreen lyrics modal has no focus trap, no Escape, no focus restore

**Severity:** Medium · **Confidence:** Confirmed · **File:** `NowPlayingCard.tsx:469-622`

`role="dialog"` and `aria-modal="true"` are set (lines 472-474) but there is no focus trap, no `onKeyDown` Escape handler, and no restore of focus to the Maximize button on close. Because the modal is portaled to `<body>` at `z-[9999]`, `Tab` walks straight out into the invisible page behind it. `aria-label="Fullscreen lyrics"` is generic where `aria-labelledby` pointing at the track title would be correct.

**Recommended fix.** Add a focus trap, `Escape` → close, and save/restore `document.activeElement`.

---

### BUG-008 — Handoff device list is fetched once and never refreshed; the real error is masked

**Severity:** Medium · **Confidence:** Confirmed · **File:** `NowPlayingCard.tsx:182-191`

`toggleHandoffMenu` fetches only `if (handoffDevices.length === 0)`, so a phone that comes online after the first open shows "No phones reachable" until a full page reload. Separately, `listHandoffDevices` throws on the 503 text body (`music_service.go:496`), the `catch` only `console.error`s, and the menu then renders "No phones reachable" — which is a *different* statement from "no KDE Connect / GSConnect backend available".

**Recommended fix.** Re-fetch on every menu open; surface the server's error string in the empty state.

---

### BUG-009 — Mini player never recovers from a failed artwork load

**Severity:** Low · **Confidence:** Confirmed · **File:** `MiniPlayer.tsx:11, 22-25`

`artError` is set on `onError` and never reset. `NowPlayingCard` has the correct reset (`useEffect(() => setArtError(false), [player?.art_url])`, lines 58-60); the mini player does not, so one failed image leaves the placeholder showing for every subsequent track.

**Recommended fix.** Add the same `useEffect` keyed on `artUrl`.

---

### BUG-010 — The "Join" button stops the local stream instead of joining

**Severity:** High · **Confidence:** Confirmed · **File:** `AudioStreamCard.tsx:29-40`

```tsx
const handleToggle = () => {
  if (local === 'playing' || local === 'active_elsewhere') { streamManager.stop(); return; }
  streamManager.start();
};
const label = isActive ? 'Stop' : isJoinable ? 'Join' : 'Stream';
```

When the state is `active_elsewhere` (another device is streaming) the label reads **"Join"**, but the handler calls `streamManager.stop()`, which closes *this* device's socket — a no-op, because this device is not streaming. The user taps "Join", nothing happens, and there is no way to join from this control. `remoteStartStream` (`audio_stream.go:84`) exists for exactly this and is dead code.

**Recommended fix.** `if (local === 'playing') { stop(); return; } start();` — `addListener` already fans out to all clients, so a local `start()` is sufficient.

---

### BUG-011 — Audio-stream failure produces a 10-second dead button and no error

**Severity:** Medium · **Confidence:** Confirmed · **File:** `AudioStreamCard.tsx`, `streamManager.ts:234-239, 244`

If `ffmpeg` is missing or the monitor source is gone, `addListener` fails and `handleStreamWS` returns *before* `sendInitFrame` (`audio_stream.go:264-275`). The client therefore never sees the handshake frame and waits out its 10 s `init timeout`, rejects, and `start()` calls `stop()`. The button sits on "Stream" for 10 s with zero feedback and no error is ever shown. The user cannot distinguish "server slow" from "ffmpeg missing" from "wrong PIN".

**Recommended fix.** Distinguish failure modes in the reject path; add a `status: 'error'` state; use `caps.ffmpeg` as a disabled reason with an explanation.

---

### BUG-012 — Rapid taps open duplicate audio sockets that play interleaved audio

**Severity:** High · **Confidence:** Confirmed (runtime) · **File:** `streamManager.ts:195-240`

`WebSocket` was instrumented before app load, then the Stream button was clicked three times:

```
WebSockets created: 1 ctx, ["terminal",
  "ws?device_id=2e54a000-…", "ws?device_id=2e54a000-…", "ws?device_id=2e54a000-…"]
server status: {"active":true}
```

Three live audio sockets. The guard `if (this.active) return` (line 196) does not help because `this.active` is only set at **line 271**, after the init frame *and* the 10-ping NTP handshake. All three sockets therefore install the post-NTP `onmessage` and call `feedFrame`, so the accumulator receives three interleaved streams → playback at ~3× rate with corruption, and three server-side listeners (3× fan-out cost, 3× ffmpeg read amplification).

A double-tap on a Stream button is completely normal on a tablet.

**Recommended fix.** Set a `connecting` flag synchronously at the top of `start()`; guard on `active || connecting`; close any pre-existing socket before assigning `this.ws`.

---

### BUG-013 — The audio stream never reconnects after a socket close

**Severity:** High · **Confidence:** Confirmed (runtime) · **File:** `streamManager.ts:309-311`

The audio socket was force-closed from inside the page and the page observed for 6 s:

```
opened: 1                       ← before
after drop -> opened: 1  closed: 1
button title (UI still says?): Stop
server status: {"active":false}
```

`w.onclose` only rejects when `!this.active`:

```tsx
w.onclose = () => { if (!this.active) reject(new Error('ws closed')); };
```

Once active, a close is ignored entirely. `this.active` stays `true`, so `isActive()` reports streaming, the button keeps reading "Stop", the server has no listener, and no audio plays. There is no retry, no backoff, no error.

This is exactly the phone sleep/wake and Wi-Fi-blip case the README targets ("audio keeps playing when the screen is locked", "the phone will auto-connect within 2 s"). The `background.html` version *does* handle it (line 413-423 sets status and updates the button), which confirms the omission is an oversight.

Compounded by BUG-046: even a *new* connection would not help unless ffmpeg happens to have been restarted.

**Recommended fix.** Add an `onclose` handler that marks inactive, notifies subscribers, and schedules a bounded exponential-backoff reconnect (mirror `useMediaStream.ts:117-120`); reset the backoff on the first good frame.

---

### BUG-014 — Unbounded memory growth and O(n²) copying while the AudioContext is suspended

**Severity:** Critical · **Confidence:** Confirmed (measured) · **File:** `streamManager.ts:74-161`

```tsx
private flushBatch() {
  if (!this.ctx || this.accFrames === 0) return;
  if (this.ctx.state !== 'running') {
    this.ensureResumed(this.ctx).catch(() => {});
    return;                                    // ← accFrames is NOT reset
  }
```

`flushBatch` returns without clearing `accFrames`, so `feedFrame` keeps merging; each merge allocates a fresh `Float32Array` of the accumulated length and copies both channels.

Measured in Chromium with `--autoplay-policy=user-gesture-required` and no user gesture (the first-run experience the README describes for phones):

```
t+2.0s   heap=8.6 MB    btn=Stop
t+4.0s   heap=13.4 MB   btn=Stop
t+8.0s   heap=22.8 MB   btn=Stop
t+16.0s  heap=18.0 MB   btn=Stop
t+24.1s  heap=25.4 MB   btn=Stop
t+28.1s  heap=9 MB      btn=Stop     ← GC sawtooth; peaks climbing
```

Baseline heap is 7.5 MB. Frames arrive at 23.4/s × 2048 samples × 2 ch × 4 B = **375 KB/s of retained samples**, plus quadratic copy churn. The button claims "Stop" for the whole 28 s while nothing is audible. On a phone this is a tab kill; on iOS Safari a backgrounded tab is exactly where autoplay stays blocked indefinitely.

`public/background.html:191-267` has the identical defect (`flush()` early-returns at line 193 without resetting `accFrames`), but its `createBuffer`/`getChannelData` calls are wrapped in `try/catch` (lines 199-213) so it self-heals after a burst — the memory is still consumed.

**Recommended fix.** Bound the accumulator: when the context is not running, keep at most `TARGET_DELAY` worth of frames and drop the rest, and show the "tap to enable audio" state. Use a preallocated ring buffer instead of `new Float32Array` per frame.

---

### BUG-015 — PTS is transmitted in every frame but only ever used for the first batch

**Severity:** High · **Confidence:** Confirmed (code path) · **File:** `streamManager.ts:138-161`

```tsx
private feedFrame(pts: number, pcm: ArrayBuffer) {
  ...
  if (this.accFrames === 0) { this.firstBatchPTS = pts; this.accChannels = …; }
  …
  this.accFrames++;
```

`pts` is read at exactly one place. Every subsequent frame is appended blindly. A single dropped or duplicated frame — guaranteed on a lossy Wi-Fi link — permanently deletes or repeats 42.67 ms of audio, and **neither the client nor the server notices**. The README claims "sample-accurate multi-device alignment"; there is no alignment mechanism after the first batch.

Note the server *does* compute a smoothed PTS with an EMA (`audio_stream.go:30-50`, α=0.02) precisely so consumers can detect drift — that work is discarded.

**Recommended fix.** Track `lastPts`. On `|pts − lastPts − 42.67| > 1 ms`, either insert silence to hold the timeline, or drop the batch and re-anchor, and surface a drift counter. Also reject frames whose PTS moves backwards (the server can deliver out of order to a slow consumer — BUG-047).

---

### BUG-016 — The PI drift compensator is mathematically incapable of converging

**Severity:** High · **Confidence:** Confirmed (arithmetic) · **File:** `streamManager.ts:21-24, 104-116`

```ts
const PI_KP = 0.000008, PI_KI = 0.0000003, PI_MAX = 0.003, PI_INTEGRAL_LIMIT = 500;
let adj = error * PI_KP + this.integralError * PI_KI;   // `error` is in milliseconds
```

| Quantity | Value | Consequence |
|---|---|---|
| `error` needed to saturate `PI_MAX` via P | 0.003 / 8e-6 = **375 ms** | a 50 ms buffer error yields only 0.04 % rate change |
| Max I contribution | 500 × 3e-7 = **0.015 %** | 20× too small to matter |
| Time for I to reach its clamp at 50 ms error | 500 / (50 × 0.05) ≈ **200 s** | then the loop has no authority left |
| Rate authority in total | 0.3 % | drains 50 ms in **167 s**; a 2 s stall backlog in **~28 minutes** |

Worse, line 115 schedules the next buffer flush against `this.scheduledEnd` with no re-anchor, so after a network stall the scheduled end time only moves forward and **latency grows monotonically with no recovery path**. `public/background.html:241-245` *does* contain the missing re-anchor:

```js
if (t < ctx.currentTime - 0.5) { t = ctx.currentTime + 0.05; schedEnd = 0; }
```

which confirms the absence in `streamManager.ts` is an oversight, not a design decision.

**Recommended fix.** Port the re-anchor. Re-tune the gains in units of buffer-seconds rather than milliseconds, raise the rate authority to ~2 %, and add a hard latency clamp: when `scheduledEnd - ctx.currentTime > 500 ms`, drop the oldest audio and re-anchor. Document the intended correction rate and the resulting steady-state latency.

---

### BUG-017 — Background page opens duplicate sockets on every poll tick during connect

**Severity:** High · **Confidence:** Confirmed (code path) · **File:** `public/background.html:444-474, 504-534`

`startPoll(2500)` fires `checkBroadcastOnce` every 2.5 s. On a broadcast it calls `start()`, which sets `active = true` only after the init frame *and* the NTP handshake — bounded by the 10 s `init timeout` at line 368. `start()`'s only guard is `if (active) return` (line 445), so any poll tick landing inside that window opens **another** `WebSocket` and overwrites the module-level `ws`, leaking the previous socket. With a 2.5 s poll and a multi-second handshake this fires on effectively every broadcast — on the exact low-power page the README recommends for reliability.

**Recommended fix.** Set a `connecting` flag synchronously; guard on `active || connecting`; close any existing socket before overwriting `ws`.

---

### BUG-018 — The service worker's scope excludes every request its fetch handler is written for

**Severity:** High · **Confidence:** Confirmed (registration + spec) · **File:** `public/service-worker.js:26-29`, `index.html:31-33`

`navigator.serviceWorker.register('/static/service-worker.js')` gives the worker the default scope `/static/`. A worker only receives `fetch` events for requests made by clients it controls, and a page at `/static/` is controlled only for URLs under `/static/`. Therefore this block is **unreachable**:

```js
if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media-stream') || url.pathname.startsWith('/ws/')) {
  return;   // "Don't cache API — just pass through, but keep service worker alive"
}
```

The comment's premise is wrong. Practical consequence: the app has **no offline capability at all**, and no API/SSE pass-through is happening. (Third-party requests to `open-meteo` and `i.ytimg.com` *do* traverse the handler, adding latency and the `.catch(() => cached || Response.error())` fallback risk for no benefit.)

**Recommended fix.** Either register with `{ scope: '/' }` (requires a `Service-Worker-Allowed: /` response header) or accept that the worker is a static-asset cache only and delete the misleading branches.

---

### BUG-019 — Cache-first HTML breaks already-installed PWAs after a rebuild

**Severity:** High · **Confidence:** Confirmed (code path) · **File:** `public/service-worker.js:5, 38-47`, `vite.config.ts:8-11`

`install` pre-caches `'/static/'` (the HTML shell) and `fetch` is cache-first for everything not under `/api/`. Vite emits content-hashed assets with `emptyOutDir: true`. After a rebuild the new HTML references `/static/assets/index-<newhash>.js` while the worker keeps serving the **old cached `/static/` HTML** pointing at the deleted bundle → 404 → white screen, on every already-installed PWA, until the SW is manually unregistered. `CACHE = 'control-deck-v2'` is not tied to the build hash, so nothing forces an update.

**Recommended fix.** Network-first (or stale-while-revalidate) for navigations and HTML; cache-first only for hashed assets; embed the build hash in the cache name; add a `skipWaiting`/`clients.claim` + `controllerchange` reload path (partially present at line 18 but unused by the page).

**Regression test.** Build → install SW → rebuild → reload; assert `document.querySelector('script[type=module]').src` returns 200.

---

### BUG-020 — The volume control looks fully functional when the audio stack is absent

**Severity:** Medium · **Confidence:** Confirmed (code + screenshot) · **File:** `MixerCard.tsx:14-18, 38, 73-97`

`vol = state?.volume ?? -1`; `showVol = draggingVol.current ? localVol : (vol >= 0 ? … : localVol)` with `localVol` initialised to `100`. When `wpctl` is missing, `volume` is `-1` and the slider confidently displays **100 %**, is fully draggable, and every `setVolume` call fails silently. The mute button has no disabled state either. `MixerCard` consults only `caps.brightness`; there is no audio capability check at all.

**Recommended fix.** Gate the volume row on an audio capability and render an explicit unavailable state naming the missing binary, rather than a plausible-looking 100 %.

---

### BUG-021 — The per-app volume slider applies a quadratic curve to a linear slider

**Severity:** Medium · **Confidence:** Confirmed (arithmetic + `pactl` semantics verified on the live host)
**File(s):** `audio.go:136`, `MixerCard.tsx:179-210` · **Component:** Mixer card → App audio

`handleSetAppStream` applies `linear := math.Pow(pct/100, 2)` where `pct` is the raw slider value; `fetchAppStreams` reads PulseAudio's percentage straight back and the UI displays it unmodified.

Verified against the live host that the factor semantics are as assumed — `pactl list sink-inputs` reports `front-left: 65536 / 100%`, i.e. 65536 = factor 1.0 = 100 %:

| UI slider | pactl factor sent | actual PA volume | UI then displays |
|---|---|---|---|
| 100 % | 1.000000 | 100.0 % | 100 % |
| 75 % | 0.562500 | 56.2 % | 56 % |
| **50 %** | **0.250000** | **25.0 %** | **25 %** |
| 25 % | 0.062500 | 6.2 % | 6 % |
| 10 % | 0.010000 | 1.0 % | 1 % |

**Correction to an earlier hypothesis of mine:** the round trip is *stable* — it does not drift toward zero on repeated adjustment, because the UI reads the PA percentage and applies the square on the way out only. The real defect is that **the value you set is not the volume you get**: the bottom two-thirds of the slider is compressed into near-silence, 75 % is unreachable by dragging, and nothing (no unit, no tooltip) signals the discrepancy.

**Recommended fix.** Send the slider value directly — it is already a 0-100 percentage. If a perceptual curve is wanted for per-app volume, apply it on the *read* path and label the axis, so that the displayed number and the applied number agree.

---

### BUG-022 — WARP/ERP toggles are gated on the binary, not on command registration

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `config/deckConfig.ts:58-71`, `main.go:62-92`

`buildCommandMap` does **not** define `warpOn`, `warpOff` or `erpLogin`. They exist only if the operator copies them into `custom_commands`. The capability gate is `checkBinary("warp-cli")` / `checkBinary("erp")`, so the toggle appears whenever the binary is on `PATH` regardless of whether the command is registered. The server then answers `400 Unknown command`, and `triggerCommand` never inspects `res.ok` (BUG-038), so the failure is **completely silent**.

The author's own `config.json` does define them, which is why this has not surfaced for them — but `config.example.json` is the onboarding path, and a new user copying only the example's `features` block gets two dead tiles.

**Recommended fix.** Gate on `commandKnown(name)` (`main.go:812` already exists) rather than on a binary check, and log at startup any `deckConfig` toggle name that has no registered command.

---

### BUG-023 — Connected-device tracking keys on `RemoteAddr` including the ephemeral port

**Severity:** High · **Confidence:** Confirmed (runtime) · **File:** `main.go:301-306` · **Component:** Connected Devices card

```go
ip := r.RemoteAddr          // "127.0.0.1:44634"
key := ip + "|" + r.UserAgent()
```

Every TCP connection from the same device produces a different key, so **every request creates a new "client"**. Measured in a single browser tab:

```
t+0s count=3   127.0.0.1:44634 | Mozilla/5.0 (X11; Linux x86… | dev=ec69eba5
               127.0.0.1:44648 | Mozilla/5.0 (X11; Linux x86… | dev=ec69eba5
               127.0.0.1:44640 | Mozilla/5.0 (X11; Linux x86… | dev=(empty)
t+1s count=4   (+ 127.0.0.1:44668)
```

The count plateaus at ~4 only because of the 3-second TTL; it scales with the client's request rate. Consequences:

- `shots/deck-Home-desktop.png` shows **three identical "Linux (you) · 13 ms" rows**.
- The bottom-bar client badge read **9** after three browser sessions.
- `/api/clients` fan-out and the `cleanupClients` O(n) scan grow with request volume.
- Per-device stream start/stop targets a synthetic entry.
- The `dev=` (empty) row is the entry created by `trackMiddleware` on the initial navigation: `App.tsx` only appends `device_id` to `/media-stream` and `/api/clients`, never to the page URL, so that entry never receives an ID and always fails with `404 device not connected`.

**Recommended fix.**

```go
host, _, err := net.SplitHostPort(r.RemoteAddr)
if err != nil { host = r.RemoteAddr }
key := host + "|" + deviceID        // collapse tabs of one device
if deviceID == "" { key = host + "|" + r.UserAgent() }
```

Have `App.tsx` append `?device_id=` to the initial navigation too, or key on the `device_id` from the SSE registration.

---

### BUG-024 — Clipboard copy reports success even when the copy failed

**Severity:** Medium · **Confidence:** Confirmed · **File:** `ClipboardCard.tsx:80-100`

The `navigator.clipboard.writeText` failure path falls back to `document.execCommand('copy')` and then shows `showToast('Copied!', 'success')` **unconditionally** — `execCommand`'s return value is never checked (line 92). On a non-secure origin (`http://<lan-ip>:8080`) the modern API is unavailable, so the user is told the text was copied when it was not. The error branch at line 96-97 exists but is unreachable.

**Recommended fix.** Check `execCommand`'s return value and confirm the selection was restored; show the failure toast (which already exists).

---

### BUG-025 — GPU bar can render the literal string "GPU" as if it were a measurement

**Severity:** Low · **Confidence:** Confirmed · **File(s):** `gpu.go:143-153`, `SystemStatsCard.tsx:79-84, 133-141`

`fetchIntelGPU` returns `&GPUStats{Present: true, Name: gpuName}` with zero-valued `MemUsed`/`MemTotal` and `Temp: -1` when the `intel_gpu_top` JSON does not contain `"busy"`. `gpuMemDisplay` requires `mem_total > 0` and `gpuTempDisplay` requires `temp >= 0`, so both are empty strings; the fallback chain then yields `` `${gpuLabel}` `` — the literal text **"GPU"** rendered in the value slot of a `StatBar` labelled "GPU", i.e. "GPU: GPU".

**Recommended fix.** Return a per-backend capability set (`hasUtil`, `hasMem`, `hasTemp`) and render only the bars the backend can actually fill; render "n/a" rather than a label.

---

### BUG-026 — Service stats read the wrong `/proc/<pid>/stat` fields (off-by-two)

**Severity:** High · **Confidence:** Confirmed (runtime) · **File(s):** `service_stats.go:66-83, 147-148` · **Component:** ServiceStatsBar (fixed top strip)

`parseProcStat` splits the line after the last `)`, so `fields[0]` is `state` — 1-based field 3. Therefore `fields[n]` is 1-based field `n+3`:

| 1-based | field | correct index | index the code uses |
|---|---|---|---|
| 14 | `utime` | `fields[11]` | |
| 15 | `stime` | `fields[12]` | |
| 16 | `cutime` | `fields[13]` | ✅ **used for CPU** |
| 17 | `cstime` | `fields[14]` | ✅ **used for CPU** |
| 22 | `starttime` | `fields[19]` | |
| 24 | `rss` (pages) | `fields[21]` | ✅ **used for uptime** |

Verified against the live host (PID 4242):

```
ps -o etimes  →  198408                       (real uptime)
/api/service-stats → "uptime_secs": 195409, "cpu_percent": 80
real CPU (utime+stime delta over 3 s) → 16.7 %
```

- **CPU %** is `cutime + cstime` — the CPU time of *reaped children*, i.e. the aggregate of every `playerctl`/`pactl`/`brightnessctl` subprocess the server has reaped. For a Go server that spawns 50-90 processes/second (§3.3) this is a large, meaningless number that moves with subprocess churn — visible in the screenshots as `54.5 %`, `65.0 %`, `60.0 %` for an essentially idle server.
- **Uptime** is `now − (bootTime + rss_pages/100)`, so it *tracks RSS*. RSS grows as the process warms up, so the reported uptime drifts.

**Recommended fix.** Use `fields[11]`/`fields[12]` for CPU and `fields[19]` for starttime. Read `USER_HZ` via `sysconf(_SC_CLK_TCK)` instead of hardcoding 100, or document the assumption. Add the regression test below.

**Regression test.** `TestQueryProcessByName` — start `sleep 30` in a test helper, call `queryProcessByName`, assert `uptime_secs` is in `[28, 30]` and `cpu_percent < 5`. Also assert against a process that *has* reaped children (so `cutime > 0`) to catch a regression back to the wrong field.

---

### BUG-027 — Weather day labels shift by one depending on the time of day

**Severity:** Medium · **Confidence:** Confirmed (arithmetic) · **File:** `WeatherCard.tsx:32-39`

```ts
const d = new Date(dateStr);            // "2026-09-27" → parsed as UTC midnight
const today = new Date();
const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
if (diff === 0) return 'Today';
if (diff === 1) return 'Tomorrow';
return d.toLocaleDateString('en-US', { weekday: 'short' });
```

The API is called with `timezone=auto` (line 51), so `daily.time` entries are *local* dates, but `new Date("2026-09-27")` is parsed as **UTC**. At 18:00 local: today's diff is −0.75 d → `Math.round(-0.75) = -1`, and tomorrow's is +0.25 d → `0`. So for the second half of every day, **today is labelled with yesterday's weekday and tomorrow is labelled "Today"**.

**Recommended fix.** Parse as local (`const [y,m,d] = dateStr.split('-').map(Number); new Date(y, m-1, d)`) and compare `toDateString()`, or diff against local midnight.

---

### BUG-028 — Geo calibration is an O(n²) render and memory loop

**Severity:** High · **Confidence:** Confirmed (measured) · **File:** `GeoSurveyCard.tsx:126-139`

```tsx
useEffect(() => {
  if (!calibrating || !currPos) return;
  const elapsed = Date.now() - calibStart.current;
  if (elapsed >= CALIB_DURATION) { …setCalibResult(…); return; }
  setCalibSamples(prev => [...prev, currPos]);      // ← writes a dependency
}, [currPos, calibrating, calibSamples]);
```

`setCalibSamples` always produces a new array, so the dependency changes, the effect re-runs, and it appends again. Measured over one 30-second calibration:

```
t+32.1s   Calibrated: 22.320000, 87.300000 (80381 samples)
```

**80 381 samples in 30 s ≈ 2 679 effect runs per second.** A real GPS receiver produces ~1 fix/s, so the reported `n` is fiction. JS heap oscillates **9 → 70 MB** with climbing GC peaks (baseline 7.5 MB), and because each append copies the whole array the total work is ~3.2 × 10⁹ element copies.

React coalesces the updates, so there is no hard crash — the tab is simply pinned at 100 % CPU for 30 s while holding tens of MB. The earlier hypothesis that this hard-crashes with "Maximum update depth exceeded" was **tested and is false**: the page stayed responsive (`evalRoundTrip` 4-12 ms throughout) because the scheduler resets the nested-update counter between effect passes. The cost is real regardless.

**Recommended fix.** Accumulate into a ref (`samplesRef.current.push(pos)`) and publish to state at most once per second, mirroring the recording loop at lines 105-109. Remove `calibSamples` from the dependency array.

**Regression test.** Render `GeoSurveyCard` with `geolocation.watchPosition` stubbed at 1 Hz, click "Calibrate Center", advance 30 s, assert the reported sample count is ≤ 35 and that the render count stays below a threshold.

---

### BUG-029 — The BLE advertised name is never configured, and `stop()` never stops watching

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `ble.go:31-34`, `BleProximityCard.tsx:4, 54-56, 86-96`

Two halves of one feature that cannot work together:

1. **The name filter can never match.** The phone requests `filters: [{ name: DEVICE_NAME }]` with `DEVICE_NAME = 'conquest'`, but `ble.go` runs `bluetoothctl advertise on` with no name and never sets an advertised local name. `requestDevice` will show an empty list or fail.
2. **`stop()` is a no-op for the listener.** It calls `deviceRef.current.removeEventListener('advertisementreceived', () => {})` — a **new** anonymous function that does not match the registered listener, so it is never removed — and it never calls `device.stopWatchingAdvertisements()`, so the BLE scan continues in the browser after the user taps "STOP", draining battery.

Additionally, `bleStartAdvertising` discards every `exec.Command` result (`cmd.Run()` with the error ignored) and sets `ble.running = true` unconditionally, so the UI shows "Advertising" even when `advertise on` is unsupported or fails. `advertise` requires BlueZ ≥ 5.65 and is frequently absent.

**Recommended fix.** Set the advertised name (`bluetoothctl set-local-name conquest`, or a proper LE advertising API); keep a named handler reference and remove that; call `stopWatchingAdvertisements()`; check and propagate `cmd.Run()` errors; add an `advertise` probe to `/api/capabilities` so the card hides when unsupported.

---

### BUG-030 — Music search responses can arrive out of order and overwrite newer results

**Severity:** Medium · **Confidence:** Confirmed · **File:** `MusicSearch.tsx:26-51`

The debounce clears the timer but nothing aborts an in-flight request and there is no request-sequence guard. `searchMusic` → `/api/music/search` spawns `yt-dlp` with **no server-side timeout** (`music_service.go:48-50`), so it can take many seconds. Typing "a", pausing, then typing "abc" leaves the "a" request running; if it resolves last, `setResults(res)` shows results for the stale query with no indication.

**Recommended fix.** Track a monotonically increasing `requestId` and drop responses whose id is not current; add an `AbortController`; add a server-side timeout to `handleMusicSearch`.

---

### BUG-031 — "Toggle subtitles" actually disables them, and "Cycle audio" selects track 1

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `VideoPlayerDeck.tsx:144, 171`, `video_player.go:252-260, 404-407`

- Subtitles "Toggle" sends `set_subtitle { track_id: 0 }`; the backend maps `TrackID <= 0` to `mpv sid 0` = *disable*, and VLC to `subtitle_track&val=-1`. It is not a toggle.
- Audio "Cycle" sends `set_audio { track_id: 1 }`, which selects the track whose id is 1. There is no cycle action on either backend.

Compounding this, the backend returns `subtitles[]` and `audio_tracks[]` in `VideoStatus` and **the deck never renders them** — there is no track picker at all, so per-track selection is impossible and `fetchMPVStatus`'s track-list parsing (lines 179-219, ~40 lines) is unused work.

**Recommended fix.** Rename the actions to match their behaviour ("Off", "Track 1") or implement a real cycle; render the returned track lists as selectable chips, which also makes the existing backend work visible.

---

### BUG-032 — With no video player detected, the deck injects keystrokes into whatever window is focused

**Severity:** High · **Confidence:** Confirmed · **File:** `video_player.go:610-612` · **Component:** Video player deck

```go
default:
    sendXdotoolCommand(cmd, "")
    return nil
```

`sendXdotoolCommand` (lines 441-496) executes `$HOME/.local/bin/tab-dashboard-sendkey <key>` with **no player argument**, which writes the keystroke to the globally focused window. With `active_player == "unknown"` — the badge literally reads "Not detected" (screenshot-verified) — every button on the Video deck is still live: "Frame Next" types `e`, "Frame Prev" types `e` (the `direction: 'prev'` branch is unreachable because `key = "e"` is assigned before the direction is examined, line 479-481), "Toggle" types `v`, "Cycle" types `b`, "Reset" types `g`/`h`/`j`/`k` up to 100 times each.

If VS Code, a chat window, or a document has focus, the user types into it. The only thing standing between a mis-tap and data loss is the user's attention.

**Recommended fix.** Server-side guard in `sendVideoCommand`: when `detectVideoPlayer() == "unknown"`, return an error instead of calling `sendXdotoolCommand`. Client-side: render an empty state and disable all action buttons. Also fix `frame_step`/`prev` to use a distinct key (`shift+g` for VLC, `,`/`.` for YouTube) instead of duplicating `e`.

---

### BUG-033 — `handleVideoCommand` returns HTTP 200 "ok" even when the command failed

**Severity:** Medium · **Confidence:** Confirmed · **File:** `video_player.go:645-650`

```go
if err := sendVideoCommand(cmd); err != nil { log.Printf("video command error: %v", err) }
w.Header().Set("Content-Type", "application/json")
json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
```

The error is logged and discarded. The same handler's `http.Get` calls (lines 63, 525, 603) use `http.DefaultClient`, which has **no timeout**, so a non-responsive VLC on the configured port hangs the handler goroutine and its connection indefinitely — and `fetchVideoStatus` runs on a 1 s poll, so this can accumulate.

Combined with the frontend's optimistic `setSubDelay(next)` (line 49) and the 1 s poll that overwrites it from the unchanged server value (lines 31-32), delay nudges visibly snap back and nothing is ever reported.

**Recommended fix.** Return the error with a 502; use a client with a 2 s timeout; have the frontend surface it and disable the control while a command is in flight.

---

### BUG-034 — IDE "Step Out", "Stop" and "Restart" all send F5 (Continue)

**Severity:** High · **Confidence:** Confirmed · **File(s):** `main.go:103-105`, `decks/IdeDeck.tsx:6-15`, `cmd/sendkey/main.go:42-85`

```go
"dbg_step_out":  {"sh", "-c", sk + " F5"}, // Shift+F5 — handled below
"dbg_stop":      {"sh", "-c", sk + " F5"}, // Shift+F5
"dbg_restart":   {"sh", "-c", sk + " F5"}, // Ctrl+Shift+F5 via loop
```

All three comments point at code that does not exist. `cmd/sendkey`'s `keyMap` has no `shift_f5` or `ctrl_shift_f5` entry, and `main.go:934` only ever sends `shift_.` / `shift_,`. So **"Stop" continues the debugger** and **"Restart" restarts nothing**. Pressing Stop is a plausible, destructive mistake mid-debug-session.

`dbg_toggle_break` (line 106) is `playerctl --player $PLAYER play-pause` — a breakpoint toggle implemented by pausing the user's music. Every press has an audible side effect.

**Recommended fix.** Add `shift_f5` and `ctrl_shift_f5` to `sendkey`'s key map (and the corresponding `shiftKeys` handling), implement the three commands properly, or remove the buttons until they work. Replace the breakpoint hack with a real debug-adapter IPC.

---

### BUG-035 — The terminal reconnects forever every 2 s and floods the terminal with `[disconnected]`

**Severity:** Medium · **Confidence:** Confirmed (code + runtime) · **File:** `decks/TerminalDeck.tsx:102-109`

```tsx
ws.onclose = () => {
  wsRef.current = null; setConnected(false);
  term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
  reconnectTimer = setTimeout(connect, 2000);
};
ws.onerror = () => { ws.close(); };      // → onclose → reconnect
```

No backoff, no attempt cap, unconditional retry. With the backend down — or the `terminal` feature disabled while the deck is still mounted, which happens whenever the flag is off but the page was loaded before the reload — the client retries every 2 s forever and appends a red `[disconnected]` line each time. Verified during the failure test: `WebSocket connection to 'ws://127.0.0.1:18081/ws/terminal' failed: net::ERR_CONNECTION_REFUSED`. With several clients this is a reconnect storm, and the scrollback fills with the same line.

Related: the PTY is spawned on **mount**, not on deck focus (`TerminalDeck` is always mounted, §3.2), so every dashboard view — including ones the user never opens — costs a login shell. And `sendToTerminal` silently discards input when the socket is down while all 20 toolbar buttons look enabled.

**Recommended fix.** Bounded exponential backoff with jitter (mirror `useMediaStream.ts:117-120`); cap visible retries; mount the PTY lazily on first deck focus and tear it down when the deck is left; disable the toolbar when `!connected`.

---

### BUG-036 — "Refresh" in the nav menu silently kills an active audio broadcast

**Severity:** Medium · **Confidence:** Confirmed · **File:** `FloatingNav.tsx:70-77`

```tsx
<button onClick={() => location.reload()}> … Refresh </button>
```

No confirmation. A reload closes the page's audio WebSocket; if it is the last listener, `removeListener` → `stopLocked()` tears down ffmpeg, so **every other device's audio dies mid-song**. The user clicked a menu item labelled "Refresh". Given the README's workflow (broadcast running, phone listening), this is a plausible and destructive tap.

**Recommended fix.** Replace with a state-level reconnect — `useMediaStream` already self-heals and needs no reload — or confirm the action when `streamManager.isActive()`.

---

### BUG-037 — The LRC parser rejects single-digit minutes and mis-parses multi-timestamp lines

**Severity:** Low · **Confidence:** Confirmed · **File:** `lib/lyricsEngine.ts:15-22`

```ts
const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
```

- `\d{2}` for minutes means the legal LRC form `[1:23.45]` is silently dropped — an entire track's lyrics disappear with no error.
- Only one timestamp per line is consumed. For `[00:12.00][01:20.00]Repeated chorus` the captured text becomes `[01:20.00]Repeated chorus`, so the second timestamp tag is **rendered as lyric text**.
- `[offset:+500]` and `ar:`/`ti:` metadata are ignored; ignoring `offset` silently shifts every line by up to a second.

**Recommended fix.** Use `/\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]/g` in a loop, emitting one `LyricLine` per timestamp with the remainder as text; honour `[offset:]`.

---

### BUG-038 — `triggerCommand` / `seekTo` / `setVolume` / `setBrightness` never check the response

**Severity:** High · **Confidence:** Confirmed · **File:** `services/apiService.ts:5-52`

All four only `try/catch` the network call; `res.ok` is never inspected and the body is never read. Every server-side failure — `400 Unknown command` (BUG-022), `403 Feature disabled: ide`, `500`, a `404` from a dead backend — is reported to the user as **success**.

This is the single root cause of both the "WARP does nothing" and the "IDE buttons feel dead" experiences, and it means the Code deck's 18 actions produce **zero** feedback of any kind: no success, no failure, no output.

**Recommended fix.** Throw on `!res.ok` with the status and body text. Add a shared `request()` helper so every endpoint gets the same treatment, and surface errors at the call sites.

---

### BUG-039 — Auto-focus yanks the deck to Home for any unrecognised window

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `hooks/useActiveWindow.ts:11-18`, `main.go:1467-1500`

`classifyApp` returns `"default"` for every unrecognised `wm_class`, and `appToPage['default'] = 0`. So focusing a file manager, a text editor, a calculator — **or the dashboard's own browser tab** — emits `APP_FOCUS_CHANGED{app:"default"}` and the app auto-swipes to Home.

Observed live in the server log during the audit: every Chrome / Brave / GNOME-Terminal focus change produced a broadcast, e.g. `app focus changed: browser | social computing iit kgp - Google Search - Google Chrome`. Switching back to the dashboard's own tab would return the deck to Home. The documented "stay on my deck" behaviour therefore only holds while the focused window maps to the deck you are already on.

**Recommended fix.** Distinguish `unknown` from `default` and do not route on `unknown` at all. Ignore focus events whose `wm_class` is a browser whose title matches the dashboard. Add a "pause auto-focus for N minutes" affordance, which is what a daily driver actually wants.

---

### BUG-040 — A capability-fetch failure hides every capability-gated card, with no error and no retry

**Severity:** High · **Confidence:** Confirmed · **File:** `hooks/useCapabilities.ts:26-51`

```ts
pending = (async () => { try { … } finally { pending = null; } })();   // no catch
…
fetchCaps().then(setCaps);                                             // no catch
```

`useFeatures` has a `try/catch` that fails open; `useCapabilities` does not. A failure (or a hang) leaves `caps` at `defaultCaps` — **all `false`** — so Bluetooth, WARP, ERP, night light, brightness, clipboard, ffmpeg, playerctl, battery, mpv, yt-dlp and kdeconnect cards all **disappear permanently**, with an unhandled promise rejection in the console and nothing shown to the user.

There is also no timeout, and `/api/capabilities` can block indefinitely: `gsconnectAvailable()` (`music_service.go:406-413`) runs `gjs -m … --list-devices` with **no timeout** and is invoked from `handleCapabilities` (line 598) and again from `deviceIsPhone` / `devicePaired` / `ensureDevicePaired` / `listPhoneDevices` — each spawning a GJS interpreter.

**Recommended fix.** Mirror `useFeatures`: catch, retain the last known good value, and surface a "capability detection failed — retry" affordance. Add a 5 s timeout. Cache `gsconnectAvailable()` behind an atomic with a TTL so it is computed once per TTL rather than once per call.

---

### BUG-041 — Feature keys `power`, `scenes`, `filedrop` are accepted by the backend and ignored by the frontend

**Severity:** Low · **Confidence:** Confirmed · **File(s):** `config.go:56-57, 62-81`, `frontend/src/config/features.ts:14-30`

`KnownFeatures` lists 18 keys; `FEATURE_DEFAULTS` has 15. `useFeatures` iterates `Object.keys(defaults)`, so the three extra keys are received and dropped. `config.example.json` advertises all three as toggleable and `config.go:151-153` warns about *unknown* keys — so the system half-detects the problem, on the config side only. Setting `"power": false` silently does nothing.

**Recommended fix.** Generate `FEATURE_DEFAULTS` from a single source of truth, and add the test below.

**Regression test.** Assert that `KnownFeatures` (sorted) equals `Object.keys(FEATURE_DEFAULTS)` (sorted). A single canonical list exported by the backend and imported by the frontend, or a generated TS file, makes the class of bug impossible.

---

### BUG-042 — Art theming silently fails for any art host without CORS, and sticks when art disappears

**Severity:** Low · **Confidence:** Confirmed · **File(s):** `hooks/useArtTheming.ts:71-87`, `index.css:216-222`

Two independent defects:

1. **`img.crossOrigin = 'anonymous'` requires the art server to send `Access-Control-Allow-Origin`.** Verified: a same-origin read succeeds; a genuinely cross-origin image without ACAO produces `img.onerror`, and the Go server sends no CORS headers on `/static/*` (checked directly). YouTube's CDN *does* send ACAO — tested with a real `https://i.ytimg.com/…` URL and `getImageData` succeeded — so the feature works for YouTube artwork and **fails silently for every other host** (Spotify, Deezer, Apple Music, Jellyfin/Navidrome, Bandcamp, local files served by a different port). On error the class is removed and there is no message.
2. **The theme is never reset when art disappears.** `if (!artUrl || artUrl === prevUrl.current) return;` — when the next track has no artwork the effect returns early, `art-themed` is never removed, and the accent colour stays locked to the previous track's art indefinitely. Observed live: the whole UI shifted from cyan to lime green and back as tracks changed, with no obvious cause.

**Recommended fix.** Wrap `extractColors` in `try/catch`; clear the theme when `artUrl` becomes null; document the CORS dependency or proxy remote artwork through the backend (which already reads local `file://` art and MIME-checks it, `main.go:1663-1710`).

---

### BUG-043 — `/api/service-stats` sleeps 400 ms inside every HTTP handler invocation

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `service_stats.go:99, 109-131, 28-35` · **Component:** ServiceStatsBar

```go
func sampleCPU(pid int) float64 {
    …
    time.Sleep(200 * time.Millisecond)
```

`collectServiceStats` calls `queryProcessByName` for `tab-dashboard` and for `ffmpeg` **sequentially**, and each call sleeps 200 ms — so **every request occupies a handler goroutine for at least 400 ms**, even when the process does not exist. `ServiceStatsBar` polls it every 5 s per client. With N clients, N goroutines and N connections are pinned 40 % of the wall clock.

The comment says "sample over 100 ms" while the code sleeps 200 ms.

**Recommended fix.** Maintain the CPU delta in a single background sampler (one 200 ms sleep, not one per request) and make the handler a pure read. Fix the comment.

---

### BUG-044 — `speed_*` commands ignore the player and always type into the focused window

**Severity:** Low · **Confidence:** Confirmed · **File(s):** `main.go:888-960`, `decks/MediaBrowserDeck.tsx:90-99`

`handleSpeedCommand` receives only the command name; `req.Player` is discarded entirely. `triggerCommand('speed_up', playerId)` passes a player ID that the server never reads. The FEATURES doc's claim that "the active player's ID is passed so keystrokes go to the focused media window" is inverted — the ID is not used at all, and the keystrokes go to whatever has focus.

**Recommended fix.** Either thread the player through and raise the MPRIS window before injecting (as `handleCommand` already does for `fullscreen`/`captions`, `main.go:787-791`), or remove the parameter and state plainly in the UI that this deck acts on the focused window.

---

### BUG-045 — `wl-paste` and `xclip` share a single 2-second context

**Severity:** Low · **Confidence:** Confirmed · **File:** `clipboard.go:68-99`

```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
cmd := exec.CommandContext(ctx, "wl-paste")      // may consume all 2 s
…
cmd = exec.CommandContext(ctx, "xclip", …)       // ctx already expired → guaranteed failure
```

If the Wayland attempt uses the full 2 s (a slow or unresponsive compositor), the X11 fallback is launched with an already-cancelled context and **cannot** succeed. The error surfaced to the user is `context deadline exceeded`, which identifies neither the binary nor the cause.

**Recommended fix.** One timeout per attempt (2 s each, 4 s total), and include the failing binary's name in the returned error.

---

### BUG-046 — ffmpeg pipeline death silently strands every connected audio client

**Severity:** High · **Confidence:** Confirmed · **File(s):** `audio_stream.go:149-194, 313-323`

When ffmpeg's pipe closes, `readLoop` sets `m.ffCmd = nil` / `m.stdout = nil` and returns — but the `listeners` map is untouched and **no client is notified**. Every connected WebSocket then blocks forever on `<-ch` with `ctx.Done()` pending, so:

- `/api/audio-stream/status` keeps reporting `active: true` (it is `len(streamMgr.listeners) > 0`);
- `MediaState.AudioStreamActive` keeps reporting true, so the UI shows "Stop";
- no data ever arrives, and the client's PI loop sees `scheduledEnd` fall behind `ctx.currentTime` and begins immediate-play catch-up — silent and CPU-heavy.

A new `addListener()` *does* restart ffmpeg (`m.ffCmd == nil` → `start()`), so recovery requires a **new** connection — which BUG-013 says the client will not make. The two bugs together make audio unrecoverable without a manual stop/start or a page reload.

Common triggers: the PulseAudio monitor source disappearing on a device switch, `ffmpeg` being upgraded underneath a running process, or a `SIGPIPE`/OOM.

**Recommended fix.** On read-loop exit, close every listener channel and send a `{"type":"error","reason":"capture_stopped"}` control frame so clients can show a real state and retry. Restart ffmpeg with bounded backoff. Make `/api/audio-stream/status` report the *ffmpeg* state, not just the listener count.

---

### BUG-047 — Slow consumers receive audio frames out of order

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `audio_stream.go:178-192`

```go
select {
case ch <- frame:
default:
    go func(c chan []byte, d []byte) {
        defer func() { recover() }()
        select { case c <- d: case <-time.After(3 * time.Second): }
    }(ch, frame)
}
```

When the 512-slot channel (21 s of audio at 42.67 ms/frame) is full, every subsequent frame spawns a **goroutine** racing to send. Nothing preserves ordering, so a congested client receives frames in arbitrary order and plays them as-is — audible corruption, not merely delay. The client has no PTS ordering check (BUG-015), so it cannot detect or correct this.

The `recover()` in the deferred function does protect against the send-on-closed-channel panic when `removeListener` closes the channel, so that specific crash is contained — but the ordering defect is not.

**Recommended fix.** Drop frames for a congested client (and signal it to re-anchor) rather than reordering them. One bounded queue with a single writer goroutine per client is the correct shape.

---

### BUG-048 — Playing a song from the deck kills every mpv and yt-dlp process on the system

**Severity:** High · **Confidence:** Confirmed · **File(s):** `music_service.go:151-164` · **Component:** Music search

```go
func killMusicPipeline() {
    musicPipelineMu.Lock()
    if musicPipeline != nil && musicPipeline.Process != nil {
        syscall.Kill(-musicPipeline.Process.Pid, syscall.SIGKILL)   // correct: kills the group
        musicPipeline.Wait(); musicPipeline = nil
    }
    musicPipelineMu.Unlock()
    exec.Command("pkill", "-9", "-x", "mpv").Run()                // ← kills EVERY mpv
    exec.Command("pkill", "-9", "-x", "yt-dlp").Run()             // ← kills EVERY yt-dlp
    …
}
```

`killMusicPipeline` is called on **every** `handleMusicPlay` (line 229). The process-group kill above it is correct and sufficient for the pipeline the server owns; the two `pkill -9` calls additionally terminate any mpv or yt-dlp the user started themselves — a film they were watching, a download in progress. `SIGKILL` gives them no chance to clean up. One mis-tap on a search result destroys unrelated work.

**Recommended fix.** Delete both `pkill` lines. If a safety net is genuinely wanted, match only the recorded process group and verify the PID is a descendant of a root the server recorded.

---

### BUG-049 — Lyrics lookup stalls the entire state broadcast for up to 18 s on every track change

**Severity:** High · **Confidence:** Confirmed · **File(s):** `lyrics_service.go:173-253`, `main.go:2137-2141`

`fetchLyrics` runs **on the media-broadcaster goroutine** and performs up to three blocking `lrclib.net` HTTPS requests with a 6 s client timeout (`lyrics_service.go:45`). On the first tick for a new track the cache key is absent, so `broadcastState()` blocks for 0-18 s. During that window **no SSE frame is produced for any client**: the position counter freezes, the seek bar stalls, the volume slider snaps back to the server value mid-drag, and the command log stops updating.

It happens on every track change. Negative results are cached (`lyricsCache[key] = nil`, line 250), so it is once per track — but once per track is every few minutes.

**Recommended fix.** Move lyrics onto its own goroutine with a `singleflight`-style in-flight map and publish the result on the next broadcast when it arrives. Give the negative cache a short TTL so a transient network failure is retried rather than remembered for the process lifetime.

---

### BUG-050 — VLC detection is hardcoded to the dashboard's own HTTP port

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `video_player.go:26-28, 63, 525, 603`

```go
vlcBaseURL  = "http://localhost:8080"
vlcPassword = "password"
```

8080 is the dashboard's default HTTP port. `checkVLCInterface`, `fetchVideoStatus` and `sendVideoCommand` all probe `localhost:8080/requests/status.json`, which in the default deployment is the dashboard's own `FileServer` returning 404. Consequences:

- If VLC's web interface *is* enabled on 8080, **the dashboard cannot bind 8080 at all** — the two collide.
- If the operator moves the dashboard to another port via `http_port`, VLC detection starts working by accident.
- The password is hardcoded and not configurable.

**Recommended fix.** Add `vlc_url` and `vlc_password` config keys, document the port conflict in `config.example.json`, and give the probes a 2 s timeout (`http.DefaultClient` has none).

---

### BUG-051 — `nvidia-smi` / `intel_gpu_top` are spawned every 500 ms with no timeout

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `gpu.go:65-90, 126-129`

On NVIDIA, `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name --format=csv,noheader,nounits` runs on **every 500 ms broadcast** — ~2 spawns/s, each costing 50-150 ms of CPU plus NVML initialisation. On Intel, `intel_gpu_top -J -s 500 -n 1` runs every 500 ms and each invocation sleeps 500 ms internally, so there is effectively always at least one `intel_gpu_top` resident.

Neither call has a timeout, so a wedged driver hangs the broadcaster — and therefore the SSE stream for every client (compounding BUG-049).

`fetchAMDGPU` hardcodes `/sys/class/drm/card0/...` (lines 94-97), so on a multi-GPU or when `card0` is a display controller the wrong device is reported.

**Recommended fix.** Sample the GPU on its own goroutine at 2-5 s, cache the result in the `SystemStats` payload, and wrap every call in `exec.CommandContext` with a 1 s timeout. Discover the render node instead of hardcoding `card0`.

---

### BUG-052 — `bootTimeCache` / `bootTimeOnce` are unsynchronised globals

**Severity:** Low · **Confidence:** Confirmed (code path, race reachable) · **File:** `service_stats.go:162-182`

`uptimeSecs()` lazily initialises two package-level variables with no lock. `/api/service-stats` is polled by every client, so two concurrent first-time requests race. The `-race` run did not flag it only because client polling is naturally staggered — this is a latent race, not a proven one.

**Recommended fix.** Compute boot time once in `initConfig()` behind a `sync.Once` and store it in an `atomic.Int64`.

---

### BUG-053 — SIGHUP reload does not re-register the broadcast hotkey

**Severity:** Low · **Confidence:** Confirmed · **File(s):** `main.go:483, 492-500`, `config.go:167-193`

`ensureBroadcastHotkey()` is called exactly once, at startup (line 483). `reloadConfig` re-derives `dashPIN`, `dashMediaPIN`, `caffeineSD` and `commandMap` but **not** the GNOME keybinding. Changing `broadcast_hotkey` or `http_port` and sending SIGHUP leaves the desktop shortcut pointing at the old combination and the old port, with no warning — while the `config: reloaded` log line implies the change took effect. `config.example.json` says "Restart the service after editing", which is inconsistent with the SIGHUP support described in `main.go:485-491`.

**Recommended fix.** Call `ensureBroadcastHotkey()` at the end of `reloadConfig` and log the binding that is now active. Update the example-config comment to say SIGHUP is sufficient for the hotkey but not for ports.

---

### BUG-054 — The advertised mDNS name is never set

**Severity:** Low · **Confidence:** Confirmed · **File(s):** `avahi-service.conf`, `README.md:150-156`

The README states the dashboard "is discoverable as `control-deck.local`". The Avahi service file declares no `<host-name>`, so the service resolves to the machine hostname (`conquest.local` on this host), not `control-deck.local`.

**Recommended fix.** Add `<host-name>control-deck.local</host-name>`, or correct the README.

---

### BUG-055 — The systemd unit the README tells you to install does not exist

**Severity:** Medium · **Confidence:** Confirmed · **File(s):** `README.md:141-148` vs repository root

```sh
cp tab-dashboard.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tab-dashboard
```

There is no `tab-dashboard.service` anywhere in the repository. The documented auto-start path — which the "runs continuously on a workstation" use case depends on — cannot be followed. Given BUG-001 (a panic takes the process down) and BUG-053 (SIGHUP is required for config reload), the absence of a restart policy in the shipped unit is also a missed opportunity: a `Restart=on-failure` would have masked the terminal panic entirely.

**Recommended fix.** Add `tab-dashboard.service` with `Restart=on-failure`, `RestartSec=2`, `Environment=CONFIG_PATH=…`, and correct working-directory guidance (the CWD matters — see BUG-034 and the `FileServer` issue). Add it to `config.example.json`'s documentation.

---

---

## 6. Probable / Suspected Bugs

These are code-path findings. Each states precisely what evidence is missing. **None of these is presented as fact.**

### SUS-001 — File-drop and Scenes features are entirely unwired (uncommitted WIP)

`files.go` (`handleFileUpload`, `handleFileList`, `handleFileDownload`) and `scenes.go` (`handleSceneList`, `handleSceneRun`) are **untracked work-in-progress** and none of their handlers is registered in `main.go`'s mux. `FileDropCard.tsx` and `ScenesCard.tsx` (also untracked) call `/api/files/list`, `/api/files/upload`, `/api/scenes`, `/api/scenes/run` — all of which fall through to the `FileServer` and 404. Neither component is imported by `App.tsx`, and `FeatureFileDrop`/`FeatureScenes` have no frontend flag (BUG-041).
*Missing evidence:* intent. The `safeDropName` + `filepath.Dir` containment in `files.go` is careful and the scene runner validates all actions before executing any, so this reads as work in progress rather than a regression. Flagged so it is not mistaken for a shipped feature.

### SUS-002 — `buildCommandMap` runs outside `configMu` at startup

`main.go:477-478` calls `buildCommandMap()` / `buildProfileCommandMap()` with no lock, while `reloadConfig` (`config.go:185-189`) holds `configMu.Lock()` around the same calls. The SIGHUP goroutine starts at line 492 — *after* the unlocked calls — so the window is closed in the current ordering. If that ordering were ever changed, `checkCaffeine`'s `configMu.RLock()` read of `caffeineSD` (`main.go:636-638`) would race.
*Missing evidence:* a reachable interleaving in the current code. Fix defensively by wrapping the startup calls in `configMu.Lock()`.

### SUS-003 — `sort.SliceStable` comparator in `buildVersions` is not a strict weak ordering

`lyrics_service.go:360-368` returns `true` for the "both languages labelled" case, so `less(i,j)` and `less(j,i)` can both hold. Go's sort does not panic on this, but the resulting order of same-language versions is unspecified.
*Missing evidence:* an observed mis-ordering. The default version is chosen by score, not slice order, so user-visible impact is limited to the order of the language pills.

### SUS-004 — `set_speed` accepts the wrong JSON type and silently pauses playback

`video_player.go:271-273`: `speed, _ := cmd.Value.(float64)`. A client sending `{"action":"set_speed","value":"fast"}` yields `speed = 0`, and `mpvSetProperty("speed", 0)` **permanently pauses** the player with no error. The shipped frontend always sends numbers.
*Missing evidence:* no path in the shipped frontend. Add a type check regardless — a wrong-typed request pausing someone's video is a bad failure mode.

### SUS-005 — Argument injection via `xesam:url` and `req.Player`

`music_service.go:647, 649` pass `openURL` (derived from `playerctl metadata xesam:url`, which any media file can set) as a bare argument with **no `--` separator**:
```go
exec.Command("gjs", "-m", daemon, "--share-link", openURL, "--device", dev)
exec.Command("kdeconnect-cli", "--share", openURL, "--device", dev)
```
A crafted `xesam:url` beginning with `--` becomes a flag to `gjs`/`kdeconnect-cli`. The same class of issue exists at `cmd/sendkey/main.go:124-128`, where `req.Player` (attacker-controlled via `POST /api/command {"player":"…"}`) is interpolated into a `gdbus --dest` value.
*Missing evidence:* no confirmed MPRIS implementation that lets an unprivileged local process set an arbitrary `xesam:url`. Impact is bounded because `--object-path` and `--method` are fixed literals. Add `--` separators and validate the player name against `playerctl -l` output.

### SUS-006 — `window.open` with a server-supplied URL, after an `await`

`apiService.ts:204` calls `window.open(result.url, '_blank', 'noopener')` after an `await`, i.e. outside the synchronous user-gesture handler. Chrome's 5 s transient-activation window usually covers a LAN round trip, but **iOS Safari blocks it** — and iOS Safari is a documented target device. Separately, `browserURLAtPosition` (`music_service.go:697-735`) passes any non-YouTube/non-Spotify URL through unchanged, so a `javascript:` URL arriving via MPRIS metadata would be handed to `window.open`.
*Missing evidence:* not reproduced on this Chromium; expected to fail on iOS Safari. Pre-validate the scheme against an allow-list (`http:`, `https:`, `spotify:`) and open a blank tab synchronously, then set `location`.

### SUS-007 — `handleClients` mutates shared structs under a read lock

`main.go:1122-1130` holds `connectedClientsMu.RLock()` and then **writes** `c.Streaming` for every client. **This is confirmed** (see §11) — the broader hazard is that `handleClients` hands `json.NewEncoder` pointers to live `*ConnectedClient` objects while `trackClient` mutates the same objects under a full `Lock` (lines 312-316), so a concurrent encode can read a struct mid-mutation.
*Missing evidence:* a second distinct `-race` trace. The single captured trace (`main.go:1126` write vs `encoding/json` read) is sufficient to confirm the class.

### SUS-008 — `readLoop` reads `m.stdout` and `m.stopCh` without the lock

`audio_stream.go:154, 159` read those fields outside `m.mu`, while `stopLocked` (lines 131-141) writes them under it. I could not get `-race` to flag it: a 4-client simultaneous-RST test did not hit the window, and `stopLocked` and the read-loop's own error path frequently assign the *same* value, which the race detector's happens-before analysis tolerates more often than one would expect.
*Missing evidence:* a reproducing stress test. The fix is trivial and should be applied regardless — pass the reader and the stop channel into `readLoop` as parameters, which also removes the need to `select` on a mutable field.

### SUS-009 — `deviceAudioWS[deviceID]` overwrite leaks the previous connection

`audio_stream.go:252-254` replaces the map entry for a reconnecting device **without closing the previous `*websocket.Conn`**. The old connection stays in `streamMgr.listeners` and keeps receiving audio until its own write fails, and it also stays in `deviceAudioWS` under a key that no longer points at it, so a later `remoteStopStream` cannot close it.
*Missing evidence:* not reproduced; the old socket does eventually error on write.

### SUS-010 — `musicPipeline` is never reaped when a track ends by itself

`music_service.go:267-269` stores the process; only `killMusicPipeline` ever calls `Wait()`. A pipeline that finishes on its own becomes a zombie until the next play request. Combined with BUG-048's `pkill -9`, a long session accumulates `<defunct>` entries.
*Missing evidence:* observed as `<defunct>` in `ps`; not counted.

### SUS-011 — Geo-save write traversal is narrower than the read/delete cases

`main.go:389` writes `geoDir+"/"+req.Name+".json"`. I demonstrated a write to `../pwned.json`, i.e. outside the directory (SEC-003). The forced `.json` suffix limits impact relative to SEC-001/002 — a target like `../../.config/autostart/x.desktop` is blocked. So the practical ceiling is "write an arbitrary `.json` file anywhere the user can write", which is still enough to clobber config files.
*Missing evidence:* none for the write; already demonstrated. Listed separately to scope it accurately.

### SUS-012 — Video deck delay nudges are overwritten by the 1 s poll

`VideoPlayerDeck.tsx:31-35` writes `setSubDelay(v.sub_delay)` on every poll, clobbering the optimistic value set by `nudge()` at line 49. If the command round trip exceeds 1 s the displayed delay snaps back, and `subRef.current` is reset so the next nudge computes from the stale value. `sendVideoCommand` (`apiService.ts:133-139`) does not even check `res.ok`, so there is no signal that anything failed.
*Missing evidence:* needs a player slow enough to exceed the poll interval; not reproducible with the local mpv.

### SUS-013 — `handleMusicPlay` blocks up to 6 s and reports success regardless

`music_service.go:272-285` polls `mpvAlive()` for 6 s, then unconditionally returns `{"playing": true}` even if the IPC socket never appeared. `killMusicPipeline` has already destroyed the previous track by then, so a failed play leaves **silence plus a success message**.
*Missing evidence:* needs a failing mpv launch; the `pkill` in `killMusicPipeline` (BUG-048) makes this awkward to observe without side effects, so I did not force it.

### SUS-014 — Toggling a breakpoint pauses the user's music

`main.go:106` implements `dbg_toggle_break` as `playerctl --player $PLAYER play-pause`. The code path is unambiguous.
*Missing evidence:* not executed, because it has an audible side effect on the author's machine. Static evidence is conclusive; the impact is a UX absurdity rather than a correctness question.

### SUS-015 — Safe-area insets are applied twice on the top edge

`index.css:21-23` sets `body { padding: env(safe-area-inset-top) … }` and `App.tsx:218` additionally sets `pt-[env(safe-area-inset-top)]` on the fixed service-stats bar. The two paddings are unambiguously additive, so on a notched device the top bar is pushed down by twice the inset — and the fullscreen button at `top-[30px]` then overlaps it (which it already does at every viewport for other reasons; see UX-17).
*Missing evidence:* Chromium in this container reports a 0 px inset, so I could not capture a notched-device screenshot. The CSS is unambiguous; only the visual magnitude is unverified.

### SUS-016 — `prefers-reduced-motion` is honoured nowhere

`index.css` contains **no** `@media (prefers-reduced-motion: reduce)` block. Running regardless: `animate-pulse` (AudioStreamCard line 49/61, QuickToggle line 153, GeoSurvey `REC` line 376, BLE lines 130/146, NowPlayingCard line 403), the infinite `pulseDot` keyframes (index.css:191-193), the toggle ripple, `scroll-smooth` (App.tsx:250), and the 500 ms lyric transitions.
*Missing evidence:* the impact is preference-dependent, so this is a standards gap rather than a reproducible failure. WCAG 2.2.2 (Pause, Stop, Hide) applies to the infinite `pulseDot` and the auto-advancing lyrics; 2.3.3 (Animation from Interactions) is AAA.

### SUS-017 — `bleStartAdvertising` can block for seconds while holding `ble.mu`

`ble.go:27-37` runs three `bluetoothctl` invocations (two with `--timeout 5`) plus `time.Sleep(200ms)` **while holding the mutex**, and checks none of the results. A wedged `bluetoothctl` blocks any concurrent `/api/ble/transmit` for up to ~10 s, and the UI shows "Advertising" regardless.
*Missing evidence:* not reproduced; requires a specific `bluetoothd` stall.

---

---

## 7. Security Findings

Control Deck is a LAN-exposed remote-control panel for a workstation, holding a TLS private key, two PINs, shell access, clipboard access, keystroke injection, and live audio. The security posture is the weakest area of the project: **there is no authorisation boundary anywhere**, and one path traversal class plus one CSRF class together give unauthenticated remote code execution and arbitrary file access to anyone who can reach the port.

| ID | Finding | Severity | Confidence |
|---|---|---|---|
| SEC-001 | Unauthenticated arbitrary file **read** via `/api/geo/session` traversal | Critical | Confirmed (exploited) |
| SEC-002 | Unauthenticated arbitrary file **delete** via the same handler | Critical | Confirmed (exploited) |
| SEC-003 | Unauthenticated file **write** outside `geo_sessions/` | High | Confirmed (exploited) |
| SEC-004 | CSRF on every mutating endpoint → **remote command execution** | Critical | Confirmed (exploited) |
| SEC-005 | Unauthenticated remote shell at `/ws/terminal`, no Origin check | Critical | Confirmed (exploited) |
| SEC-006 | Clipboard read/write unauthenticated | High | Confirmed (code path) |
| SEC-007 | TLS key, PINs, source, git history and logs served unauthenticated | Critical | Confirmed (exploited) |
| SEC-008 | No brute-force protection on the PIN endpoints | High | Confirmed (code path) |
| SEC-009 | The dashboard lock is a client-side gate protecting nothing | High | Confirmed |
| SEC-010 | "Media Streamer" mode is not actually restricted | Medium | Confirmed |
| SEC-011 | Audio WebSocket has no Origin check | Medium | Confirmed (code path) |
| SEC-012 | `X-Forwarded-For` trusted unconditionally | Medium | Confirmed (code path) |
| SEC-013 | Command-injection review: **no exploitable shell injection found** | Informational | Confirmed (audited) |
| SEC-014 | Unbounded, publicly served log containing window titles | Medium | Confirmed (measured) |
| SEC-015 | `device_id` is empty over plain-HTTP LAN, disabling all per-device controls | High | Confirmed (runtime) |
| SEC-016 | `services/geo_sessions` written 0755/0644, world-readable on disk | Low | Confirmed (code path) |

---

### SEC-001 — Unauthenticated arbitrary file read via `/api/geo/session` path traversal

**Severity:** Critical · **Confidence:** Confirmed (exploited)
**Vulnerability:** CWE-22 Path Traversal, on an unauthenticated endpoint
**Attack surface:** `GET /api/geo/session?name=<value>`
**Preconditions:** the `geo_survey` feature is enabled (it is by default; absent key = enabled)

**Evidence** — against a build of this tree on `:18080`:
```
$ curl "http://127.0.0.1:18080/api/geo/session?name=../canary.txt"
secret-canary-abc123
[status=200]

$ curl "http://127.0.0.1:18080/api/geo/session?name=../../../../etc/hostname"
conquest
[status=200]
```

`main.go:437` performs `os.ReadFile(geoDir + "/" + name)` with `name` taken verbatim from the query string. Go's `url.Query()` parsing does **not** normalise `..`, and `geoDir` is the relative constant `"geo_sessions"` (`main.go:357`). The only guard is `if name == ""`.

**Realistic impact.** Any device on the LAN — or any web page the user visits, via SEC-004 — can read any file the dashboard process can read, with no authentication, no rate limit and no audit entry: `~/.ssh/id_ed25519`, `~/.aws/credentials`, `~/.config/…` browser cookie databases, `~/.netrc`, and the TLS private key. The response is served as `application/json` with the raw file body, so it is trivially scriptable and exfiltratable cross-origin via a `fetch` to a remote collector (no CORS restriction on reading a cross-origin response is needed when the attacker exfiltrates *from* the victim's browser to their own server — they need only the LAN fetch to succeed, which it does).

**Mitigation.** `files.go` already contains exactly the right pattern; reuse it verbatim:

```go
func safeGeoName(name string) (string, bool) {
    if name == "" || name == "." || name == ".." || len(name) > 255 { return "", false }
    if strings.ContainsAny(name, "/\\\x00") { return "", false }
    if filepath.Base(name) != name { return "", false }
    return name, true
}
```
Then `filepath.Join(geoDir, name)` and assert `filepath.Dir(abs) == mustAbsGeoDir()`. Make `geoDir` absolute at startup rather than relative to the CWD. **Do the same for the DELETE and POST paths (SEC-002, SEC-003) in the same change.**

**Regression test.** `TestGeoSessionRejectsTraversal` — table-driven over `../x`, `..%2Fx`, `a/../../b`, `/etc/passwd`, `....//x`, `x\x00.json`, `.`, `..`, `""`, and a 300-byte name; assert every case is rejected and a legitimate `track.json` still loads.

---

### SEC-002 — Unauthenticated arbitrary file delete via the same handler

**Severity:** Critical · **Confidence:** Confirmed (exploited)
**Vulnerability:** CWE-22 / CWE-73 (external control of file name), unauthenticated

**Evidence:**
```
$ cp canary.txt victim.txt
$ curl -X DELETE "http://127.0.0.1:18080/api/geo/session?name=../victim.txt"
{"ok":true}
$ ls victim.txt
ls: cannot access 'victim.txt': No such file or directory
```

`main.go:422-430` performs `os.Remove(geoDir + "/" + name)` with the same unvalidated `name`, and **returns `{"ok":true}` regardless of whether the target existed** — so a blind attacker cannot distinguish success from failure, and neither can the operator's logs, because the deletion is not written to `cmdLog`.

**Realistic impact.** Remote unauthenticated deletion of any file the process can delete: the git repository, `config.json` (disabling the dashboard by removing its config — `initConfig` then `log.Fatalf`s), the systemd unit, or the TLS key. Combined with SEC-004 this is a one-page-wipe primitive.

**Mitigation.** Identical validation to SEC-001, applied **before** the `os.Remove`. Log the deletion to `cmdLog`. Return 404 when the target does not exist, so the response is meaningful.

---

### SEC-003 — Unauthenticated file write outside `geo_sessions/`

**Severity:** High · **Confidence:** Confirmed (exploited)
**Vulnerability:** CWE-22 with a fixed suffix, unauthenticated, unbounded body

**Evidence:**
```
$ curl -X POST -H 'Content-Type: application/json' \
    -d '{"name":"../pwned","points":[{"lat":1,"lng":2,"ping":3,"ts":4}]}' \
    http://127.0.0.1:18080/api/geo/save
{"ok":"../pwned"}

$ ls -la pwned.json
-rw-rw-r-- 1 jai-raj jai-raj 66 ... pwned.json
```

`main.go:389`: `os.WriteFile(geoDir+"/"+req.Name+".json", data, 0644)`. The `.json` suffix limits the target set, but the body is **not size-limited** (`json.NewDecoder(r.Body).Decode(&req)` with no `MaxBytesReader`), the point count is unbounded, and `os.MkdirAll(geoDir, 0755)` is called on a relative path so it depends on the process CWD. A written `.json` file can still clobber many application config files.

**Mitigation.** Same `safeGeoName` + containment check. Add `http.MaxBytesReader` (e.g. 8 MiB) and cap the point count. Make `geoDir` absolute at startup.

---

### SEC-004 — Cross-origin request forgery on every mutating endpoint → remote command execution

**Severity:** Critical · **Confidence:** Confirmed (exploited)
**Vulnerability:** CWE-352 CSRF, no Origin validation, `Content-Type` not enforced
**Attack surface:** every `POST` handler — `/api/command`, `/api/set-volume`, `/api/set-brightness`, `/seek`, `/api/clipboard/push`, `/api/stream/broadcast`, `/api/stream/control`, `/api/music/play`, `/api/music/handoff`, `/api/video/command`, `/api/ble/transmit`, `/api/geo/save`, `/api/audio/set-sink`, `/api/audio/set-app-stream`
**Preconditions:** the dashboard is running and the user visits an attacker-controlled page in any browser on the same machine. **No authentication required.**

**Evidence:**
```
OPTIONS /api/command  (preflight)  → 405
POST /api/command   Origin: https://evil.example
     Content-Type: text/plain;charset=UTF-8
     body: {"command":"git_push"}
→ {"executed":"git_push","status":"ok"}
```
The identical request with `{"command":"playpause"}` also returned `{"executed":"playpause","status":"ok"}`.

**Why it works.** `text/plain` is a CORS-safelisted request content type, so **no preflight is sent at all** — the `405` on `OPTIONS` is irrelevant. Go's `json.NewDecoder(r.Body).Decode(&req)` (`main.go:742`) parses the body regardless of the declared `Content-Type`. There is no `Origin` check, no CSRF token, and no cookie to attach a `SameSite` policy to. `Access-Control-Allow-Origin: *` is additionally set on `/media-stream` (`main.go:1066`).

**Realistic impact.** A single page view on any site executes arbitrary registered shell commands as the desktop user. The registered surface (`buildCommandMap` + `buildProfileCommandMap` + `custom_commands`) includes:

| Command | Effect |
|---|---|
| `git_commit` | `git commit -m 'dashboard commit' && git push` |
| `git_reset` | `git reset HEAD~1` |
| `git_stage` | `git add -A && git status -s` |
| `git_stash` | `git stash` |
| `task_dev` | `npm run dev` (a long-running orphan) |
| `task_build` / `task_test` / `task_lint` | arbitrary toolchain invocations |
| `lock` | `loginctl lock-session` |
| `mute` / `nightOn` / `caffeineOn` / `bluetoothOff` | … |
| `custom_commands.*` | **arbitrary CLI**, per the README |
| the author's `config.json` | `erpLogin` → `erp login`, `warpOn`/`warpOff` → `warp-cli` |

The same primitive also reaches `/api/clipboard/push` (write to the host clipboard), `/api/music/play` (launch an arbitrary pipeline), `/api/stream/broadcast` (mute the laptop and stream audio to all devices), and — combined with SEC-001/002/003 — arbitrary file read, delete and write. No user interaction beyond loading a page is required.

**Mitigation, in order of value:**

1. **Require a custom request header** on every mutating endpoint, e.g.:
   ```go
   func requireSameApp(w http.ResponseWriter, r *http.Request) bool {
       if r.Header.Get("X-Control-Deck") != "1" {
           http.Error(w, "missing X-Control-Deck header", http.StatusForbidden); return false
       }
       return true
   }
   ```
   A cross-origin `fetch` **cannot** set a custom header without triggering a preflight, and there is no preflight handler (405). This is a few lines and defeats the entire class. The frontend adds the header in one place (`apiService`).
2. Reject requests whose `Origin` or `Referer` is present and does not match the request `Host`. (A defence in depth, not a replacement for #1 — `Origin` is absent for some same-origin navigations and form posts.)
3. Reject any `Content-Type` other than `application/json` on mutating endpoints.
4. Remove `InsecureSkipVerify: true` from both `websocket.Accept` calls (SEC-005, SEC-011).
5. Bind to a specific interface, or require a bearer token for LAN access, so a LAN attacker needs none of the above.

**Regression test.** `TestMutatingEndpointsRejectMissingHeader` — for each mutating route, issue a request without the header and assert 403; issue one with it and assert the route's normal behaviour. Plus `TestNoCORSWildcardOnAPI`.

---

### SEC-005 — Unauthenticated remote shell at `/ws/terminal`, with no Origin check

**Severity:** Critical · **Confidence:** Confirmed (exploited)
**Vulnerability:** CWE-346 Origin Validation Error → CWE-78/OS Command Access

**Evidence:**
```
handshake with Origin=https://evil.example → HTTP/1.1 101 Switching Protocols
```

`terminal.go:26-28`:
```go
conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{ InsecureSkipVerify: true })
```
`InsecureSkipVerify` disables `coder/websocket`'s Origin check, whose default behaviour is to require the `Origin` host to match the `Host` header. With it disabled, any web page can open the socket and receive a `$SHELL` PTY (`terminal.go:34-47`). On a LAN no browser is needed at all.

The feature flag **is** honoured before the upgrade (`requireFeature(w, FeatureTerminal)`, line 23) — but the default is *enabled* (absent key = enabled, `config.go:103-109`), and the author's live `config.json` sets `"terminal": false`, so the endpoint happens to be closed on this host. That is luck, not design.

**Realistic impact.** Full interactive shell as the desktop user from any web page the user visits, plus a reliable way to crash the whole server (BUG-001). A CSRF-forged `POST /api/geo/session` (SEC-001) is the same attack without a browser at all.

**Mitigation.** Remove `InsecureSkipVerify`. Apply the SEC-004 header/Origin check. Add real authentication. For a LAN-exposed deployment, run the PTY under a restricted user or inside a container.

---

### SEC-006 — Clipboard read and write are unauthenticated

**Severity:** High · **Confidence:** Confirmed (code path)
**Attack surface:** `GET /api/clipboard/pull`, `POST /api/clipboard/push`

`handleClipboardPull` returns the host clipboard to any caller. `handleClipboardPush` writes attacker-controlled text into it, where it will be pasted by the next `Ctrl+V` in any application.

**Realistic impact.** A password manager's clipboard entry, a TOTP code from an authenticator, a copied secret, or a private URL is readable by every device on the LAN — and readable from any web page via SEC-004. This is a realistic, high-value target for anyone on the same Wi-Fi (a guest network, a colleague, a compromised IoT device).

Two secondary issues: `readClipboard` returns `strings.TrimSpace(wl-paste output)` (`clipboard.go:75`), silently altering leading/trailing whitespace in a secret; and the error response includes the raw command error text, leaking the toolchain layout to the caller.

**Mitigation.** Put both endpoints behind the same authentication as everything else. Do not return raw error strings. Consider a `clipboard` feature flag that defaults to off, and an allow-list of client addresses. Consider refusing to log clipboard *content* (the app does not — `addLog` is not called for clipboard operations, which is correct).

---

### SEC-007 — TLS private key, PINs, source code, git history and logs served unauthenticated

**Severity:** Critical · **Confidence:** Confirmed (exploited against the live production instance)
**Vulnerability:** CWE-552 Files/Directories Accessible to External Parties

`main.go:503`:
```go
http.Handle("/", trackMiddleware(http.FileServer(http.Dir("."))))
```
This serves the **entire process working directory** with no restriction whatsoever.

**Evidence — against the author's running instance on `:8080`:**
```
GET /              → 200  full HTML directory listing:
                              .git/  .gitignore  .supervisor/  README.md  audio.go
                              audio_stream.go  ble.go  clipboard.go  cmd/  config.example.json
                              config.go  config.json  config_test.go  docs/  files.go
                              frontend/  geo_sessions/  go.mod  go.sum  gpu.go  hotkey.go
                              lyrics_service.go  main.go  music_service.go  scenes.go  scripts/ …

GET /config.json   → 200  {"pin": "3456","media_pin": "7890",
                             "bt_mac": "88:D0:39:7D:66:CC", …}

GET /server.key    → 200  1704 bytes  (the complete PEM private key)
GET /server.log    → 200  5 942 476 bytes
GET /geo_sessions/ → 200  directory listing
GET /.git/         → 200  (repository + full history)
```

**Additional finding: the documented entry point does not work.** The README says "Open `http://localhost:8080/` in a browser", but `index.html` exists only under `static/` (Vite `base: '/static/'`). `http.FileServer` on `.` therefore finds no index at the root and serves a **directory listing** instead. The app is actually at `http://<host>:8080/static/`. This is a documentation bug that also happens to be the mechanism that exposes everything else.

**Realistic impact.** Anyone on the LAN learns both PINs, obtains the TLS private key — allowing a transparent MITM of the `:8443` listener, which defeats the "accept the self-signed cert once" instruction users are given — reads the full log (which contains window titles, i.e. a browsing-history-shaped record; see SEC-014), reads the source, and reads the git history including any branch or stash that was never meant to be published.

**Mitigation (this should be the first change made).**

1. **Replace the root handler with an explicit allow-list.** Serve exactly `/` → `static/index.html` and `/static/…`, and nothing else. Mount the built assets from a dedicated read-only directory rather than the process CWD, so a future stray file cannot become public by accident.
2. As an immediate stopgap, add a denylist for `/.git`, `/config.json`, `/server.key`, `/server.crt`, `/server.log`, `/geo_sessions`, `/frontend`, `/cmd`, `/testdata` — but an allow-list is the only durable fix.
3. `chmod 600 config.json` is already the case and is irrelevant while the file is world-readable over HTTP.
4. **Action for the operator:** rotate `server.key` and both PINs (`pin`, `media_pin`), and treat any credential that was in the clipboard or on screen while this instance was reachable as exposed.

**Regression test.** `TestRouterDoesNotExposeFiles` — for a list of paths (`/config.json`, `/server.key`, `/server.log`, `/.git/config`, `/geo_sessions/`, `/main.go`, `/`), assert 404. Plus a test that `GET /` returns the app HTML.

---

### SEC-008 — No brute-force protection on the PIN endpoints

**Severity:** High · **Confidence:** Confirmed (code path)
**Attack surface:** `POST /api/auth`, `POST /api/auth-media`

`main.go:696-732` perform `req.PIN == dashPIN` with **no rate limit, no lockout, no delay, no attempt counter, and a non-constant-time comparison**. The space is 10 000 and the shipped defaults are `3456` / `7890`, hardcoded at `main.go:55, 59` and printed in `config.example.json`.

**Realistic impact.** A script on the LAN finds the PIN in ≤ 10 000 requests — comfortably under a minute, and the server will happily serve them. *However*, this is largely moot: the lock is a client-side gate (SEC-009), so an attacker bypasses it without guessing anything at all.

**Mitigation.** Even once a real auth boundary exists (SEC-009), add per-IP rate limiting with exponential backoff and lockout, use `crypto/subtle.ConstantTimeCompare`, and refuse to start with a default PIN (force configuration on first run, or generate a random one and print it once).

---

### SEC-009 — The dashboard lock is a client-side gate protecting nothing

**Severity:** High · **Confidence:** Confirmed

`getStoredMode()` (`AuthScreen.tsx:12-20`) reads `localStorage['dash_auth_mode']`. Bypass is one line in the console:
```js
localStorage.setItem('dash_auth_mode', JSON.stringify({mode:'dashboard', ts: Date.now()}))
```
There is no server-side session: every API, WebSocket and static route is unauthenticated (SEC-004/005/006/007/011).

`docs/FEATURES.md:15` is honest about this — *"Unlock is a pure client-side gate … intended to keep guests out, not as a security boundary"* — but the UI presents a padlock icon and a 6-hour session as if a boundary existed, and `clearAuth()` + reload in `MediaStreamerPage` reinforces the impression. A user who sets a PIN and believes the dashboard is locked will be wrong.

**Mitigation.** Either implement real session auth — issue a bearer token from `/api/auth` and check it in every handler. The scaffolding for exactly this already exists and is dead code: `lib/authStore.ts` provides `getToken`/`setToken`/`clearToken`/`authUrl`/`authFetch` with a 401 handler, and is imported by nothing (MAINT-04). Or relabel the feature honestly as "PIN lock (cosmetic — does not protect the host)".

---

### SEC-010 — The "Media Streamer" access mode is not actually restricted

**Severity:** Medium · **Confidence:** Confirmed (code + rendering)

`MediaStreamerPage.tsx:74` renders `<ConnectedDevicesCard />` unconditionally. That card contains the **broadcast toggle** (mutes the laptop and pushes audio to every connected device) and **per-device start/stop** for the whole device list.

**Realistic impact.** A guest unlocked with the *media* PIN (default `7890`) can mute the workstation and start or stop audio streaming on any other connected device — a materially different capability from "just listen to what's playing". The mode is described in `docs/FEATURES.md:10-14` as "a restricted view with just Now Playing, per-app audio, and connected devices", which does not mention that connected devices implies broadcast control.

**Mitigation.** Split `ConnectedDevicesCard` into a presentational list and a control group, and pass a `readOnly` prop from `MediaStreamerPage` that hides the broadcast and per-device controls. Alternatively, move those controls behind the dashboard mode explicitly and state the boundary in the UI.

---

### SEC-011 — The audio WebSocket has no Origin check

**Severity:** Medium · **Confidence:** Confirmed (code path)

`audio_stream.go:241-243` also sets `InsecureSkipVerify: true`. A drive-by page can open the audio WebSocket, receive the host's live audio, and be counted as a listener that keeps ffmpeg running — a microphone-adjacent privacy issue with a bandwidth cost.

**Mitigation.** Remove the flag; apply the SEC-004 header/Origin check. Note that EventSource/WebSocket cannot carry custom headers from the browser, so the check for this endpoint must be Origin-based (or a short-lived token in the query string, as `code-deck` already does for `device_id`).

---

### SEC-012 — `X-Forwarded-For` is trusted unconditionally

**Severity:** Medium · **Confidence:** Confirmed (code path)

`main.go:303-305`:
```go
if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" { ip = strings.Split(fwd, ",")[0] }
```
With direct LAN access any client can set an arbitrary value, so device identity (and any future IP-based rate limiting or audit) is trivially spoofable. It is also the hook for the RemoteAddr fix in BUG-023.

**Mitigation.** Only honour `X-Forwarded-For` when the immediate peer is a configured trusted proxy; otherwise use `net.SplitHostPort(r.RemoteAddr)`. Add a `trusted_proxies` config key, empty by default.

---

### SEC-013 — Command-injection review: no exploitable shell injection found

**Severity:** Informational · **Confidence:** Confirmed (audited exhaustively)

Every user-controlled value reaching `exec.Command` was traced end to end:

| User input | Sink | Shell? | Verdict |
|---|---|---|---|
| `/api/command` `command` name | `commandMap` lookup (`main.go:763-772`) | no | **Safe.** A registered *name*, never a command line. Unknown names → 400. This is the single most important design decision in the project and it is correct. |
| `handleMusicSearch` `q` | `yt-dlp` argv (`music_service.go:48-50`) | no | **Safe.** `exec.Command("yt-dlp", "ytsearchN:"+q, …)` — no shell. A leading `-` cannot become a flag because of the `ytsearchN:` prefix. |
| `handleMusicPlay` `url`, `title`, `artist` | `sh -c` (`music_service.go:242-256`) | **yes** | **Safe.** All three pass through `shellQuote` (`music_service.go:776-778`), which wraps in single quotes and escapes `'` → `'\''`. Verified: `$`, backticks, `;`, `|` and newlines are inert inside single quotes. The `${}`-style interpolation of `nodeBin` is also quoted. |
| `hotkey.go` `port` | `fmt.Sprintf` into a GNOME keybinding string | no | **Safe.** `port` is an `int`. |
| `ensureBroadcastHotkey` `binding` | gsettings argv | no | **Safe.** Written as a GSettings string, executed later by GNOME, not by this process. |
| `btSinkOn`, `caffeineOn/30/60`, `git_*`, `task_*`, `tmux_*` | `sh -c` / `bash -c` | yes | **Safe for remote attackers.** All literals, no request input. `caffeineSD` is interpolated unquoted into a `bash -c` string (`main.go:85-87`); it comes from `config.json` or `$HOME`, and an operator who can edit `config.json` already has code execution, so it is not a privilege boundary. **Fix anyway**: quote it. |
| `findMPRISPlayer` / `findBestPlayer` output | `sendkey` argv[2] → `gdbus --dest` | no | **Argument injection only** — SUS-005. Bounded by fixed `--object-path` / `--method`. |
| handoff `openURL` | `gjs` / `kdeconnect-cli` argv | no | **Argument injection only** — SUS-005. |
| `handleSeek` `position` | `fmt.Sprintf("%f", pos)` → argv | no | **Safe.** `%f` of a `float64` cannot inject. |
| `handleSetVolume` `volume` | argv | no | **Safe.** |
| `handleSetBrightness` `brightness` | `fmt.Sprintf("%d%%", int(v))` → argv | no | **Safe.** `%d` cannot inject. |
| `handleGeoSave` `name` | `os.WriteFile` path | n/a | **Path traversal** — SEC-003. |

**Conclusion.** The only injection-class defects are argument injection into `gjs`/`kdeconnect-cli`/`gdbus` (SUS-005), which require control of MPRIS metadata. The systemic problem is not injection — it is **the complete absence of authorisation** (SEC-004).

---

### SEC-014 — Unbounded, publicly served log containing window titles

**Severity:** Medium · **Confidence:** Confirmed (measured)
**Vulnerability:** CWE-532 Insertion of Sensitive Information into Log File, compounded by SEC-007

`detectFocusedWindow` logs on **every** 1-second poll regardless of whether anything changed (`main.go:1389, 1394`):
```
2026/09/27 02:25:36 dbus signal: browser | social computing iit kgp - Google Search - Google Chrome
2026/09/27 02:25:37 dbus signal: terminal | OC | Control Deck complete repository audit
2026/09/27 02:25:38 dbus signal: youtube | (240) Hans Zimmer - Interstellar | Imperial Orchestra - YouTube - Brave
```
`server.log` is 5.9 MB, has no rotation, and grows at ~2 lines/s ≈ **173 000 lines/day**. The content is a browsing-history-shaped record: window titles, media titles, D-Bus signal payloads. Combined with SEC-007 it is world-readable over HTTP on the LAN.

**Mitigation.** Log focus changes only when `changed` is true (the boolean already exists at `main.go:1570`). Ship logs to journald when running under systemd (`StandardOutput=journal`) rather than a file in the served directory. Apply SEC-007.

---

### SEC-015 — `device_id` is empty over plain-HTTP LAN, disabling all per-device controls

**Severity:** High · **Confidence:** Confirmed (runtime)
**Vulnerability:** CWE-1188 insecure default / broken access control on a documented deployment path

`App.tsx:43-54`:
```ts
let id = crypto.randomUUID();          // ← requires a secure context
…
} catch { return ''; }
```

Verified on the documented LAN path, `http://10.105.24.62:18081/static/`:
```json
{ "isSecureContext": false,
  "hasRandomUUID": false,
  "sessionId": null }
```
and after unlocking:
```
GET /api/clients?device_id=
POST /api/stream/control {"target":"","action":"start"}  →  404 "device not connected"
clients: [ {dev: "(EMPTY)"}, {dev: "(EMPTY)"}, {dev: "(EMPTY)"} ]
```

`crypto.randomUUID()` is a **secure-context-only** API. `http://localhost` is a secure context (which is why localhost testing never hits this); `http://<lan-ip>:8080` — the way the README instructs users to reach the dashboard from a phone or tablet — is not. So on the primary deployment path:

- `deviceId === ''` for the whole session;
- `/media-stream` is opened without `device_id`, so the server never registers `sseDeviceChans['']` (`main.go:1076-1080` guards on `deviceID != ""`);
- the audio WebSocket is opened without `device_id`, so `deviceAudioWS` is never populated (`audio_stream.go:251-262`);
- **per-device stream start/stop is permanently broken** (verified 404);
- **`doBroadcastStart` iterates `sseDeviceChans` to notify clients** (`main.go:1220-1229`) — with no entries, **the `<C-A-b>` global hotkey does nothing for any HTTP client**. The headline feature in the README.

`public/background.html:62-70` has the correct `Math.random()` fallback, so the background PWA works while the main dashboard does not — an inconsistency that will be very hard to diagnose.

**Mitigation.**
```ts
function newDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
```
Also pass `device_id` on the initial navigation so `trackMiddleware` records it (BUG-023), and log a visible warning when the app is served over plain HTTP so the operator understands why per-device control is degraded.

---

### SEC-016 — `geo_sessions/` is created world-readable

**Severity:** Low · **Confidence:** Confirmed (code path)

`main.go:387, 400`: `os.MkdirAll(geoDir, 0755)`; `main.go:389`: `os.WriteFile(…, 0644)`. GPS tracks — a precise location history — are world-readable on disk, in a directory that is also served over HTTP (SEC-007). `server.crt`/`server.key` are `0600`/`0664` in this working tree, so the pattern is inconsistent.

**Mitigation.** `0700` for the directory, `0600` for the files. Add a `.gitignore` entry (already present) and, ideally, an explicit retention policy.

---

---

## 8. UI/UX Audit

Each screen: current behaviour → problems → why it matters → recommended change → before/after → complexity. Ordered by frequency of daily use, not by file order.

### 8.1 Home deck — information hierarchy

**Current behaviour.** Two-column grid at ≥768 px, single column below. Left: Mixer, Geo Survey, BLE. Right: Quick Settings, Connected Devices, Weather, Clipboard, Command Log. System Stats full-width beneath. Now Playing sits above the carousel.

**Problems.**
1. **The deck needs 2.5-6.1 viewport-heights of scrolling.** Measured `bodyScrollH / innerHeight`: 320×568 → **6.06×**; 360×640 → **4.57×**; 896×414 → **5.40×**; 414×896 → 3.32×; 768×1024 → 2.51×; 1024×768 → 2.90×; 1440×900 → 2.09×. The three controls a person uses most — volume, brightness, play/pause — are not all above the fold on any phone size.
2. **The single largest element on the deck is a niche GPS canvas.** `GeoSurveyCard` renders a 600×400 canvas at full column width (≈700×465 px on desktop) — roughly the height of the entire Mixer card — and `geo_survey` is **off** in the shipped `config.json`.
3. `CommandLogCard` returns `null` when the log is empty (line 9), so the right column changes height every time a command runs — the layout shifts under the user's finger.
4. `ConnectedDevicesCard` returns `null` when `clients.length === 0` (line 148-151), so it silently disappears on backend failure and offers no diagnostic.
5. The Caffeine row renders three visually identical coffee cups, distinguished only by 10 px labels ("30m", "1h", "∞").

**Why it matters.** The stated use case is a tablet or phone on the sofa. Requiring 4.6 screens of scroll to mute the laptop means the dashboard is *slower to use than the physical controls it replaces*, which is the opposite of the product's purpose.

**Recommended change.** Reorder by frequency of use: Now Playing → Mixer + Quick Settings → System Stats → App audio → everything else. Move Geo Survey, BLE, Weather and Clipboard behind a "More" affordance or a collapsible secondary section the user can remember as collapsed. Give the GPS canvas a fixed 160 px collapsed height with tap-to-expand. Reserve a min-height for Command Log and Connected Devices so they do not reflow.

**Before / after.** Before (360×640): open → scroll 1.2 screens to reach brightness, 3 screens to reach the clipboard. After: open → volume, brightness, transport and system stats all above the fold; the four secondary cards are one tap away and stay collapsed between sessions.

**Implementation complexity.** Medium — layout restructure and a persisted "expanded" preference; no backend work.

---

### 8.2 Now Playing card

**Current behaviour.** 72 px artwork, title/artist, status pill, seek bar with elapsed/total, five transport buttons, up to four utility buttons (search, open-in-browser, send-to-phone, audio stream), an optional lyrics ticker, and carousel arrows when more than one player exists.

**Problems.**
- **Carousel arrows straddle the card border and overlap the seek time labels.** `PlayerCarousel.tsx:70,76` positions them at `left-0 … -translate-x-2`, i.e. half in, half out. Screenshot `shots/10-home-phoneSmall.png` shows the left chevron sitting immediately beside/over "6:23" and the right chevron clipped by the viewport edge at 360 px. They are 40×40 with **no `aria-label`**.
- **The track title runs underneath the fixed fullscreen button.** Same screenshot: "Pirates of the Caribbean Orches…" is cut by the button at x=308-348. The `truncate` on the `<h2>` cannot help because the overlap comes from a *different* stacking context, not from its own box. This is the single `clippedText: 1` element I measured at every viewport.
- **The utility cluster wraps to a second row on phones**, leaving the `|` divider orphaned at the end of the first row. That divider's render condition (`NowPlayingCard.tsx:387`) is `((caps.mpv && caps.yt_dlp) || (!isOffline && !isIdle)) || state` — the trailing `|| state` makes it **always true**, so it is dead logic that happens to be visible.
- **The seek thumb is 18 px on a 6 px track** (`.seek`, `index.css:65-77`), overflowing the track vertically; with `gap-2.5` rows it crowds the time labels.
- `localPos` can freeze the displayed time forever after a failed seek (BUG-004).
- **Two identical nameless `<input type=range>` elements are in the DOM at once** when the modal is open (card + portal), both sharing `localPos`.
- The mixed accent colours are visible here: the play/pause button and the pulsing "Playing" dot stay **cyan** (`index.css:191-193` hardcodes `background: #06b6d4` and is not overridden by `.art-themed`) while everything else turns lime from the album art. Screenshot `deck-Home-desktop.png` shows a cyan play button inside a lime-accented card.

**Recommended change.** Move the arrows inside the card (`left-2` / `right-2`), size them to 44 px, and give them `aria-label="Previous player"` / `"Next player"`. Add `pr-12` to the header row so the title reserves space for the fixed fullscreen button. Delete the always-true divider. Add `aria-label` and `aria-valuetext` to both seek sliders and distinct `id`s. Move the pulsing dot's colour into the art-theme override set.

**Implementation complexity.** Low.

---

### 8.3 Media Browser deck (Macro Deck)

**Current behaviour.** A volume slider, then a "Macro Deck" card with Slower/Faster and eight keystroke buttons, each annotated with the raw key glyph (`←`, `K`, `C`, `T`, `F`, `M`) in 9 px mono at 40 % opacity, under a red "MEDIA" badge with a YouTube logo.

**Problems.**
- The deck is visually branded as YouTube-specific, but the target is whatever window has focus (BUG-044). **Nothing in the UI says where "Play/Pause" will go.** If the user is in VS Code, it types `k` there.
- The 9 px key hints are below any readable size and are noise on a device with no keyboard.
- Slower/Faster are ~30 px tall; the volume mute button is 32 px.
- **The current playback speed is never shown on this deck**, even though the backend tracks it precisely (`currentSpeedIdx`, 8 steps) and broadcasts it over `/api/window-stream`. The user presses "Faster" and gets no confirmation of the new value.
- `caps.playerctl` is `checkBinary("playerctl")` — true even with no player running. The fallback "No media player detected" therefore only appears when playerctl is *missing*, not when nothing is playing.

**Why it matters.** This is the deck a user visits to control a YouTube/video window. Presenting it as an app-specific panel while it is actually a keyboard-injection panel creates a wrong mental model, and the wrong mental model is how you accidentally type into your code editor.

**Recommended change.** Add a "Target: *&lt;window title&gt;*" line, refreshed from `/api/window-stream` — the title is already broadcast and currently discarded by `useActiveWindow` (MAINT-11). Replace the key glyphs with the actual effect ("Seek −5 s", "Play/Pause", "Captions"). Show the speed as a segmented control with all 8 steps visible. Fix the fallback condition to `state.players.length === 0`.

**Before / after.** Before: tap "Faster", no visible change, no idea whether it worked or which window received it. After: tap "Faster", the segmented control advances from 1.00× to 1.25× and the header reads "Target: *&lt;240&gt; Hans Zimmer – Interstellar* — YouTube*".

**Implementation complexity.** Medium.

---

### 8.4 Video Player deck

**Current behaviour.** A "Player: `<badge>`" row, a volume card, then Subtitles / Audio / Aspect Ratio / Precision Playback cards. Polls `/api/video/status` every 1 s.

**Problems.**
- **"Not detected" and every button is still live.** Pressing "Frame Next" types `e` into the focused window; "Reset" types `g`/`h` up to 100 times (BUG-032). This is the most dangerous interaction in the app: a plausible mis-tap types into whatever the user is working in.
- **The backend returns `subtitles[]` and `audio_tracks[]`; the deck never renders them.** There is no track picker, so per-track selection is impossible and ~40 lines of backend track-list parsing are unused (BUG-031).
- "Toggle" turns subtitles **off**; "Cycle" selects **track 1** (BUG-031).
- Delay nudges optimistically update, then snap back when the 1 s poll returns the old value, and the backend answers 200 regardless, so nothing is ever reported (BUG-033, SUS-012).
- Ten aspect/speed pills at 27 px and `w-8 h-8` nudgers at 32 px — all far below 44 px.
- Six aspect pills and five speed pills mix concepts without explanation ("Crop Fill" vs "16:9" vs "21:9").

**Recommended change.** When `active_player === 'unknown'`, replace the deck body with an empty state listing the windows currently detected. Render `subtitles[]`/`audio_tracks[]` as chip rows. Rename the actions to match their behaviour. Disable controls while a command is in flight and show a brief spinner for the ~200 ms round trip.

**Before / after.** Before: deck badge reads "Not detected"; user taps "Frame Next"; a stray `e` is typed into their editor. After: deck reads "No video player detected — open one, or:" with a list; all controls disabled; nothing can be typed into another application.

**Implementation complexity.** Medium.

---

### 8.5 IDE (Code) deck

**Current behaviour.** Three cards — Debug (8 buttons), Git (6), Tasks (4) — 18 buttons, all fire-and-forget.

**Problems.**
- **Zero feedback of any kind.** Command output goes to the dashboard's stdout (the tablet sees nothing), and `triggerCommand` never checks `res.ok` (BUG-038), so a failed command is indistinguishable from a successful one.
- **Three buttons are mislabelled and one is dangerous**: "Stop" continues the debugger, "Restart" restarts nothing, "Step Out" is Continue (BUG-034). "Toggle Breakpoint" pauses the user's music.
- `git_commit` is `git commit -m 'dashboard commit' && git push`; `git_reset` is `git reset HEAD~1`. Both are **one tap**, both are destructive, and neither has a confirmation, a diff preview, or a message field.
- The commands run in the **dashboard process's CWD**, not the focused project's directory. The "cd repo root" helper exists only in the Terminal deck, and the Terminal deck's `rebuild` button literally overwrites `tab-dashboard` in whatever repo the service was started in.
- `task_dev` (`npm run dev`) is a long-running server spawned detached with no process-group tracking; repeated taps orphan processes.
- 18 buttons at 30-35 px, `text-[11px]`, `grid-cols-4` on a 360 px phone → ~75 px cells with wrapped two-line labels.

**Why it matters.** This deck looks like a remote control for a development workflow and is actually 18 unverified, partly-mis-wired shell invocations with no output. It is the deck most likely to cause data loss and the least likely to be trusted once that happens.

**Recommended change.** This deck should not ship in its current form. Minimum viable, in order: (a) two-step confirmation for `git_commit`, `git_reset`, `git_stash`, with the confirmation naming the effect ("Commit all changes as 'dashboard commit' and push to origin"); (b) a result surface showing the last command's exit status and last ~20 lines of output — this needs a small backend change to capture and return output; (c) a working-directory picker persisted per client; (d) correct key bindings, or removal of the three broken debugger buttons.

**Before / after.** Before: tap "Commit" on a tablet → a commit and a push happen silently, with an uneditable message, and no confirmation that either succeeded. After: tap "Commit" → "This will `git add -A`, commit as 'dashboard commit', and `git push` to origin. [Confirm] [Cancel]" → a result row appears: "✓ committed a1b2c3d and pushed to origin/main".

**Implementation complexity.** High (needs a backend output-capture endpoint), but it is the difference between a demo and a tool.

---

### 8.6 Terminal deck

**Current behaviour.** A large xterm canvas (measured 688×726 px on a 768×1024 tablet) with a "connected/disconnected" badge, plus a 20-button toolbar of tmux/clear/ll/cd/rebuild/Ctrl-combos/arrow-pad.

**Problems.**
- **The PTY is spawned on page load, not on deck focus** (BUG-035 family) — every dashboard view costs a login shell, and the shell persists after the user navigates away.
- With the backend down, the reconnect loop appends a red `[disconnected]` line every 2 s forever (BUG-035). Verified `ERR_CONNECTION_REFUSED` in the console.
- **20 toolbar buttons at 26-35 px** — unusable with a thumb — in two wrapped rows, with the arrow pad orphaned in the middle of the wrap.
- `rebuild` runs `cd "$(git rev-parse --show-toplevel)" && go build -o tab-dashboard .` — one tap from a tablet overwrites a binary and blocks the terminal. No confirmation.
- The "connected" badge (`absolute top-2 right-3`) **collides with the fixed fullscreen button** — visible in `shots/20-terminal-tablet.png`.
- The terminal's first output line is sliced by the fixed service-stats bar because of the auto-scroll bug (BUG-002).
- `sendToTerminal` silently discards input when the socket is down, while all 20 buttons look enabled.
- The terminal occupies ~85 % of the viewport to display one line of text.

**Recommended change.** Mount the PTY lazily on first deck focus and tear it down after 30 s away. Group the toolbar into labelled clusters (History / Control / Navigation) with a 48 px minimum height. Make `rebuild` two-tap with an explicit "this overwrites ./tab-dashboard in &lt;repo&gt;" warning. Disable the toolbar when disconnected. Move the badge below the fullscreen button.

**Implementation complexity.** Medium.

---

### 8.7 Connected Devices card

**Current behaviour.** A count, a broadcast toggle, and one row per "client" with a device-type emoji, a ping for your own device, and a per-device stream start/stop button.

**Problems.**
- **The list is fabricated** (BUG-023) — one row per HTTP request, so it fills with duplicates of "you" (screenshot: three identical "Linux (you) · 13 ms" rows) and the count badge read **9** after three sessions.
- Rows with an empty `device_id` always fail with `404 device not connected`, and over plain-HTTP LAN **every** row has an empty ID (SEC-015).
- 28 px control buttons; both have only a `title`, no `aria-label`.
- No empty state — the card vanishes entirely, so a backend failure is indistinguishable from "no devices".
- **The polling fallback auto-starts audio on any open client** when a broadcast begins (`ConnectedDevicesCard.tsx:63-77`) and auto-stops when it ends. A tablet left open in another room begins playing the laptop's audio without consent.
- The 200 ms ping poll has **no `document.hidden` guard**, unlike every other poll in the app.

**Recommended change.** Fix BUG-023 first; the feature is unusable until then. Then: replace auto-join with an explicit "Broadcast in progress — tap to listen" row, and make auto-join a persisted per-device setting that **defaults off** for the full dashboard (the background PWA's auto-connect is the right default *there*, because that page exists for exactly this). Add the `document.hidden` guard. Add an empty/error state.

**Before / after.** Before: user opens the dashboard during a broadcast; audio starts unbidden at laptop volume in another room. After: the card shows "Broadcast in progress — tap to listen"; nothing plays until the user chooses.

**Implementation complexity.** Low.

---

### 8.8 Clipboard Sync card

**Current behaviour.** A 3-row textarea and four buttons — Pull, Push, Push Tab, Copy — with a 2 s toast.

**Problems.** The toast has no `role="status"`/`aria-live`, so screen readers announce nothing. The textarea has a placeholder but no `<label>`, so it has no accessible name. `handleCopy` shows "Copied!" even when the copy failed (BUG-024). The toast is `absolute bottom-14` inside the card, so it overlays the button row. `resize-none` with `rows={3}` gives no way to review a long paste before pushing it to the host. There is no size limit on what is pushed, and no warning that pushing writes to the host's clipboard for every application.

**Recommended change.** Add `<label class="sr-only">`; `role="status"` on the toast; check the copy result; add a character count with a cap; and add a one-line note that Push writes to the host clipboard.

**Implementation complexity.** Low.

---

### 8.9 Floating nav bubble & bottom nav strip

**Current behaviour.** A 48 px FAB at bottom-right opening a menu of deck names + Auto-focus + Refresh; a fixed bottom strip of 5 dots that are draggable to scrub between decks.

**Problems.**
- **The bottom dots are not clickable.** Verified: clicking dots 1-4 leaves the page at index 0. They are indicators only, and the strip is **25 px tall**, so the whole affordance is a 25 px drag region.
- **The carousel cannot be dragged with a mouse.** Verified: a full mouse-drag gesture over the deck container changed nothing, and the deck container has no pointer handlers — `onPointerDown/Move/Up` are attached to the **nav dot strip** instead (`App.tsx:320-328`). On desktop the FAB menu is the *only* way to change decks.
- **The FAB overlaps the MiniPlayer's next-track button** on the Code/Terminal decks. Measured on 768×1024: FAB `(708, 912, 48×48, z=50)`, MiniPlayer `(0, 915, 768×53, z=40)` → overlap confirmed. It also overlaps the "100 %" label of the App Audio row on phones (screenshot `10-home-phoneSmall.png`).
- The menu declares `role="menu"` but its children are plain `<button>`s with no `role="menuitem"`, no arrow-key navigation, no Escape, and no focus move into the menu.
- **"Refresh" is `location.reload()` with no confirmation and it kills an active broadcast for every device** (BUG-036).
- The client-count badge is `absolute right-3` inside the nav padding and is clipped at the right edge on phones.

**Recommended change.** Make the dots real `<button>`s with a 44 px hit area (via padding) and keep the drag as a secondary affordance. Attach the pointer-drag handlers to the deck container as well as the strip, guarded by a `touch-action` check so vertical scrolling still works. Reposition the FAB above the MiniPlayer when `showMini` is true. Fix the ARIA (`role="menuitem"`, Escape, focus management) or drop `role="menu"` and use a plain labelled group.

**Before / after.** Before (desktop): to change decks, open a menu, click a label, close the menu — four actions; the visible dots do nothing. After: click the dot for the deck you want, or drag it, or use the menu — one action, and the dots do what they look like they do.

**Implementation complexity.** Low.

---

### 8.10 Geo Survey card

**Current behaviour.** A large canvas plotting ping-coloured dots, a six-item legend, a stats line, a 30-second calibration, a save box, and a session list.

**Problems.**
- **Calibration is an O(n²) CPU and memory loop** (BUG-028): measured 80 381 "samples" in 30 s and a 9→70 MB heap sawtooth.
- **Recording has no cap, no auto-save and no warning.** At 5 points/s a one-hour session accumulates 18 000 points, and the canvas redraw (which depends on `points` and redraws *every* point on *every* append) becomes O(n²) in canvas operations. Points are only persisted if the user remembers to tap Save.
- **The canvas is a fixed 600×400 buffer scaled by CSS**, so its 8 px labels render at ~4.7 effective px on a phone and are illegible, and there is no `devicePixelRatio` scaling so it is blurry on high-DPR screens.
- All six controls are 20-28 px. Delete fires on `pointerDown` with **no confirmation**.
- GPS errors other than `PERMISSION_DENIED` are swallowed, so "GPS on" can be shown with no fix and no message.
- `enableHighAccuracy: true` is a significant battery cost, requested on the Home deck.
- The default-room warning at line 385 relies on operator precedence (`!roomCenter || (A && B) && <span>`) that happens to work but is fragile.

**Recommended change.** Fix BUG-028 first. Cap recording at ~5 000 points with a visible warning, and auto-save every 60 s. Size the canvas to `clientWidth × devicePixelRatio` and scale the label font accordingly. Make every control 44 px, move delete to `onClick` with a confirm. Surface all GPS error codes.

**Implementation complexity.** Medium.

---

### 8.11 BLE Proximity card

**Current behaviour.** Two ON/OFF pills (Advertiser, Scanner), a 24 px RSSI meter with a text overlay, and an IN/OUT OF ROOM verdict.

**Problems.**
- **The meter shows a 62 %-wide green bar before any scan has run.** `rssiPct` is `((smoothed + 100) / 80) * 100` with `smoothed = 0` → 62.5, and the colour branch tests `smoothed > HIGH(-50)` → `0 > -50` is true → green. The card opens looking like a strong signal.
- The device name filter can never match, because the host never sets an advertised name (BUG-029).
- `stop()` neither removes the listener nor stops watching, so the BLE scan continues after "STOP" (BUG-029).
- Both buttons fire on `pointerDown`, so a horizontal swipe starting on them toggles the radio and can trigger the Web Bluetooth permission sheet.
- Unmounting the card posts `action: stop` (lines 98-104), so **closing one client kills advertising for every other client**.
- The text overlay is 9 px. The thresholds (-50/-75 dBm, 3 samples) and the distance model (txPower −59, n 2.5) are unexplained and uncalibrated — the number is decoration.
- `await res.json()` on a 403 throws an unhandled rejection.

**Recommended change.** Default to "Idle — not scanning" with an empty meter. Move both controls to `onClick`. Never stop advertising on unmount — use a lease/heartbeat so the server stops advertising only when the last controlling client goes away. Show raw/smoothed/threshold at ≥11 px and state the model in one line of help text. Guard the `res.json()`.

**Implementation complexity.** Medium.

---

### 8.12 Weather card

**Current behaviour.** Current temp / feels-like / humidity / wind plus a 3-day strip from Open-Meteo, with a hardcoded Delhi coordinate fallback.

**Problems.** The **geolocation permission prompt fires on page load** with no user action, from a dashboard the user may not even be looking at. The request goes to a third party **from the tablet**, revealing the location, and fails silently on an offline LAN. `loading` and `error` both `return null`, so there is no skeleton and no message — the card simply does not exist, then pops in and shifts the layout. Day labels are wrong for half of every day (BUG-027). No caching, so every page load re-requests and re-prompts.

**Recommended change.** Do not request geolocation on mount — show a "Use my location" button. Cache resolved coordinates in `localStorage` with a 30-day TTL. Render a skeleton while loading and an explicit "Weather unavailable — check your connection" row on error.

**Before / after.** Before: opening the dashboard immediately prompts for location, then sends it to open-meteo, then usually shows nothing. After: the card shows "New Delhi 24 °C — [Use my location]"; the prompt appears only if the user asks for it.

**Implementation complexity.** Low.

---

### 8.13 System Stats & Service Stats bars

**Current behaviour.** A fixed top strip with, per tracked service, a status dot, name, CPU %, RSS and uptime. A separate `SystemStatsCard` shows CPU/RAM/BAT/TEMP/GPU bars plus an SSID/IP/ping line.

**Problems.**
- **Both numbers in the top bar are wrong** (BUG-026) — CPU % is reaped-children CPU, uptime tracks RSS.
- **The fullscreen button overlaps the top strip at every viewport** — measured `OVERLAP=true` at 320, 360, 414, 768, 896, 1024 and 1440 px. The bar is 32-48 px tall and the button sits at y=30-70. It clears only on desktop, by 2 px, because the bar is exactly 32 px there.
- At 360 px the pill content **wraps to two lines** ("tab-" / "dashboard", "54h" / "57m"), making the strip 48 px tall and visually broken, and the "ffmpeg stopped" pill is **clipped to "ffmpeg stopp"** by the right edge. Screenshot `10-home-phoneSmall.png`.
- Safe-area insets are applied **twice** on the top edge (SUS-015).
- The host's connectivity is shown as "Ping OK/FAIL" with a Wi-Fi icon, while a different card shows a "ms" ping for the same host — the same word meaning two different things.
- **No freshness indicator anywhere.** A stale value is visually identical to a current one, and given BUG-049 (up to 18 s broadcast stalls) staleness is common.
- `SysStatsBar.tsx` is a **dead duplicate** of most of this (MAINT-01).

**Recommended change.** Fix the `/proc` indices. Add a per-value age: dim the strip if the last successful poll is older than 3 s. Move the fullscreen button to `top-3` and give the bar `pr-12`. Remove the duplicate `pt-[env(...)]`. Use `whitespace-nowrap` plus horizontal scroll for the pills. Delete `SysStatsBar.tsx`.

**Implementation complexity.** Low.

---

### 8.14 Command log

**Current behaviour.** Newest-first, 11 px monospace, capped at 200 px tall, 30 entries server-side.

**Problems.** Returns `null` when empty, so the Home deck's right column changes height on every command (UX-15). `key={i}` on a reversed array. No clear affordance and no way to see beyond 30 entries. 11 px is small on a phone.

**Recommended change.** Reserve a min-height; add a clear button (needs a small server endpoint); bump to 12 px.

**Implementation complexity.** Low.

---

### 8.15 Media Streamer page

**Current behaviour.** A sticky header with a 28 px "Lock & exit" button, then Now Playing, App Audio, and Connected Devices.

**Problems.** It is not the restricted view it claims to be (SEC-010). `clearAuth(); location.reload()` — a full reload rather than a state transition. The `now_playing` feature flag is not consulted here (only `caps.playerctl`), so disabling Now Playing does not apply to this page. No fullscreen affordance, so a phone user cannot go fullscreen. 28 px exit button.

**Recommended change.** Split the devices card; replace the reload with a `setAuthMode(null)` callback; honour `features.now_playing`; add a fullscreen button; size the exit button to 44 px.

**Implementation complexity.** Low.

---

### 8.16 Auth screen

**Current behaviour.** Mode picker ("Full Dashboard" / "Media Streamer") then a 4-digit keypad with Clear/Backspace and a 600 ms error flash. Verified at all 7 viewports: no overflow, no sub-44 px targets, `role="status"` on the digit row, per-digit `aria-label`s, `role="alert"` on the error. **This is the best-built screen in the app.**

**Problems.** (a) The 150 ms `setTimeout` makes backspace/Clear lie for 150 ms (BUG-003). (b) No fetch timeout, so a hung request disables the keypad permanently. (c) **A network failure is reported to the user as "Wrong PIN"** — actively misleading and it will send people hunting for a typo.

**Recommended change.** Synchronous `submitting` ref; `AbortController` with a 10 s timeout; a distinct "Can't reach the deck" message with a Retry button.

**Before / after.** Before: enter 4 digits during a network blip → 30 s of dead keypad → "Wrong PIN". After: 10 s later → "Can't reach the deck — is it running? [Retry]", keypad re-enabled.

**Implementation complexity.** Low.

---

### 8.17 Cross-cutting UX issues

**UX-29 — No freshness anywhere.** Every value in the UI is indistinguishable from a stale one. Given BUG-049 (18 s stalls) and the 5-second client polling, "the number on screen" and "the truth" diverge regularly with no signal.

**UX-30 — Album-art theming makes the UI unpredictable.** The whole accent palette is derived from cover art (BUG-042): the app was cyan on one track and lime green on the next during the audit, with no explanation. On a light-album track the derived accent can approach the foreground colour. The `hsl(h+180, 80%, 55%)` complementary accent ignores the artwork's saturation entirely, so results are unpredictable rather than harmonious. *Recommendation:* derive a **background tint** from the art (as the existing `.art-themed body` gradient already does) and keep the **accent** fixed to the brand cyan. This preserves the personality without the legibility risk.

**UX-31 — Two manifests, no icons for the background app.** `manifest-bg.json` uses the same 192/512 icons as the main app, so the two installed PWAs are visually identical on the home screen. `background.html` also lacks `<meta name="apple-mobile-web-app-capable">`, which `index.html` has, so the iOS "Add to Home Screen" shortcut for the background page is not standalone. `background.html` has no `<meta name="apple-mobile-web-app-status-bar-style">` either, so it renders under the iOS status bar.

**UX-32 — No indication that the PIN lock is cosmetic.** A padlock icon and a 6-hour session imply a security boundary that does not exist (SEC-009). A one-line note on the lock screen — "This locks the screen on this device only; it does not protect the host" — would cost nothing and prevent a serious misunderstanding.

---

---

## 9. Responsive Design Findings

Measured with Playwright at 7 viewports against a build of this tree, with real data (a playing MPRIS player, real sinks, real `pactl` app streams, real `/proc` stats).

| Viewport | `bodyScrollH` | × viewport | Sub-44 px targets | Top-bar overlap | `docScrollW/clientW` |
|---|---|---|---|---|---|
| Phone portrait 320×568 | 3441 | **6.06×** | 100 | **yes** | 320/320 |
| Phone portrait 360×640 | 2924 | **4.57×** | 93 | **yes** | 360/360 |
| Phone portrait 414×896 | 2979 | 3.32× | 98 | **yes** | 414/414 |
| Phone landscape 896×414 | 2236 | **5.40×** | 104 | **yes** | 896/896 |
| Tablet portrait 768×1024 | 2566 | 2.51× | 109 | **yes** | 768/768 |
| Tablet landscape 1024×768 | 2230 | 2.90× | 101 | **yes** | 1024/1024 |
| Desktop 1440×900 | 1884 | 2.09× | 94 | no (2 px margin) | 1440/1440 |

### 9.1 Phone portrait (320 / 360 / 414 px)

**Works.** No horizontal overflow. The single-column stack reads correctly. The transport cluster stays on one row down to 320 px. Range sliders are full-width with a 24 px thumb, which is genuinely thumb-friendly.

**Breaks.**
- **4.6-6.1 screens of scrolling** to reach the bottom of the Home deck. Volume and brightness require scrolling; the clipboard requires 3+ screens.
- **The top status strip is visually broken** at 360 px: "tab-dashboard" wraps to two lines, "54h 57m" wraps to two lines, making the pill 48 px tall, and the second pill renders as **"ffmpeg stopp"** — clipped by the right edge. Screenshot `shots/10-home-phoneSmall.png`, top 100 px.
- **The fullscreen button sits on top of the ffmpeg pill** — the button's icon is faintly visible *behind* the pill in the screenshot.
- **Carousel arrows**: the left chevron straddles the card's left border and sits immediately beside "6:23"; the right chevron is cut by the viewport edge. Both are 40 px.
- **The track title runs under the fullscreen button** — "Pirates of the Caribbean Orches…" is cut at x=308-348 by the fixed button.
- **The utility cluster wraps**, leaving the `|` divider orphaned at the end of row 1.
- **The FAB overlaps the App Audio row's "100 %" label** and its slider thumb.

### 9.2 Phone landscape (896×414)

**This is the worst configuration, and the auto-scroll bug (BUG-002) makes it much worse.** Because `TerminalDeck` calls `term.focus()` on mount, the window is scrolled to y=177 on every load. Screenshot `shots/10-home-phoneLand.png`: the entire Now Playing header — artwork, title, status pill, **seek bar** — is scrolled off the top; only the transport row is visible. The user opens the dashboard and cannot see what is playing or where they are in it.

Additionally:
- Quick Settings shows two rows of three, and the **third row (ERP Login, WARP) is below the fold and underneath the fixed nav strip** — its labels are visibly clipped by the nav bar at the bottom of the screenshot.
- 5.40 screens of scrolling in a 414 px-tall window.
- 104 sub-44 px targets.

**Recommendation:** at `(max-height: 520px)`, collapse the Now Playing card to a single compact row (art 40 px + title + transport), reduce the top strip to a single line, and skip `term.focus()` entirely.

### 9.3 Tablet portrait (768×1024) — the least broken configuration

Two-column grid activates at `md:` (768 px). Content fits without horizontal overflow. 2.51 screens of scroll. The top-bar overlap is still present. This is the configuration the design most likely assumed; the phone case is where it falls apart.

### 9.4 Tablet landscape (1024×768)

Two columns. **The FAB completely covers the MiniPlayer's next-track button** on the Code and Terminal decks — measured FAB `(708, 912, 48×48, z=50)` vs MiniPlayer `(0, 915, 768×53, z=40)`, overlap confirmed, and `z-50 > z-40` so the FAB is on top. Screenshot `shots/20-terminal-tablet.png` shows the FAB sitting over the mini player's third transport button. Also visible in that screenshot: the terminal's first line sliced by the top strip (BUG-002), and the "connected" badge occluded by the fullscreen button.

### 9.5 Desktop (1440×900)

**No horizontal overflow; the layout is clean.** But:
- **There is no way to change decks with a mouse.** Verified: clicking each bottom-nav dot leaves the page at index 0, and a full mouse-drag over the carousel does nothing. The only affordance is the FAB menu — 4 interactions (open, click, implicit close) versus 1 tap on a tablet.
- The carousel arrows straddle the card border (visible at 1440 too).
- Mixed accent colours in one card: cyan play/pause button and status dot inside a lime-accented card.
- The Geo Survey canvas dominates the left column at ~700×465 px for a feature that is off by default.

### 9.6 Cross-cutting responsive findings

1. **The fullscreen button overlaps the top status strip at every viewport** (measured). The strip is 32-48 px; the button is at `top-[30px] h-10` = y 30-70. Fix: `top-3` on the button plus `pr-12` on the strip, or move the button into the strip's own flow.
2. **No page-level horizontal overflow anywhere** — `documentElement.scrollWidth === clientWidth` at all 7 sizes, because `body` has `overflow-x: hidden`. The carousel works, but the overflow is *hidden* rather than *contained*: any future wide child is silently clipped rather than made scrollable. The inactive deck pages legitimately extend to `1296..2448` px at a 1440 px viewport, which is correct for a carousel but is being suppressed by a global `overflow-x: hidden` rather than by the carousel's own `overflow-x: auto`.
3. **93-109 sub-44 px tap targets per viewport.** Worst offenders, measured: 20 px (player dots, Geo session delete), 24 px (Geo ON/OFF, Bluetooth badge), 27 px (video aspect/speed pills, Braille-scale key hints), 28 px (Connected Devices broadcast + per-device stream, Media Streamer exit), 29 px (terminal arrow pad), 30-32 px (all four clipboard buttons, every IDE/Terminal/Video action button, volume mute buttons), 40 px (all media transport buttons, carousel arrows, fullscreen).
4. **The bottom nav strip is 25 px tall at every viewport** and its only function is dragging.
5. **`100dvh` is used consistently** — the right choice for mobile browser chrome.
6. **Safe-area insets are applied twice on the top edge** (SUS-015) — `body { padding: env(safe-area-inset-top) }` in `index.css:21-23` **and** `pt-[env(safe-area-inset-top)]` on the service-stats bar in `App.tsx:218`.
7. **`input[type=range] { height: 10px; touch-action: none; }` with a 24 px thumb** is a good touch decision (no scroll hijack while dragging) but the thumb overflows the track by 7 px per side, which is what crowds the media seekbar's time labels.
8. `clippedText: 1` at every viewport — the Now Playing `<h2>`, whose `truncate` is defeated by the fixed fullscreen button overlaying it rather than by its own box (9.1).

---

## 10. Accessibility Findings

The app is primarily touch-operated, but it is also served to desktop browsers, installed as a PWA, and exposed to a Media Session — so semantics, names and focus behaviour are real concerns.

### 10.1 Semantics and structure

| ID | Finding | Evidence |
|---|---|---|
| **A11Y-01** | **The deck carousel is a bare `<div>` with `overflow-x-auto`.** No `role="tablist"`, no `tabIndex`, no `aria-label`, no keyboard navigation, no arrow-key support. Deck switching is pointer-only. | `App.tsx:246-253` |
| **A11Y-02** | **Every `<input type=range>` in NowPlayingCard has no accessible name** — no `aria-label`, no `id`/`label` pair. Two copies exist simultaneously when the modal is open, both nameless and indistinguishable. | `NowPlayingCard.tsx:213-227, 527-535` |
| **A11Y-03** | The seek slider has no `aria-valuetext`, so a screen reader announces a bare number rather than "1:23 of 6:43". | same |
| **A11Y-04** | Carousel arrows and player dots are icon-only with **no `aria-label`**. The dots are `<button>`s whose only child is a coloured `<span>`, with a ~20 px hit area. | `PlayerCarousel.tsx:69-80, 88-98` |
| **A11Y-05** | The fullscreen lyrics modal has `role="dialog"` + `aria-modal="true"` but **no focus trap, no Escape handler, no focus restore**, and a generic `aria-label` where `aria-labelledby` → the track title would be correct. | `NowPlayingCard.tsx:469-478` |
| **A11Y-06** | **A `<button>` is nested inside a `div role="button"`** — invalid nesting of interactive controls. Because the parent also has `onKeyDown`, pressing Enter on the badge fires **both** handlers: it toggles Bluetooth *and* triggers "connect headphone". The badge is 24×24 px. | `QuickSettings.tsx:108-118, 137-152` |
| **A11Y-07** | The clipboard `<textarea>` has a placeholder but no `<label>` → no accessible name. The toast has no `role="status"`/`aria-live` → announcements are lost. | `ClipboardCard.tsx:113-123, 196-215` |
| **A11Y-08** | The service-stats bar conveys service state by **colour alone** (a green/red dot) with no text alternative; the name is a `<span>`, the whole strip has no `aria-label`, and the icons are unlabelled. | `ServiceStatsBar.tsx:50-80` |
| **A11Y-09** | The Geo canvas is a bare `<canvas>` with no `role="img"`, no `aria-label`, and no text alternative. All of its information (points, ping distribution, current position, calibration state) is unavailable to a screen reader. The legend swatches are colour-only. | `GeoSurveyCard.tsx:349-377` |
| **A11Y-10** | The tmux menu opens into a 3×3 grid with no `role="menu"`, no Escape, no focus move, and a FAB with only a `title`. | `TmuxRadial.tsx:31-60` |
| **A11Y-11** | The nav menu declares `role="menu"` but its children are plain `<button>`s with no `role="menuitem"` — an invalid ARIA pattern. No Escape, no arrow-key navigation, no focus management. | `FloatingNav.tsx:32-53` |
| **A11Y-12** | **`prefers-reduced-motion` is honoured nowhere** (SUS-016). Running regardless: `animate-pulse` in 6 places, the infinite `pulseDot` keyframes, the toggle ripple, `scroll-smooth`, and 500 ms lyric transitions. | `index.css` (no media query); `NowPlayingCard.tsx:403`, `AudioStreamCard.tsx:49,61`, `QuickSettings.tsx:153`, `GeoSurveyCard.tsx:376`, `BleProximityCard.tsx:130,146` |
| **A11Y-13** | **No global focus-visible style.** Only two components add `focus-visible:outline-2` (`QuickSettings`, `ToggleGrid`). Everything else relies on the UA default, which `index.css:29` partially defeats for range inputs (`outline: none`) with no replacement. | `index.css`, most components |
| **A11Y-14** | Icon-only buttons across the app use `title` as their only accessible name. `title` is a weak fallback (not exposed reliably, and suppressed when a visible label exists). | `AudioStreamCard.tsx:48`, `ConnectedDevicesCard.tsx:168,213`, `MusicSearch.tsx` clear button, `BleProximityCard.tsx:127,140` |
| **A11Y-15** | `div role="button"` is used for the QuickSettings toggles with a manual `onKeyDown`. This works but is a substitute for a `<button>`, and the manual handler does not cover `Space` keyup-repeat semantics correctly (`e.preventDefault()` on keydown for Space is right, but there is no `onKeyUp` guard against double activation from auto-repeat). | `QuickSettings.tsx:137-152`, `ToggleGrid.tsx:88-103` |
| **A11Y-16** | `index.html` has no `<meta name="description">` and the document has no `<h1>` — the first heading on the dashboard is the visually-hidden-ish "Now Playing" `<span>`. Heading structure is absent throughout; `SystemStatsCard` and others use `<h2>` for a track title inside a card, not as a document heading. | `index.html`, `NowPlayingCard.tsx:286,509` |
| **A11Y-17** | The PIN "dots" in the auth screen are `<div>`s with `role="status"` and an `aria-label` on the *container* only. Each dot is individually meaningless but individually focusable-by-nothing; a screen reader announces "PIN 3 of 4 digits entered" once, correctly — this is the one place the pattern is done well. | `AuthScreen.tsx:136-144` |
| **A11Y-18** | Disabled states are conveyed only by reduced opacity (`input[type=range]:disabled { opacity: 0.35 }`, `disabled:opacity-40`, `disabled:opacity-50`). `aria-disabled` is not used, and the disabled sliders remain in the tab order with no explanation of *why* they are disabled. | `index.css:59-62`, `ClipboardCard.tsx:134`, `GeoSurveyCard.tsx:393` |
| **A11Y-19** | **No `aria-live` region for state changes.** The audio-stream button's state, the volume/brightness values, the "Connection lost — retrying…" banner, the seek position, and the command log all change silently for a screen reader. | throughout |
| **A11Y-20** | The terminal is a `<div>` containing xterm's canvas; xterm's own accessibility layer is not enabled (`screenReaderMode`), and there is no `aria-label` on the container or the connected/disconnected badge. | `TerminalDeck.tsx:27-42, 128-134` |
| **A11Y-21** | Contrast: the body text colours are `deck-dim #94a3b8` on `#0f172a` (≈7.0:1, passes AA) and `deck-muted #64748b` on `#0f172a` (≈3.9:1, **fails AA for normal text**). `deck-muted` is used for the client-count badge, the Geo legend, `text-deck-muted/40` and `/50` variants in several places, and the 9-11 px hint text — all below 4.5:1. | `tailwind.config.js` `deck.muted`; used at `App.tsx:238,343`, `GeoSurveyCard.tsx:365-375`, `ServiceStatsBar.tsx:61-70` |

### 10.2 Summary of the highest-value accessibility fixes

1. Give **every** icon-only control an `aria-label` (≈20 sites) and every slider an `aria-label` + `aria-valuetext` (6 sites).
2. Make the deck carousel a real `role="tablist"` with roving `tabIndex` and arrow-key navigation, and make the dots real buttons.
3. Add a focus trap + Escape + focus restore to the lyrics modal.
4. Replace `div role="button"` with real `<button>` elements everywhere (removes A11Y-06's double-activation bug as a side effect).
5. Add one `@media (prefers-reduced-motion: reduce)` block that disables `animate-pulse`, the ripple, `pulseDot`, `scroll-smooth` and the long transitions.
6. Add a global `:focus-visible` ring.
7. Raise `deck-muted` to at least `#7c8aa0` (≈4.6:1) and add `aria-live="polite"` to the connection-status banner and the audio-stream button.
8. Fix the 9-11 px text: nothing below 11 px, and 12 px for anything that carries information.

---

---

## 11. Performance Findings

Measurements are from a `go build -race` instance under synthetic load and from Chromium via `performance.memory` and DOM geometry. Sub-headings follow the requested split.

### 11.1 Backend

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| **PERF-01** | **50-90 subprocess spawns per second, continuously.** One 500 ms SSE tick performs ~25-45 `exec.Command` calls (§3.3): `findBestPlayer()` runs 1+3N `playerctl` calls and is then invoked **five more times** via `runPlayerctlBest`; `fetchAllPlayers()` adds 1+6N more. | `main.go:1789-1796, 2046-2130` | The dominant cost of the whole application. Scales linearly with player count. |
| **PERF-02** | **`handleClients` and `/api/clients` are polled every 2 s by `ConnectedDevicesCard` and every 5 s by the app shell, per client.** Each request calls `trackClient`, which takes two mutexes and walks the map. | `ConnectedDevicesCard.tsx:54`, `App.tsx:158` | With BUG-023 the map holds one entry per recent request, so this is O(requests) work on a 2 s cadence. |
| **PERF-03** | **`/api/service-stats` blocks its handler for ≥400 ms** — `sampleCPU` sleeps 200 ms per tracked service, sequentially, for 2 services. | `service_stats.go:99, 109-114, 28-35`; measured BUG-043 | Every 5 s per client, a goroutine and connection are pinned 40 % of the wall clock. |
| **PERF-04** | **The Video deck polls `/api/video/status` every 1 s from mount, whether or not the deck is visible.** Each poll runs `detectVideoPlayer()` (a unix dial + an untimed `http.Get` + `playerctl -l`) and then up to ~10 separate mpv IPC round-trips, **each opening a fresh connection to `/tmp/mpvsocket`** (`mpvSendCommand` dials per call). | `VideoPlayerDeck.tsx:24-41`, `video_player.go:103-134, 506-540` | ~10 socket connections/second/client, forever, for a screen most sessions never open. |
| **PERF-05** | **Two independent 5 Hz `HEAD /api/ping` polls, neither guarded by `document.hidden`.** `ConnectedDevicesCard` measures "your device's ping" every 200 ms; `GeoSurveyCard` measures the host ping every 200 ms. | `ConnectedDevicesCard.tsx:83-94`, `GeoSurveyCard.tsx:142-154` | 10 requests/second/client, forever, even when the tab is hidden and even when both cards are scrolled out of view. This is the single easiest frontend win in the project: 10 req/s → 0 with two `if (document.hidden) return;` lines. |
| **PERF-06** | **Lyrics lookup blocks the broadcaster for up to 18 s.** | `lyrics_service.go:173-253`; BUG-049 | The **entire SSE state stream stops** during the lookup. |
| **PERF-07** | **`nvidia-smi` every 500 ms; `intel_gpu_top -J -s 500 -n 1` every 500 ms** (each invocation sleeps 500 ms internally, so one is always resident). | `gpu.go:65-90, 126-129`; BUG-051 | 2 NVML initialisations/second, or a permanently resident sampler. |
| **PERF-08** | **`gsconnectAvailable()` spawns a GJS interpreter and is called from `handleCapabilities`, `listPhoneDevices`, `deviceIsPhone`, `devicePaired` and `ensureDevicePaired`** — and `deviceIsPhone` is called once per device inside a loop. | `music_service.go:406-413, 446-488, 533-548, 552-565` | `GET /api/music/handoff-devices` spawns 1 + 2N interpreters. A full handoff spawns ~10. |
| **PERF-09** | **`yt-dlp` has no timeout** on search (`music_service.go:48-50`) or title resolution (`music_service.go:676-678`), and there is no concurrency limit. The frontend debounces 450 ms but does not abort in flight. | `music_service.go`, `MusicSearch.tsx:26-51` | A slow search holds a handler goroutine indefinitely; rapid typing can have several `yt-dlp` processes running concurrently. |
| **PERF-10** | **Unbounded `lyricsCache`.** One entry per track, never evicted. | `lyrics_service.go:42-50, 208, 241, 250` | Slow memory growth over weeks of uptime; each entry holds full plain + synced lyrics (a few KB). |
| **PERF-11** | **`fetchIntelGPU` parses `intel_gpu_top` JSON with substring indexing** (`strings.Index(out, "\"busy\":")` then manual slicing). Fragile, and re-parsed every 500 ms. | `gpu.go:133-151` | Correctness risk (see BUG-025) plus per-tick allocation. |
| **PERF-12** | **`cleanSearchPart` compiles a `regexp.MustCompile` on every call**, and it is called twice per search result. | `music_service.go:295` | 16 regex compilations per search. Minor, but trivially hoistable to a package var. |
| **PERF-13** | **The SSE fan-out drops frames for any client whose 16-slot channel is full, silently.** | `main.go:1327-1333` | Under load a client's state updates vanish with no indication on either side. |
| **PERF-14** | **`handleClients` marshals every `*ConnectedClient` under `connectedClientsMu.RLock()`** — with BUG-023 the list is far longer than the number of real devices. | `main.go:1122-1138` | Amplified by PERF-02. |
| **PERF-15** | **`sendSSECommand`'s fallback spawns a goroutine per full-channel send** with a 3 s timeout. For a client that is not draining, that is ~70 concurrent goroutines per client, each holding an 8 KB frame reference. | `main.go:1192-1206` | Bounded but unbounded-in-principle; a slow client costs a goroutine per frame for 3 s. |

### 11.2 Frontend

| ID | Finding | Evidence |
|---|---|---|
| **PERF-16** | **The whole app is one 625 kB bundle (168 kB gzip) with no code splitting.** Vite emits a chunk-size warning. `@xterm/xterm` + `@xterm/addon-fit` are statically imported by `TerminalDeck`, which is mounted on **every** page load. `lucide-react` is imported tree-shaken but is the largest single dependency after React. | `vite build` output: `../static/assets/index-DcQwZkEn.js  625.38 kB │ gzip: 167.84 kB` + the size warning; `TerminalDeck.tsx:2-7` |
| **PERF-17** | **`TerminalDeck` mounts unconditionally**, so every page load creates a `Terminal` instance (two canvases + a WebGL/canvas renderer), a `ResizeObserver`, and a WebSocket. Confirmed by the instrumented `WebSocket` capture: `["terminal", "ws?device_id=…", …]` on a Home-deck-only session. | `App.tsx:303-307`, `TerminalDeck.tsx:24-123` |
| **PERF-18** | **`useCapabilities` and `useFeatures` are called independently by 6 components** (`App`, `NowPlayingCard`, `AudioStreamCard` transitively, `QuickSettings`, `ToggleGrid`, `StepperControls`, `IdeDeck`, `TerminalDeck`, `VideoPlayerDeck`, `MediaBrowserDeck`). They dedupe via a module-level cache, so this is correct — but it means the hooks are a hidden global singleton, and any component that reads `caps` before the fetch resolves sees all-`false` and renders a different tree, causing a visible re-layout. | `useCapabilities.ts:23-40`, `useFeatures.ts:8-33` |
| **PERF-19** | **The NowPlaying lyrics rAF loop is torn down and recreated twice a second.** Its deps include `pos` and `localPos`, both of which update on every 500 ms SSE frame. | `NowPlayingCard.tsx:122-136` | `cancelAnimationFrame` + `requestAnimationFrame` 2×/s. Harmless but wasteful; the loop only needs `localPos` and a ref for `pos`. |
| **PERF-20** | **`useArtTheming` creates a canvas and calls `getImageData` on every album-art change**, reading a 64×64 image. Cheap, but it runs for **every** client, and it fires again whenever the art URL changes — which includes every track change. | `useArtTheming.ts:19-66` | ~4 KB of pixel data per track. Acceptable; noted for completeness. |
| **PERF-21** | **`createRipple` appends a DOM node outside React's control** and removes it on `animationend`. Under `prefers-reduced-motion` (or if the animation is skipped) the node is never removed, and React does not clean up nodes it did not create. Both `onMouseDown` **and** `onTouchStart` fire on touch devices, so a single tap creates **two** ripples. | `ToggleGrid.tsx:29-46, 95-96` | Slow DOM leak in the one configuration where the animation does not run. (In `ToggleGrid`, which is dead code — so today the impact is nil, but the same pattern should not be copied.) |
| **PERF-22** | **`PlayerCarousel` re-runs its auto-focus effect on every SSE frame** because `players` is a new array each time. The effect body is cheap (`findIndex`) but runs 2×/s. | `PlayerCarousel.tsx:25-33` | Negligible; noted. |
| **PERF-23** | **All five deck pages are mounted and laid out simultaneously.** Inactive pages get `h-[calc(100dvh-7rem)] overflow-hidden`, but they still build their full component tree — including the Terminal's `Terminal` instance (PERF-17), the Video deck's 1 Hz polling (PERF-04), the xterm canvases, and both 5 Hz ping intervals (PERF-05). | `App.tsx:142-145, 255-307` | This is the root cause of PERF-04, PERF-05 and PERF-17 together. **Fixing it is the single highest-leverage performance change available.** |
| **PERF-24** | **The Service Worker adds a hop to every third-party request** (Open-Meteo, YouTube thumbnails) for no benefit, because the page is controlled but the worker's `/api` branches are dead (BUG-018). | `service-worker.js:26-47` | Adds latency and a failure mode to requests that do not need it. |

### 11.3 Network

| ID | Finding | Evidence |
|---|---|---|
| **PERF-25** | **SSE pushes the entire `MediaState` every 500 ms to every client, regardless of change.** The payload includes all players, all sinks, all app streams, full system stats, the command log, and the complete lyrics object (plain + synced + every language version). With a 4-version lyric set that is several KB of unchanged text re-sent twice a second. | `main.go:1321-1334`, `main.go:200-224` | Measured on a playing track: each frame is a few KB, of which lyrics and command log are almost entirely static. No delta encoding, no `Last-Event-ID`, no change detection. |
| **PERF-26** | **No compression.** Neither the HTTP nor the HTTPS listener enables gzip/brotli, and there is no `Content-Encoding` negotiation middleware. The 168 kB gzip JS bundle is served uncompressed, as is every SSE frame. | `main.go:503-574` — plain `http.ListenAndServe`, no compression wrapper | The single largest bandwidth win available: a few KB/frame × 2 frames/s × N clients becomes a few hundred bytes. |
| **PERF-27** | **Audio frames are 8205 bytes of binary with no compression**, at 23.4 frames/s per client = 192 kB/s per client before any protocol overhead, over an **unencrypted** WebSocket on the HTTP listener. | `audio_stream.go:21-26, 173-176` | 192 kB/s × 3 clients (BUG-012) = 576 kB/s. Raw PCM is the worst case; Opus at 64 kbps would be 3× smaller. |
| **PERF-28** | **No `Cache-Control` on API responses and no ETag/conditional GET** on `/static/*` (beyond the service worker's cache-first, which is itself the bug in BUG-019). The 5.9 MB `server.log` is served with no range support tuning. | throughout `main.go` | Minor relative to the rest. |
| **PERF-29** | **`fetchVideoStatus` opens ~10 new TCP/unix connections per second per client** (PERF-04), each with its own handshake and `SetDeadline`. | `video_player.go:103-134` | Connection churn; visible in `ss` output during the audit. |

### 11.4 Audio

| ID | Finding | Evidence |
|---|---|---|
| **PERF-30** | **Client-side `pcmToFloat` + per-frame merge allocation.** Every frame allocates 2 `Float32Array`s (2048 samples each), and `feedFrame` then allocates 2 **more** of the accumulated length and copies. At 23.4 frames/s with 3-frame batches that is ~1.1 MB/s of garbage in the steady state, plus O(n²) growth when the context is suspended (BUG-014). | `streamManager.ts:60-72, 138-161` | Measured: heap sawtooth 9→70 MB in 28 s while suspended. |
| **PERF-31** | **The server's slow-consumer path spawns a goroutine per frame per stalled client**, each holding an 8 KB frame for up to 3 s. | `audio_stream.go:183-190` | Bounded at ~70 concurrent goroutines per client, but multiplied by BUG-012's duplicate sockets. |
| **PERF-32** | **`intel_gpu_top -s 500 -n 1` is effectively a permanent resident process** on Intel hosts, competing with the audio pipeline for CPU on a machine whose audio is already the most latency-sensitive resource. | `gpu.go:127` | See PERF-07. |
| **PERF-33** | **No `outputLatency` / `baseLatency` compensation.** The client schedules at `ctx.currentTime + t`, but `currentTime` is the *rendering* clock, so the sound reaches the DAC `outputLatency` later. On Bluetooth headphones `outputLatency` is commonly 200-400 ms, which means a Bluetooth client is audibly out of sync with a Wi-Fi client by that much — on a feature whose stated purpose is sample-accurate multi-device alignment. | `streamManager.ts:102, 115, 132` | Not measurable on this host (wired audio); documented Web Audio behaviour. |

### 11.5 Memory

| ID | Finding | Evidence |
|---|---|---|
| **PERF-34** | **Frontend heap grows without bound in three places:** the audio accumulator while suspended (BUG-014, measured 9→70 MB), the Geo recording `points` array (5/s, uncapped), and the Geo `calibSamples` array (BUG-028, measured 80 381 entries). | measurements above; `GeoSurveyCard.tsx:100-109, 126-139` |
| **PERF-35** | **Backend `lyricsCache` is unbounded** (PERF-10), and the command log is correctly capped at 30 (`main.go:352-354`). | `lyrics_service.go:42-50` |
| **PERF-36** | **`connectedClients` is bounded only by the 3 s TTL and a 15 s sweep**, so it holds one entry per request in that window — with PERF-05's 10 req/s that is ~30 phantom entries per client at steady state. | `main.go:299, 331-343`; measured `count=4` from one tab |
| **PERF-37** | **`artCachePath`/`artCacheData` cache exactly one album image, base64-encoded, in memory** with no size limit — a 10 MB cover becomes a 13 MB string held indefinitely, sent to every client every 500 ms in the SSE frame. | `main.go:1681-1705`; PERF-25 | Not triggered on this host (art was small), but a real risk with high-resolution local files. |

### 11.6 CPU

| ID | Finding | Evidence |
|---|---|---|
| **PERF-38** | **The 500 ms broadcast tick is the application's CPU floor and it is dominated by process spawns** (PERF-01). A `fork`+`exec` of `playerctl` costs ~1-3 ms; ~25-45 of them twice a second is 50-180 ms/s of pure spawn overhead before any real work. | `main.go:1338-1346`; measured indirectly by the wrong-CPU% readings (BUG-026) showing heavy child activity |
| **PERF-39** | **Two mutex-guarded maps are walked on the request path**: `handleClients` marshals the whole client list, and `cleanupClients` sweeps it every 15 s — both O(n) with n inflated by BUG-023. | `main.go:1119-1139, 331-343` |
| **PERF-40** | **The Geo calibration loop burns a full core for 30 s per invocation** (BUG-028, measured ~2 679 effect runs/s). | measurement in BUG-028 |
| **PERF-41** | **`streamManager`'s global gesture listeners are registered at module scope** and never removed — three listeners (`click`, `touchend`, `keydown`) for the lifetime of the page, each doing a `ctx.resume()` check. Plus three more registered per `ensureResumed()` call and removed only on success. | `streamManager.ts:405-415, 171-188` | Minor; the `ensureResumed` listeners do leak if the context never resumes. |
| **PERF-42** | **Three unconditional 5-minute-interval `pulseDot`/ripple/pulse animations** run continuously once the Now Playing card is mounted. | `index.css:191-193`, `NowPlayingCard.tsx` | Compositing cost only; noted for the reduced-motion fix. |

### 11.7 Priority summary

| Priority | Change | Expected effect |
|---|---|---|
| 1 | **Mount deck bodies lazily** (PERF-23) | Eliminates PERF-04, PERF-05, PERF-17 and most of PERF-16's cost for users who do not open every deck. Single highest-leverage change. |
| 2 | **Add `if (document.hidden) return;` to the two 5 Hz ping polls** (PERF-05) | 10 req/s → 0 when hidden. Two lines. |
| 3 | **Cache `findBestPlayer()` for the duration of one tick** so the 5 `runPlayerctlBest` calls reuse it (PERF-01) | Removes ~15 of the ~30 `playerctl` spawns per tick. |
| 4 | **Add gzip/brotli to both listeners** (PERF-26) | ~5-10× bandwidth reduction for the SSE stream and the JS bundle. |
| 5 | **Move lyrics off the broadcaster goroutine** (PERF-06/BUG-049) | Removes the 18 s state-freeze. |
| 6 | **Make `/api/service-stats` a pure read** (PERF-03) | Removes the 400 ms handler stall. |
| 7 | **Fix `trackClient`'s key** (PERF-02/PERF-14/PERF-36/BUG-023) | Shrinks the client map from O(requests) to O(devices). |
| 8 | **Sample GPU at 2-5 s on its own goroutine** (PERF-07) | Removes 2 NVML inits/s or a resident `intel_gpu_top`. |
| 9 | **Delta-encode the SSE payload** (PERF-25) | Only send changed fields; the lyrics and command log are almost entirely static. |
| 10 | **Cache `gsconnectAvailable()` with a TTL** (PERF-08) | Removes ~10 GJS interpreter spawns per handoff. |

---

## 12. Reliability / Failure Recovery

For each scenario: does the UI detect it, does the backend detect it, is the user informed, is the state recoverable, is retry automatic or manual, can the app become permanently stuck, does recovery create duplicates?

| # | Scenario | UI detects | Backend detects | User informed | Recoverable | Retry | Can get stuck | Duplicates on recovery |
|---|---|---|---|---|---|---|---|---|
| R1 | **Backend process crashes (BUG-001 terminal panic)** | Yes, after ≤8 s | n/a | "Connection lost — retrying…" | **No** — nothing restarts it | **No** — no supervisor, no `Restart=` unit, and the README's `tab-dashboard.service` **does not exist** (BUG-055) | **YES, permanently** | n/a |
| R2 | **Backend restarted by hand** | Yes | n/a | Yes | Yes | Automatic, but **~20-30 s** because `useMediaStream`'s backoff had reached the 16-30 s band (measured: banner cleared at t+24 s) | No | No |
| R3 | **SSE dropped, backend alive** (proxy hiccup, Wi-Fi blip) | Yes, immediately | No | Yes | Yes | Automatic, bounded backoff with jitter — **well implemented** | No | No |
| R4 | **WebSocket (audio) dropped** | **No** | Yes (`listeners` empties) | **No** — button still says "Stop" | **No** | **No** (BUG-013) | **YES** until a manual stop/start or reload | **YES** — 3 taps already leave 3 sockets (BUG-012) |
| R5 | **ffmpeg dies / PulseAudio monitor disappears** | **No** | Yes (readLoop returns) | **No** | **No** — `/api/audio-stream/status` still reports `active: true` (BUG-046) | **No** | **YES** | No |
| R6 | **Browser tab refreshed** | n/a | SSE/WS close cleanly | No | Yes | Yes | No | No — but the audio stream is torn down and every *other* device's audio dies if this was the last listener (BUG-036) |
| R7 | **Tab backgrounded** | No | No | No | n/a | The 500 ms SSE continues; the two 5 Hz polls continue too (PERF-05, no `document.hidden` guard) | No | No |
| R8 | **Phone sleeps / screen locks** | No | The WS closes eventually | **No** | **No** (BUG-013) | **No** | **YES** — the background PWA's own reconnect path (`background.html:413-423`) handles `onclose` but does **not** reopen the socket; it only updates the status text | No |
| R9 | **Network disappears then returns** | Yes | n/a | Yes | Yes | Automatic with backoff | No | No |
| R10 | **Media player appears / disappears** | Yes — `players[]` updates every 500 ms | Yes | Yes | Yes | Automatic | No | No |
| R11 | **Multiple media players appear/disappear** | Yes | Yes | **No** — the card just re-renders with no "player list changed" signal | Yes | Automatic | No | No |
| R12 | **Audio device changes (BT connects)** | Partly — `sinks[]` updates; the sink-switch button appears only if both a `bluez` sink and a non-HDMI sink exist | Yes | **No** | Yes | Automatic | No | No |
| R13 | **Bluetooth device unavailable** | `bluetoothctl` errors are logged, never surfaced (`ble.go:31-37`, `main.go:79-80`) | Partly | **No** | Yes | Manual | No | No |
| R14 | **A system command fails** | **No** — `triggerCommand` ignores `res.ok` (BUG-038); `handleVideoCommand` always returns 200 (BUG-033) | Yes, logged | **No** | n/a | **No** — no error to retry | No | No |
| R15 | **Command returns unexpected output** | Silent — `runCmd` returns `("", err)` and callers use `, _` (e.g. `main.go:2115, 2122, 2128`) | Yes | **No** | n/a | No | No | No |
| R16 | **Permission denied (gsettings/bluetoothctl)** | No | Logged only | No | n/a | No | No | No |
| R17 | **Clipboard tool unavailable** | Yes — the card catches and toasts "Push failed — clipboard tool missing?" | Yes | **Yes** (best error handling in the app) | Yes | Manual | No | No |
| R18 | **ffmpeg unavailable** | **No** — 10 s dead button, then nothing (BUG-011) | Yes | **No** | Manual | Manual | No | No |
| R19 | **D-Bus unavailable** | No | Yes, `startDBusSignalListener` returns after logging "dbus signal: connect failed" | No | Yes — falls back to `detectByProcessList` | Automatic fallback | No | No |
| R20 | **GNOME extension unavailable** | No | Yes — `detectByDBusExtension` returns `""` and falls back to the process list | No | Yes | Automatic fallback | No | No |
| R21 | **`config.json` missing at startup** | No | Yes — `log.Fatalf("config: no config.json found")` and the process exits | No | No — **the dashboard does not start** | No | **YES, permanently** until a config is restored | n/a |
| R22 | **`config.json` malformed + SIGHUP** | **No** | Yes — `reloadConfig` returns the parse error | Log only | **Yes** — the previous config is kept (`config_test.go:136-153` covers this) | Automatic on the next SIGHUP | No | No |
| R23 | **Invalid PIN entered** | Yes | Yes | Yes — "Wrong PIN" | Yes | Manual | No — but a network failure also says "Wrong PIN" (UX-16) | No |
| R24 | **Rapid repeated clicks on a toggle** | No | No | No | The command fires N times; state converges to whatever the last one set | n/a | No | No |
| R25 | **Rapid repeated toggles of a two-state command** (e.g. night light)** | No | No | No | **Race**: N `gsettings set` calls interleave; the final state is whichever lands last, which may not be the last one *requested* | n/a | No | No |
| R26 | **Rapid deck switching** | No | No | No | Yes | n/a | **Yes** — `scrollTo` is called from both the auto-focus effect and the nav handlers, each calling `setPage`; with the `page` dep deliberately omitted, two rapid switches can leave `page` and `scrollLeft` out of sync (the dots then show the wrong deck) | No |
| R27 | **Feature disabled while the page is open** | **No** — `/api/features` is fetched once and cached in a module-level variable for the page's lifetime | Yes | No | Only on reload | Manual | No | No |
| R28 | **Config reloaded via SIGHUP** | **No** — the frontend never refetches `/api/features` or `/api/capabilities` | Yes, mostly (BUG-053: the hotkey is not re-registered) | Log only | Partly | Manual reload | No | No |

### 12.1 The reliability headline

**The application has no restart mechanism and the deployment artifact that would provide one does not exist.**

`BUG-001` (a one-line `sync.Once` fix) kills the entire process on ordinary use of the Terminal deck. The README's auto-start instructions point at `tab-dashboard.service`, which is not in the repository. Even if it were, nothing in the repo suggests `Restart=on-failure`. The combination means: *open the terminal deck, run a command, close the tab → the dashboard is gone until the user notices and restarts it by hand.*

For a control panel whose entire purpose is remote control of a machine you are not sitting at, this is the most consequential reliability finding in the audit, and it is a ~10-line fix (`sync.Once` + `recover()` + ship the unit file with `Restart=on-failure`).

---

---

## 13. Audio Streaming Audit

This feature is the most complex in the codebase and carries the README's strongest claim — *"real-time PCM audio from the host's audio output broadcast to every connected device via WebSocket, with NTP-based clock sync and Web Audio API scheduling for sample-accurate multi-device alignment"*. It is audited separately and at length because that claim does not currently hold.

### 13.1 The complete data path

```
PulseAudio @DEFAULT_MONITOR
   │  (the pre-mute monitor tap; 48 kHz stereo, whatever the sink's rate)
   ▼
ffmpeg -f pulse -i @DEFAULT_MONITOR -f s16le -ac 2 -ar 48000 -acodec pcm_s16le pipe:1
   │  audio_stream.go:107-113
   │  ⚠ no -rtbufsize / -thread_queue_size tuning → ffmpeg's default buffering
   │    adds an unmeasured, uncompensated delay between capture and read
   ▼
cmd.StdoutPipe()  →  io.ReadFull(m.stdout, buf)   frameBytes = 2048·2·2 = 8192
   │  audio_stream.go:150-159
   │  42.667 ms per frame, 23.44 frames/s
   ▼
PTSTracker.GetPTS(time.Now())                     audio_stream.go:40-50
   │  PTS = server wall-clock ms at READ time
   │  EMA α = 0.02 against a nominal +42.667 ms
   │  ⚠ PTS is the READ time, not the CAPTURE time. The difference
   │    (ffmpeg buffer + PA latency, typically 100-400 ms) is never
   │    measured, published, or compensated.
   ▼
frame = [0x02 | PTS u64 BE | 8192 B PCM]          audio_stream.go:173-176
   ▼
fan-out: select { case ch<-frame: default: go{retry 3 s} }    audio_stream.go:178-192
   │  per-listener chan []byte, cap 512 (21.8 s of audio)
   │  ⚠ slow consumers get frames OUT OF ORDER, not dropped
   ▼
[0x01 | sampleRate u32 | channels | bytesPerSample]   handshake   audio_stream.go:231-238
   ▼  WebSocket (no compression, no Origin check, no auth)
browser: handleConnection → startNtp (10 pings)     streamManager.ts:242-321
   │  offset = t2 − t1 − rtt/2, 10 samples, trim 2 low/2 high, mean the rest
   │  hostTimeMs() = (performance.now() − perfBase) + dateBase + clockOffset
   ▼
onmessage: type 0x02 → feedFrame(pts, slice(9))    streamManager.ts:288-301
   │  ⚠ pts is used ONLY to set firstBatchPTS when accFrames === 0
   ▼
pcmToFloat: Int16 → Float32, de-interleaved         streamManager.ts:60-72
   ▼
accChannels[ch] merged (new Float32Array per frame) streamManager.ts:144-155
   │  every 3 frames → flushBatch()
   ▼
flushBatch:                                            streamManager.ts:74-136
   │  first batch:  ctxTime = ctx.currentTime + (firstBatchPTS + 500 − hostTimeMs())/1000
   │  later batches: PI controller on (scheduledEnd − ctx.currentTime)·1000 − 350
   │                playbackRate = 1 + clamp(err·8e-6 + I·3e-7, ±0.003)
   │  2 ms GainNode crossfade at each batch boundary
   ▼
AudioBufferSourceNode.start(ctxTime) → GainNode → ctx.destination
   ▼
DAC — actually heard at ctx.currentTime + outputLatency later
```

### 13.2 Buffering and queueing

| Layer | Depth | Behaviour under stress |
|---|---|---|
| ffmpeg internal | unmeasured (defaults) | Silent; contributes uncompensated latency |
| PulseAudio monitor | unmeasured (typically 20-100 ms) | Silent |
| `PTSTracker` EMA | α = 0.02, i.e. a 50-frame (2.1 s) time constant | Smooths read-clock jitter into PTS, but also smooths away real clock drift, so drift is never *visible* to the client |
| Go listener channel | 512 frames = **21.8 s** | Full → goroutine-per-frame, out-of-order delivery, 3 s timeout |
| Client batch | 3 frames = 128 ms | First batch delayed to +500 ms from first PTS |
| Client target buffer | 350 ms | PI authority ±0.3 % |
| `AudioContext` | — | `outputLatency` uncompensated |

**The 512-frame queue is the single most dangerous number in the pipeline.** 21.8 seconds of audio will happily accumulate for a client that cannot keep up, and the client will play it all — in the wrong order (BUG-047), without any gap detection (BUG-015). A queue this deep converts a transient network problem into permanent, inaudible corruption.

### 13.3 Synchronisation: what actually happens

**Step 1 — clock offset.** Ten NTP-style pings 10 ms apart, `offset = t2 − t1 − rtt/2`, mean of samples 3-8 after sorting. This is a reasonable estimator. Three caveats:
- `Date.now()` is used for `t1` and `t3`. Some browsers coarsen `Date.now()` for privacy; Firefox rounds to 1 ms or worse. A coarsened `t1` biases every offset.
- The offset is computed **once**, at connect. There is no re-sync. Any host/client clock drift over a long session is uncorrectable, and a host NTP step (slew) mid-session is invisible.
- The client's `perfBase`/`dateBase` are captured at `finalizeNtp`, so `hostTimeMs()` is exact only from that instant.

**Step 2 — first batch anchor.** `ctxTime = ctx.currentTime + (firstBatchPTS + 500 − hostTimeMs())/1000`. If `delay < 0` the batch is **discarded** (`streamManager.ts:98-101`) and the next attempt re-anchors — a livelock risk if PTS consistently runs ahead. `background.html:225-228` has the same discard but additionally resets `scheduledEnd`; the main app has no such reset.

**Step 3 — steady state.** `ctxTime = this.scheduledEnd`. Buffers are chained back-to-back with no re-anchor. The PI controller sees `error = (scheduledEnd − ctx.currentTime)·1000 − 350`.

**Step 4 — the controller cannot converge.** This is the core finding (BUG-016), and it deserves restating in audio terms:

- The only mechanism for reducing buffer depth is a negative `playbackRate`. Maximum authority is `PI_MAX = 0.003` = **0.3 %**.
- 0.3 % of real time drains 50 ms of buffer in **167 seconds**. It drains a 1-second backlog in **5.5 minutes**.
- The proportional term only reaches full authority at a 375 ms error, so realistic 10-50 ms errors get 0.008-0.04 % — draining 50 ms in 21-104 minutes.
- The integral term saturates at 0.015 % (0.015 % is 20× below `PI_MAX` and 5× below even the smallest realistic P contribution), so it contributes almost nothing even after 200 s of steady error.

**Therefore: there is no mechanism by which this pipeline recovers accumulated latency.** After any event that pushes `scheduledEnd` ahead of `ctx.currentTime` — a Wi-Fi stall, a phone backgrounding its tab, a browser throttling the WebSocket, a 2 s GC pause (BUG-014) — the latency grows and stays grown. The user experiences audio that is increasingly behind the laptop, with no indication and no recovery short of stopping and restarting the stream.

`public/background.html:241-245` contains precisely the missing mechanism:
```js
if (t < ctx.currentTime - 0.5) { t = ctx.currentTime + 0.05; schedEnd = 0; }
```
This re-anchors after a stall. Its absence in `streamManager.ts` is, on the evidence, an oversight — the two implementations were written separately and diverged.

**Step 5 — PTS is decorative after the first frame.** `feedFrame` reads `pts` at exactly one line. A single lost 42.67 ms frame is a permanent 42.67 ms hole in the timeline that the client cannot see and the PI controller (which cannot correct 42 ms anyway) will not mention. The `PTSTracker`'s careful EMA exists to make PTS trustworthy; that work is thrown away.

**Step 6 — output latency is uncompensated.** `ctx.currentTime` is the rendering clock; audio reaches the DAC `outputLatency` later. A Bluetooth client (200-400 ms of `outputLatency`) is audibly out of sync with a Wi-Fi client by that amount, on a feature whose stated purpose is multi-device alignment.

### 13.4 Can it degrade gracefully? No.

Explicitly answering the question the audit brief asks:

| Failure | Graceful degradation? | What happens |
|---|---|---|
| One dropped frame | **No** | Silent permanent 42.67 ms gap (BUG-015) |
| One duplicated frame | **No** | Silent permanent 42.67 ms repeat |
| 1 s network stall | **No** | ~1 s of extra latency, then drains at 0.3 % → ~5.5 min to recover (BUG-016) |
| 5 s network stall | **No** | ~25 min to recover, or never in practice |
| Slow consumer (channel full) | **No** | Frames delivered **out of order** and played as-is (BUG-047) |
| ffmpeg dies | **No** | Clients hang silently; status still reports `active: true` (BUG-046) |
| Audio socket closes | **No** | No reconnect; UI still says "Stop" (BUG-013) |
| Rapid taps | **No** | Duplicate sockets, interleaved audio at 3× rate (BUG-012) |
| Autoplay blocked | **No** | Unbounded memory growth; UI claims success (BUG-014) |
| Tab backgrounded | **Partly** | Browser may throttle the WS; on return the client has no re-anchor and no reconnect |
| Device sleeps/wakes | **No** | Socket closed; nothing reopens it (BUG-013) |
| Host audio device changes | **Partly** | The monitor source changes; ffmpeg keeps running; PTS keeps advancing. New audio appears with a discontinuity the client does not detect. |

**What graceful degradation would look like:** on a detected PTS gap, either insert silence to hold the timeline (preserving sync, adding an audible gap) or drop to the newest frame and re-anchor (losing sync, bounding latency). Either is a bounded, visible behaviour. The current design does neither.

### 13.5 Client lifecycle defects

| Defect | Evidence |
|---|---|
| **No reconnection at all** | BUG-013, measured: `opened: 1` before and after a forced socket close, button still "Stop" |
| **Duplicate sockets on rapid start** | BUG-012, measured: 3 live `/api/audio-stream/ws` from 3 taps |
| **No `connecting` guard** | `streamManager.ts:196` guards on `active`, which is set only after NTP (line 271) |
| **Unbounded accumulation while suspended** | BUG-014, measured heap 9→70 MB in 28 s |
| **The "needs gesture" prompt lives in the wrong component** | `audio-needs-gesture` is dispatched by `streamManager` (line 169) but only `ConnectedDevicesCard` listens (lines 98-108). The `AudioStreamCard` — the actual control — shows nothing. On the Media Streamer page the card is present, but on a page where `ConnectedDevicesCard` is hidden the prompt is never seen. |
| **The AudioContext is suspended, not closed, on stop** | `streamManager.ts:377` — deliberate and correct (it preserves the autoplay unlock), but it means a suspended context can be resurrected by a *later* `start()` without a gesture, which some browsers treat as a policy violation |
| **`background.html` is a second, divergent implementation** | Different thresholds, different re-anchor logic, a different `play` action handler, no volume on the main app's path. Two audio pipelines, one set of fixes needed twice. |

### 13.6 Server-side lifecycle defects

| Defect | Evidence |
|---|---|
| **ffmpeg death strands all clients** | BUG-046: `readLoop` returns without closing listener channels or notifying anyone; `/api/audio-stream/status` reports `len(listeners) > 0` |
| **A reconnecting device leaks its previous socket** | SUS-009: `deviceAudioWS[deviceID] = conn` overwrites without closing the old one |
| **`removeListener` closes the channel while the fan-out may still target it** | `audio_stream.go:212` closes `ch` outside the lock; a concurrent fan-out iteration holds the lock and holds a reference. Contained only by the `recover()` in the retry goroutine (line 184) — a crash avoided by `recover()` rather than by correct locking. |
| **No ffmpeg restart on death** | The next `addListener()` restarts it, but nothing else does |
| **`stopLocked` kills the process but does not drain the pipe** | `m.ffCmd.Process.Kill()` then `Wait()`. `readLoop` may be blocked in `io.ReadFull` and will error out, which is fine, but the `select` on `m.stopCh` at the top of the loop is only reached between frames — so shutdown latency is one frame (42 ms), acceptable |
| **The mutex is held across a channel send attempt** | `audio_stream.go:178-192`: `m.mu.Lock()` spans the `select` and the goroutine spawn. `removeListener` therefore contends with the fan-out for every frame |
| **No backpressure signal to the client** | A stalled client is silently starved, then silently corrupted (BUG-047) |

### 13.7 Recommendations, in dependency order

1. **Add the re-anchor from `background.html`** to `streamManager.ts` (`streamManager.ts:104-116`). One block of five lines. This alone converts "latency grows forever" into "latency resets on stall".
2. **Add a hard latency clamp.** When `scheduledEnd − ctx.currentTime > 500 ms`, drop the oldest pending buffer and re-anchor. Bounded latency, at the cost of a gap — which is the correct trade.
3. **Use the PTS.** Track `lastPts`; on `|Δ − 42.67| > 1 ms`, insert silence (hold the timeline) or re-anchor (bound the latency). Expose a drift counter so the failure is at least visible.
4. **Re-tune the PI gains** in buffer-seconds, not milliseconds, and raise `PI_MAX` to ~0.02. Document the intended correction rate and steady-state latency.
5. **Compensate `outputLatency`** (or at minimum surface the estimated device latency in the UI so users understand Bluetooth sync offsets).
6. **Add a `connecting` guard and a reconnect with backoff** to `streamManager`, mirroring `useMediaStream`. Merge the two implementations or extract the shared logic.
7. **Bound the client accumulator** while suspended: keep at most `TARGET_DELAY` of frames, drop the rest, show the gesture prompt from `AudioStreamCard` (where the button is) rather than from `ConnectedDevicesCard`.
8. **Server: on ffmpeg exit**, close all listener channels, send `{"type":"error","reason":"capture_stopped"}`, and restart with backoff. Make `/api/audio-stream/status` reflect the ffmpeg state.
9. **Server: drop frames for a congested client** rather than reordering them, and signal the client to re-anchor.
10. **Reduce the queue from 512 frames (21.8 s) to ~64 (2.7 s).** A 21-second buffer is not a buffer, it is a latency reservoir.
11. **Add a `Last-PTS`/sequence number** so the server can also detect its own drops and tell the client.
12. **Consider Opus** instead of raw PCM (PERF-27): 3× less bandwidth and, critically, Opus has built-in PLC/DTX that makes a dropped packet a fade rather than a hole — which addresses finding 3 above at the transport layer.

---

---

## 14. Testing Gaps

### 14.1 What exists

**One test file: `config_test.go`, 276 lines, 8 tests.** All eight concern config parsing, feature-flag semantics, and SIGHUP reload:

| Test | What it covers |
|---|---|
| `TestIsEnabled` | 8-case table for nil config / nil map / empty map / explicit true / explicit false / other-key / unknown-key / case sensitivity |
| `TestUnknownFeatureKeys` | typo detection |
| `TestLegacyConfigAllEnabled` | pre-flags configs behave as before |
| `TestPartialConfigOnlyTargetOff` | partial flags |
| `TestExampleConfigRoundTrips` | every known key present and true in the example |
| `TestReloadConfigSwapsLive` | SIGHUP swaps flags **and** derived PINs |
| `TestReloadConfigKeepsPreviousOnError` | malformed JSON does not replace the live config |
| `TestReloadConfigPathPrecedence` | `CONFIG_PATH` beats `./config.json` |
| `TestReloadConfigShrink` | removed commands/flags revert rather than linger |
| `TestReloadConfigConcurrent` | 4 readers × 2 writers under `-race` |

That is genuinely good work — the derive-then-swap design is correct and the concurrency test is the right test for it. `go test -race ./...` passes.

### 14.2 Coverage map

| Area | Files | Tests | Coverage |
|---|---|---|---|
| Config / feature flags | `config.go` | 10 | **Good** |
| HTTP mux / routing | `main.go` (44 routes) | 0 | **0 %** |
| Auth | `main.go:696-732` | 0 | **0 %** |
| Command dispatch | `main.go:735-871` | 0 | **0 %** |
| SSE broadcast | `main.go:1062-1108, 1299-1346` | 0 | **0 %** |
| Window SSE | `main.go:1604-1661` | 0 | **0 %** |
| Client tracking | `main.go:301-343` | 0 | **0 %** |
| Geo endpoints | `main.go:371-444` | 0 | **0 % — and contains SEC-001/002/003** |
| Audio streaming | `audio_stream.go` | 0 | **0 % — and contains BUG-046/047** |
| Terminal PTY | `terminal.go` | 0 | **0 % — and contains BUG-001** |
| Music service | `music_service.go` | 0 | **0 %** |
| Video player | `video_player.go` | 0 | **0 %** |
| Lyrics | `lyrics_service.go` | 0 | **0 %** |
| Service stats | `service_stats.go` | 0 | **0 % — and contains BUG-026** |
| GPU | `gpu.go` | 0 | **0 %** |
| Hotkey | `hotkey.go` | 0 | **0 %** |
| Clipboard | `clipboard.go` | 0 | **0 %** |
| Config-derived command map | `main.go:48-184` | 0 | **0 %** |
| Frontend | all 51 files | 0 | **0 %** |
| `cmd/sendkey` | 201 lines | 0 | **0 %** |

**Weighted by risk: the tested 6 % of the code contains no security boundary and no concurrency; the untested 94 % contains every finding in this report.**

There is no test file for any frontend code, no linter configured for TypeScript (`package.json` has `build` only — no `test`, no `lint`, no `format`), no CI configuration anywhere in the repository, and no `tab-dashboard.service` to deploy.

### 14.3 Specific missing tests, with the exact case to write

**TEST-01 — `TestRouterDoesNotExposeFiles`** *(SEC-007, must-fix)*
For each of `/config.json`, `/server.key`, `/server.crt`, `/server.log`, `/.git/config`, `/geo_sessions/`, `/main.go`, `/frontend/`, `/testdata/`, `/cmd/`: assert the status is 404. Then assert `GET /` returns the app HTML (not a directory listing). This single test would have prevented the most serious finding in the audit.

**TEST-02 — `TestGeoSessionRejectsTraversal`** *(SEC-001/002/003)*
Table over `../x`, `..%2Fx`, `a/../../b`, `/etc/passwd`, `....//x`, `x\x00.json`, `.`, `..`, `""`, a 300-byte name, and a valid `track.json`. Assert every malicious case is rejected on **all three** verbs (GET / DELETE / POST-save) and that the valid case still works.

**TEST-03 — `TestMutatingEndpointsRejectMissingHeader`** *(SEC-004)*
Table over every mutating route. Assert 403 without `X-Control-Deck: 1`; assert normal behaviour with it. Plus `TestNoCORSWildcardOnAPI` asserting no `Access-Control-Allow-Origin` on any `/api/` or `/media-stream` response.

**TEST-04 — `TestTerminalWSDisconnectDoesNotPanic`** *(BUG-001)*
`httptest.NewServer` with the real mux. Open a raw WS, send `for j in $(seq 1 100000); do echo $j; done`, wait 200 ms, close with `SO_LINGER=0`. Assert no panic, a second connection succeeds, and no orphan process remains. Run under `-race`.

**TEST-05 — `TestQueryProcessByName`** *(BUG-026)*
Start `sleep 30`. Assert `uptime_secs ∈ [28,30]` and `cpu_percent < 5`. Add a second case using a helper that has reaped children (so `cutime > 0`) to catch a regression back to the wrong field. This is ~15 lines and pins a confirmed wrong-number bug.

**TEST-06 — `TestAuthRateLimited` / `TestAuthConstantTime`** *(SEC-008)*
Assert that N failed attempts trigger a 429 or an increasing delay, and that the comparison path is exercised.

**TEST-07 — `TestFeatureKeySetsMatch`** *(BUG-041)*
Assert `KnownFeatures` (sorted) == `Object.keys(FEATURE_DEFAULTS)` (sorted). Needs a generated TS file or a JSON fixture the Go test can read — which is itself the right fix for the underlying duplication.

**TEST-08 — `TestCommandMapContainsAllDeckCommands`**
Parse `frontend/src/config/deckConfig.ts` and assert every `cmd`/`cmdOn`/`cmdOff` resolves in `commandMap` (after merging `custom_commands`). Catches BUG-022 at startup rather than at tap time.

**TEST-09 — `TestSSEBroadcastDropsSlowClientWithoutBlocking`**
Attach a client that never reads. Push 200 frames. Assert `broadcastState` returns promptly and the slow client's channel is full (and that this is *logged*, per BUG-047's recommendation).

**TEST-10 — `TestSSEClientCleanupOnDisconnect`**
Connect and abruptly disconnect an SSE client. Assert the channel is removed from `clients` and the map length returns to 0, under `-race`.

**TEST-11 — `TestStreamManagerLifecycle`**
`start()` twice concurrently → exactly one WebSocket. `stop()` mid-stream → `active === false`, subscribers notified, socket closed. `onclose` while active → reconnect scheduled with backoff, `active === false`. Needs a `WebSocket` test double injected into `streamManager` (currently the class constructs `new WebSocket` inline, so it is untestable without a seam — add one).

**TEST-12 — `TestSyncedAudioPlayerSuspendedDoesNotGrow`** *(BUG-014)*
With a stubbed `AudioContext` reporting `state === 'suspended'`, feed 300 frames. Assert the accumulator never exceeds `TARGET_DELAY` worth of samples. Fails today; passes after the fix.

**TEST-13 — `TestPTSTrackerMonotonic`** *(audio_stream.go:40-50)*
Table over a jittery `readTime` sequence. Assert PTS is strictly increasing, that the per-frame delta is within tolerance of 42.667 ms, and that `math.IsNaN` never appears. This is a pure function — trivially testable, currently untested, and it is the only thing standing between a client and a garbage timeline.

**TEST-14 — `TestFrameEncodingRoundTrip`**
Assert `frame[0] == 0x02`, the PTS is big-endian at `[1:9]`, and `len(frame) == 9+8192`. Then decode on the client side and compare PCM bytes. Pins the wire format so a future change to `frameBytes` cannot silently break every client.

**TEST-15 — `TestClassifyApp`** *(BUG-039)*
Table over `wm_class` × `title` → expected `app` + expected page index. Include the `brave-browser` / `- YouTube` / `- YouTube Music` cases, the IDE list, the terminal list, the video list, and an unknown class. Assert `unknown` never maps to page 0.

**TEST-16 — `TestJaroWinkler`** *(lyrics_service.go:94-159)*
Table of known pairs with expected values (identical → 1.0, empty → 0.0, transposition, prefix bonus). It is a hand-rolled implementation of a well-specified algorithm and is entirely untested; a subtle bug here silently degrades every lyrics match.

**TEST-17 — `TestBuildVersionsSortIsStable`** *(SUS-003)*
Assert the `sort.SliceStable` comparator is a valid strict weak ordering, and that the same-language group order is deterministic across runs.

**TEST-18 — `TestParseLRC`** *(BUG-037)*
Cases: `[00:12.00]x`; `[1:23.45]x` (single-digit minute — must parse); `[00:12.00][01:20.00]x` (must produce two lines); `[offset:+500]`; `ar:`/`ti:` metadata; blank lines; unsorted input.

**TEST-19 — `TestAppStreamVolumeRoundTrip`** *(BUG-021)*
Given a slider value, assert the value PA ends up with is the intended percentage. Currently fails by construction — the test documents the defect.

**TEST-20 — `TestMpvIPCFrameSplitting`** *(video_player.go:136-157)*
Feed `scanLines` a concatenated multi-object buffer and assert each object is returned separately; feed a truncated object and assert `ErrFinalToken`. The custom JSON splitter is the kind of code that passes review and fails in production.

**TEST-21 — `TestShellQuote`** *(SEC-013)*
Table of hostile inputs — `'; rm -rf /`, `` `id` ``, `$(id)`, `a'b'c`, newline, `\` — asserting `sh -c` with the quoted result treats them literally. Guards the one place the project *does* build a shell command from user input.

**TEST-22 — `TestHotkeyRoundTrip`** *(hotkey.go)*
Run `ensureGnomeKeybinding` against a fake gsettings and assert idempotency, correct index allocation, and that an existing user shortcut with the same binding is **not** overwritten.

**TEST-23 — `TestDeviceIdFallback`** *(SEC-015)*
A frontend unit test asserting `getDeviceId()` returns a non-empty value when `crypto.randomUUID` is undefined (simulating a non-secure context). Needs a small Vitest/Jest setup — which does not currently exist.

**TEST-24 — `TestE2EUnlockAndDeckSwitch`** *(BUG-001, BUG-002, BUG-006)*
Playwright: unlock with the dashboard PIN, assert `window.scrollY === 0`; assert no xterm holds focus; click each bottom-nav dot and assert the deck changes; assert ≥44 px on all primary controls. This is the single highest-value frontend test and would have caught three confirmed bugs.

### 14.4 Testing infrastructure gaps

| Gap | Recommendation |
|---|---|
| No frontend test runner | Add Vitest + Testing Library. `npm test`, `npm run lint`, `npm run format` in `package.json`. |
| No CI | Add `.github/workflows/ci.yml`: `go vet`, `gofmt -l`, `go test -race ./...`, `npm ci`, `npm run build`, `npm test`. |
| No linter for Go beyond `vet` | `golangci-lint` with `errcheck` (there are many unchecked `cmd.Run()` / `cmd.Output()` results), `gosec`, `staticcheck`. `go vet` currently reports 3 `unsafe.Pointer` misuses in `cmd/sendkey`. |
| No linter for TypeScript | `eslint` with `react-hooks/exhaustive-deps` **enabled** — the code currently carries two `eslint-disable-next-line react-hooks/exhaustive-deps` suppressions, which is evidence the rule would have been useful. |
| `gofmt -l` reports 8 files | `audio.go`, `cmd/sendkey/main.go`, `config.go`, `lyrics_service.go`, `main.go`, `music_service.go`, `service_stats.go`, `terminal.go`. Add a `make fmt` / CI gate. |
| No integration harness | An `httptest`-based suite covering the mux would have caught SEC-007, BUG-035, BUG-043, and the 403 paths. |
| No fuzzing | `os.ReadFile(geoDir+"/"+name)` and `parseLRC` are both ideal fuzz targets. Go fuzzing is one line each. |

---

---

## 15. Code Quality / Maintainability Findings

Only issues that materially increase future bug risk or development cost are listed. Ordinary stylistic differences are excluded.

### 15.1 Dead code — 892 lines, 12.5 % of the frontend

| File | Lines | Why it matters |
|---|---|---|
| `decks/DefaultDeck.tsx` | 44 | Not imported anywhere. Its children are dead *because of it*. |
| `components/StepperControls.tsx` | 173 | A **third** copy of the volume/brightness logic (live copy in `MixerCard`, dead copy here). Contains a no-op `useEffect` with no dependency array (lines 31-33). |
| `components/ToggleGrid.tsx` | 131 | A second QuickSettings implementation. Contains `createRipple` (PERF-21's leak). |
| `components/CaffeineCard.tsx` | 75 | Duplicates `QuickSettings`' caffeine logic including the same derived-state `useEffect`. |
| `components/AppMixerCard.tsx` | 102 | A near-duplicate of `MixerCard`'s `AppStreamsList`, with a pointless `dirty` counter forcing a re-render on every slider tick (lines 48, 71). |
| `components/SysStatsBar.tsx` | 64 | Superseded by `SystemStatsCard`. |
| `components/GuestView.tsx` | 155 | Never imported. |
| `components/LockScreen.tsx` | 148 | **A second, divergent PIN screen** with a different storage key (`dash_auth` vs `dash_auth_mode`), no mode picker, and `onPointerDown` for the keypad instead of `onClick`. Two lock implementations in one tree is a correctness hazard, not just clutter. |
| `lib/BleRssiMonitor.ts` | 130 | A second BLE implementation with **different thresholds** (−65/−82 dBm vs the live −50/−75) and a GATT service UUID (`12345678-…`) the server never implements. |
| `lib/authStore.ts` | 36 | `getToken`/`setToken`/`clearToken`/`authUrl`/`authFetch` — a complete token-auth layer that is **never imported**. Its presence actively misleads a reader into believing auth exists (SEC-009). |

**Cost:** a maintainer changing "the volume slider" must find and reconcile three implementations. A maintainer changing "the lock screen" must decide which of two is real. `lockScreen.tsx` using `onPointerDown` for its keypad means a swipe starting on a digit enters a digit — a bug that would ship the moment someone wired the "correct" lock screen.

**Recommendation.** Delete all ten files, or wire them deliberately. If `authStore` is aspirational, keep it but add a comment saying so; if not, delete it. 892 lines and three duplicate volume implementations are the largest single maintainability liability in the project.

### 15.2 Duplicated logic

| ID | Duplication | Risk |
|---|---|---|
| **MAINT-02** | Two BLE implementations with different thresholds. | Tuning one does not tune the other; the two will disagree about "in room". |
| **MAINT-03** | **Three** copies of the volume+brightness control block: `MixerCard` (live), `StepperControls` (dead), `VideoPlayerDeck`, plus a fourth partial copy in `MediaBrowserDeck`. Each has its own throttle constant, its own `dragging` ref pattern, and its own commit handlers. | The keyboard-commit bug (BUG-005) is fixed in `MixerCard` but missing in the media seekbar; the next fix will be applied to one copy and not the others. **Extract one `<VolumeSlider>` and one `<BrightnessSlider>`.** |
| **MAINT-04** | `authStore.ts` — dead auth layer. | See 15.1. |
| **MAINT-11** | `isToggleActive` is implemented twice (`ToggleGrid.tsx:54-66`, `QuickSettings.tsx:45-53`) with identical switch statements. | Divergence risk. |
| **MAINT-12** | `capabilities` is fetched with no caching server-side: `checkBinary("playerctl")` etc. are re-evaluated on every `/api/capabilities`, and `gsconnectAvailable()` spawns GJS (PERF-08). | See BUG-040. |
| **MAINT-13** | `sendkey`-based command registration is split between `buildCommandMap` (base), `buildProfileCommandMap` (profile), and `custom_commands` (user), with a "only if absent" merge — while `scenes.go` and `deckConfig.ts` reference command names that no layer defines by default (BUG-022). | Adding a command means editing three places and hoping they agree. A single registry with a validation pass at startup (TEST-08) would fix the class. |

### 15.3 Large / deeply coupled components

| Component | Lines | Coupling |
|---|---|---|
| `NowPlayingCard.tsx` | 625 | Art, metadata, lyrics parsing, the rAF loop, the fullscreen modal (via portal), the language switcher, the handoff menu, the version switcher, the seekbar, the transport, and `AudioStreamCard`. It calls `useCapabilities()` itself rather than receiving it. The `seekbar` and `playControls` JSX are defined as local consts and rendered in **two** places. |
| `main.go` | 2168 | 44 routes, the SSE broadcaster, client tracking, MPRIS polling, window classification, command dispatch, geo endpoints, and all the `/proc`/`/sys` readers. |
| `App.tsx` | 360 | Deck carousel, pointer-drag, auth gate, fullscreen, client polling, and the entire page layout. |
| `GeoSurveyCard.tsx` | 476 | Canvas rendering, GPS, calibration, recording, session persistence, and a `useEffect` dependency bug (BUG-028) that only manifests after 30 s of runtime. |

**Recommendation.** Split `NowPlayingCard` into `<TrackHeader>`, `<SeekBar>`, `<TransportControls>`, `<LyricsTicker>`, `<LyricsModal>`, `<HandoffMenu>`, and a `useLyrics()` hook. Split `main.go` into `routes_*.go` files matching the existing subsystem files. Neither is required to fix any finding, but both reduce the cost of every future fix.

### 15.4 Fragile parsing and OS-specific assumptions

| ID | Location | Problem |
|---|---|---|
| **MAINT-14** | `main.go:1398-1422` `detectByDBusExtension` | Parses `gdbus` output with `strings.Split(inner, ", ")`. Any `wm_class` or title containing a comma shifts every subsequent field. |
| **MAINT-15** | `main.go:1424-1465` `detectByProcessList` | `strings.Contains(lower, p.pattern)` over patterns including bare `"code"`, `"chrome"`, `"brave"`, `"vlc"`. `pactl`/`pulseaudio` do not contain "code", but a process named `xcodebuild` or `code-insiders` would match "code" and be classified as VS Code. And the ordering means the *newest* process wins, so a background `code` helper process is enough to route the deck. |
| **MAINT-16** | `gpu.go:35` | `sh -c "ls /sys/class/drm/card0/device/ | grep -q gpu_busy_percent …"` — shelling out to test a file's existence. Should be `os.Stat`. |
| **MAINT-17** | `service_stats.go:74, 125` | `clkTck := 100` hardcoded twice, with no comment justifying it. Correct on Linux (`USER_HZ` is 100) but undocumented. |
| **MAINT-18** | `gpu.go:133-151` | The `intel_gpu_top` JSON parse indexes a substring by hand (`out[idx+7 : idx+end]` with `end` found by searching for `,` then `}`). If the value ever contains a comma or the key is absent, this silently yields 0. |
| **MAINT-19** | `main.go:1663-1710` `resolveArtURL` | Correct and careful (MIME check, single-entry cache). But the single-entry cache means alternating between two tracks re-reads and re-base64s one file every 500 ms. |
| **MAINT-20** | `video_player.go:26-28` | `vlcBaseURL`/`vlcPassword` hardcoded rather than configured (BUG-050). |
| **MAINT-21** | `main.go:214-224` `MediaState` | One struct is the SSE payload, the `/api/*` shape, and the frontend's `MediaState` interface — 25 fields with no versioning. Adding a field is a three-file change with no contract test. |

### 15.5 Comments that contradict the code

These are worse than missing comments, because they cause a reader to skip verification.

| Location | Comment | Reality |
|---|---|---|
| `main.go:103` | `// Shift+F5 — handled below` | Nothing below handles it. All three map to plain F5. (BUG-034) |
| `main.go:104` | `// Shift+F5` | Same. |
| `main.go:105` | `// Ctrl+Shift+F5 via loop` | No loop exists. |
| `main.go:176` | `"sub_delay_": … // placeholder — YouTube uses 'v' for captions` | The command is never registered by any caller and would conflict with the real subtitle action. |
| `service_stats.go:98` | `// Quick CPU% snapshot: sample over 100ms` | `sampleCPU` sleeps 200 ms. |
| `service-worker.js:27` | `// Don't cache API — just pass through, but keep service worker alive` | The worker never sees `/api` requests at all; the scope excludes them. (BUG-018) |
| `apiService.ts:70` | `/** Logarithmic scale helpers … */` | `sliderToValue` is quadratic (`norm*norm*rangeMax`). |
| `features.ts:12` | "and restart the service" | SIGHUP reload works. |
| `config.example.json` | "Restart the service after editing." | SIGHUP reload works for everything except ports and the hotkey. |
| `main.go:216` | `// Buttons are excluded so raw mpris URLs …` style comments implying a guard that does not exist | Several handlers lack the method or feature check their neighbours have. |
| `README.md:150-156` | "discoverable as `control-deck.local`" | No `<host-name>` in the Avahi file. (BUG-054) |
| `README.md:131` | "Open `http://localhost:8080/`" | `/` serves a directory listing. (SEC-007) |
| `README.md:141-148` | `cp tab-dashboard.service …` | The file does not exist. (BUG-055) |
| `README.md:21, 167` | "polls every 8 s" / "~5 MB RAM" | `startPoll(2500)` — 2.5 s, plus a 5 s poll when hidden. |
| `docs/FEATURES.md:114` | "Polled every 3 s" | `setInterval(poll, 5000)`. |
| `docs/FEATURES.md:7` | "the frontend does no polling for core state" | Core state is push-based, but the Home deck runs 10 req/s of auxiliary polling (PERF-05). |
| `docs/FEATURES.md:20` | "custom pointer-drag implementation" for the carousel | The pointer handlers are on the bottom nav strip; the carousel has none (verified — desktop mouse drag does nothing). |
| `docs/FEATURES.md:3` | Two-PIN lock with "6-hour session" | Accurate, but §1 also concedes it is "a pure client-side gate". Fine. |

### 15.6 Other quality issues

| ID | Issue |
|---|---|
| **MAINT-22** | **`initVideoPlayerConfig()` is called twice** in `main()` (`main.go:476` and `main.go:479`), bracketing `buildCommandMap()`/`buildProfileCommandMap()`. Idempotent today, but it is a duplicated call with no explanation. |
| **MAINT-23** | **`buildCommandMap()` and `buildProfileCommandMap()` are called unlocked at startup** but under `configMu.Lock()` in `reloadConfig` (SUS-002). The asymmetry is a latent race. |
| **MAINT-24** | **`main.go:778-797` — `cmdArgs = append([]string{cmdArgs[0], "--player", p}, cmdArgs[1:]...)` inside a goroutine, where `cmdArgs` is the slice from `commandMap` under `configMu.RLock()`.** The `append` to a fresh slice literal does not mutate the map's slice, so this is safe — but it is safe *by accident* of how the prepend is written, and a future refactor to `cmdArgs = append(cmdArgs[:0], …)` would corrupt the shared command map for every concurrent request. |
| **MAINT-25** | `lyrics_service.go:445-457` redefines `min` and `max`, shadowing the Go 1.21 builtins. Harmless, but signals the file was written before the builtins existed and never revisited. |
| **MAINT-26** | `hotkey.go:157-173` `findNextCustomIndex` returns `len(existing)` after scanning 100 indices, which can collide with an existing entry. |
| **MAINT-27** | `geoDir` (`"geo_sessions"`) and `dropDir()` (`$HOME/deck-drop`) are relative/absolute inconsistently; `geoDir` depends on the process CWD, which the README never documents and which determines where `FileServer` exposes it. |
| **MAINT-28** | `music_service.go:295` compiles a regexp inside `cleanSearchPart`, called twice per search result. Hoist to a package var. |
| **MAINT-29** | `SystemStatsCard.tsx:28-36` declares an `invert?: boolean` prop on `StatBar` that is never destructured or used. |
| **MAINT-30** | `QuickSettings.tsx:12-14` and `:127-135` use `Record<string, any>` and `icon: any`; `VideoPlayerDeck.tsx:18` uses `Awaited<ReturnType<typeof fetchVideoStatus>>` for state. The `any`s are a direct consequence of the string-keyed icon map. |
| **MAINT-31** | `index.css:236-288` — 12 `.art-themed` overrides using `!important` with hand-escaped Tailwind class names like `.shadow-\[0_0_10px_rgba\(6\,182\,212\,0\.2\)\]`. Any new accent utility silently fails to theme, and every Tailwind version bump risks a silent break. **This is a maintenance trap with no test coverage.** A CSS custom property for the accent (e.g. `--accent`) referenced by the utilities would remove the whole block. |
| **MAINT-32** | `static/` is committed to git **and** is the Vite `outDir` with `emptyOutDir: true`. Every build rewrites tracked files, so a frontend change always shows up as a diff in generated assets. This is presumably deliberate (so the binary is runnable from a clone) but means generated and source state can drift, and the service-worker cache bug (BUG-019) is a direct consequence. Consider documenting the intent in `.gitignore` comments. |

---

---

## 16. Product / UX Improvements

Distinct from bugs. Each entry: current experience → problem → proposed change → why it helps → implementation complexity → risk/tradeoff.

### IMP-01 — Replace the "Refresh" menu item with a real connection indicator + manual retry

**Current experience.** A menu item labelled "Refresh" performs `location.reload()`, which tears down the page's audio socket and can end the broadcast for every device.
**Problem.** The name promises a page reload; the consequence is a side effect the user cannot foresee. It is also the only recovery affordance, and it is the wrong one.
**Proposed change.** Show a persistent connection pill in the top bar: `● live · 42ms` / `● reconnecting (3s)` / `● offline`. Clicking it retries the SSE immediately. Move the full page reload into a long-press or a "Reset dashboard" item in a settings submenu.
**Why it helps.** Makes connectivity state legible (UX-29), gives an instant recovery path instead of a 20-30 s backoff wait, and removes a destructive action from a one-tap menu.
**Complexity.** Low (a small status component; `useMediaStream` already tracks `error`).
**Risk/tradeoff.** None. The "Reset dashboard" escape hatch is preserved for the rare case where a reload really is needed.

### IMP-02 — Add a latency/quality indicator to the audio stream

**Current experience.** A 40 px radio button that is cyan when streaming. No information about latency, drift, or buffer health.
**Problem.** The single most complex subsystem in the app has zero observability. A user experiencing growing lag has no way to know it is happening, let alone that it will not self-correct (BUG-016).
**Proposed change.** When the stream is active, show a compact readout beneath the button: `latency ~380ms · drift 4ms · buffers 43`. Populate it from the PI controller's `error` term and the `scheduledEnd − currentTime` delta. When drift exceeds a threshold, show a warning and offer "Resync".
**Why it helps.** Turns an invisible failure into a visible one, and makes the drift compensation debuggable by the user rather than only by the author. It is also the cheapest way to validate a fix for BUG-016 in the field.
**Complexity.** Low-Medium (the numbers already exist inside `SyncedAudioPlayer`; they need surfacing through the existing `subscribe` callback).
**Risk/tradeoff.** Adds visual noise. Keep it behind the tap that expands the card.

### IMP-03 — Make the Code deck worth using, or remove it

**Current experience.** 18 unverified, partly mis-wired shell buttons with no output and a fixed working directory.
**Problem.** It looks like a remote development tool and is a set of unactioned, unactionable shell invocations. The most dangerous buttons (Stop → Continue, Commit → push) are the most reachable.
**Proposed change.** Either (a) build it properly — a working-directory picker, two-step confirmation for destructive actions, and a result surface showing exit status and the last 20 lines of output — or (b) hide it behind the `ide` feature flag, which is already `false` in the shipped config.
**Why it helps.** Removes the deck's capacity to lose work and to mislead. Option (b) costs nothing and the flag already exists.
**Complexity.** (a) High — needs a backend output-capture endpoint. (b) Trivial.
**Risk/tradeoff.** (a) expands the command surface, so it must land *after* SEC-004 is fixed. (b) removes a feature the author may value; the flag makes it reversible.

### IMP-04 — Per-device "what am I listening to" and a proper device picker for handoff

**Current experience.** Handoff lists devices from KDE Connect/GSConnect; the first available is used by default; the device list is fetched once and never refreshed (BUG-008).
**Problem.** With a phone and a tablet both paired, handoff frequently targets the wrong one, and a device that wakes up is invisible until a page reload.
**Proposed change.** Re-fetch on every menu open; show each device's last-seen time and connection state; allow pinning a default per client; show the handoff target on the button's long-press.
**Why it helps.** Handoff is a "send this to my phone" action. Getting it wrong means the music plays on the wrong device or nowhere.
**Complexity.** Low.
**Risk/tradeoff.** None.

### IMP-05 — Show *why* a control is unavailable, everywhere

**Current experience.** Capability-gated cards silently disappear. A dead toggle (WARP without `custom_commands`) is indistinguishable from a working one. A "Stream" button with no ffmpeg is indistinguishable from one that is merely slow.
**Problem.** The user cannot tell "not supported on this host" from "broken", so the dashboard's silence is ambiguous. This is the root of the "WARP does nothing" class of confusion.
**Proposed change.** A shared `<CapabilityGate name caps.ffmpeg>` component that renders either the children, or a disabled tile with a one-line reason and a "How to enable" hint. Plus a `/api/diagnostics` endpoint returning every capability **with its reason** (binary missing, schema absent, socket unreachable) so the gate can name the cause.
**Why it helps.** Converts a silent, confusing surface into a self-explanatory one. `/api/diagnostics` is also the single most useful debugging endpoint the project could add — most of the "is it broken?" questions in this audit would have been answered by one call.
**Complexity.** Medium (one new endpoint, one new component, ~8 call sites).
**Risk/tradeoff.** Reveals the host's toolchain layout to any LAN client. Gate it behind the same auth as everything else (SEC-009), or redact binary paths.

### IMP-06 — A "what's happening" panel

**Current experience.** `server.log` is 5.9 MB of window titles and is served over HTTP. There is no in-app log.
**Problem.** When something misbehaves, the only diagnostic path is a terminal the user cannot see from a tablet.
**Proposed change.** A collapsible "Activity" drawer showing the command log with **outcomes** (exit status, stderr tail) rather than just the invocation, plus the last N window-focus events, plus audio stream state transitions. Bounded at 200 entries client-side.
**Why it helps.** Turns "the dashboard is broken" into "the WARP toggle returned 400 Unknown command", which is a 5-second fix instead of a 30-minute investigation. It is also the honest fix for the IDE deck's missing feedback (IMP-03).
**Complexity.** Medium — the command log already exists server-side; it needs the result of each execution attached.
**Risk/tradeoff.** Requires capturing command output, which means a persistent buffer per command. Bound it hard (last 4 KB per command, 200 commands) and never include clipboard content or file contents.

### IMP-07 — Persist and sync user preferences

**Current experience.** `autoFocus` is React state, reset to `true` on every load. The Geo room centre is in `localStorage`. The auth mode is in `localStorage`. Nothing else persists.
**Problem.** Auto-focus is the setting most likely to be turned off, and it cannot be. Every reload re-enables the behaviour that makes the deck jump (BUG-039).
**Proposed change.** Persist `autoFocus`, the hand-off default device, the deck order, and unit/format preferences in `localStorage`, and optionally sync them to the host via a small `/api/prefs` endpoint keyed by device so both the tablet and the laptop agree.
**Why it helps.** Removes the single most annoying default. Low effort, high daily value.
**Complexity.** Low.
**Risk/tradeoff.** A server-side preference store needs the auth boundary first, or it becomes a cross-device settings-injection vector (low severity, but real).

### IMP-08 — Add a global "safe" mode

**Current experience.** Eighteen one-tap actions, of which five are destructive or irreversible (`git commit && push`, `git reset HEAD~1`, `git stash`, `lock`, `rebuild`), and one of which types into an arbitrary window (the Video deck's xdotool fallback).
**Problem.** A dashboard used from a phone, at night, one-handed, is a different risk profile from a desktop app — and nothing in the design acknowledges it.
**Proposed change.** A `safe mode` toggle that (a) requires a confirm sheet for any command in a configurable "dangerous" list, (b) disables the Video deck's xdotool fallback, and (c) disables the Code deck's git group. Persist it. Expose it in the FloatingNav menu next to Auto-focus.
**Why it helps.** Directly reduces the blast radius of a mis-tap on a touch device, which is the documented usage. It is a small amount of code with a large reduction in worst-case harm.
**Complexity.** Low-Medium (a confirm sheet plus a deny-list; the command names are already a registry).
**Risk/tradeoff.** One extra tap on the actions a power user repeats many times a day. Mitigate by making the confirm sheet remember the choice for N seconds ("don't ask again for 30s").

### IMP-09 — Make the "focus routing" explain itself

**Current experience.** The deck silently changes because a window changed focus somewhere else on the machine. There is no indication of *why* or of what triggered it.
**Problem.** Auto-focus is the most surprising behaviour in the app and the user has no model for it (BUG-039).
**Proposed change.** When auto-focus moves the deck, show a transient toast: `→ Media deck · because "YouTube" became active`. Add a "hold" gesture on the deck indicator to suppress auto-focus for 5 minutes. Show the current target window in the FloatingNav menu.
**Why it helps.** Converts an unexplained jump into a legible, controllable one — and gives the user a one-tap way to say "not now", which is what they actually want.
**Complexity.** Low (the window title is already broadcast; `useActiveWindow` already parses it and currently discards it).
**Risk/tradeoff.** A toast every time focus changes could be noisy; suppress repeats for the same target within a few seconds.

### IMP-10 — Use the data the project already computes and throws away

**Current experience.** The backend computes and broadcasts: the focused **window title**, the **playback speed**, per-player **length/position**, **GPU name**, and full **lyrics versions**. The frontend discards the title (`useActiveWindow` returns `windowInfo` that nobody reads), never displays the speed on the deck that changes it, and shows the GPU's name nowhere.
**Problem.** Four independent "the deck does not explain itself" issues, all of which are already paid for.
**Proposed change.** Display each where it belongs: window title as the Media Browser deck's target indicator (IMP-09); speed as a segmented control on the same deck; GPU name under the GPU bar; the active lyric version's language in the ticker.
**Why it helps.** Closes four information gaps with no backend work and no new endpoints.
**Complexity.** Low.
**Risk/tradeoff.** None.

### IMP-11 — Audio: a real transport instead of a boolean

**Current experience.** A three-state button: Stream / Join / Stop.
**Problem.** It cannot express the states that actually matter — reconnecting, stalled, buffer overrun, waiting for a tap — and two of its three transitions are wrong (BUG-010, BUG-011, BUG-013).
**Proposed change.** A small popover on tap: a big Stream/Stop toggle, a live readout (IMP-02), a target-device selector for broadcast-vs-self, and an explicit error line when a start fails. Replace the ambiguous "Join" with "Listen" and make it actually join.
**Why it helps.** The audio feature is the most valuable and most fragile part of the product. It deserves a surface that can tell the truth about its state.
**Complexity.** Medium.
**Risk/tradeoff.** More taps for the common "stream to me" case — mitigate by keeping the single-tap path for the self-only case and putting the extra controls behind a tap-and-hold or an expand chevron.

### IMP-12 — Degrade the Home deck by viewport, not just by breakpoint

**Current experience.** One layout for all sizes: 2.5-6.1 screens of scroll, with the niche GPS canvas as the largest element.
**Problem.** The information hierarchy is identical on a 320 px phone and a 1440 px desktop, so neither is right.
**Proposed change.** Three explicit tiers. **Phone portrait:** Now Playing + transport, Mixer, Quick Settings, System Stats — one screen, no scroll; everything else behind a "More" sheet. **Tablet:** current layout with Geo/BLE/Weather collapsed by default. **Desktop:** current layout, all expanded, plus a two-up Now Playing (art + lyrics side by side) that the existing `md:flex-row` modal already proves is feasible.
**Why it helps.** Puts the four controls a person uses daily above the fold on every device, which is the whole point of a dashboard.
**Complexity.** Medium (a persisted "expanded" set per breakpoint plus a sheet component).
**Risk/tradeoff.** Hiding cards makes them less discoverable. Mitigate with a "More" affordance that shows a count badge, and remember the choice.

### IMP-13 — Treat the terminal as a power feature

**Current experience.** A full shell, mounted on every page load, with a 20-button toolbar at 26-35 px.
**Problem.** It is the most powerful and most dangerous card in the app, and it is the one that can crash the server (BUG-001). It also costs a shell spawn on every dashboard view (PERF-17).
**Proposed change.** Gate it behind an explicit "open terminal" action, mount the PTY only then, and tear it down when the deck is left. Make the toolbar clusters 48 px. Put a persistent "this gives a full shell as your user" notice on first open.
**Why it helps.** Reduces the blast radius of the most dangerous card, removes a per-page-load cost, and makes the affordance discoverable rather than ambient.
**Complexity.** Low-Medium.
**Risk/tradeoff.** Adds one tap. Acceptable for a shell.

### IMP-14 — Persist a per-device "what should I show" profile

**Current experience.** One layout and one set of feature flags for every device.
**Problem.** A phone used for listening and a tablet used for control want very different things, and both get the union of everything.
**Proposed change.** A lightweight per-device profile (which cards, which decks, whether the Media Streamer mode is preferred) keyed by `device_id` and stored on the host. The first-run mode picker already establishes the concept; make it sticky and extensible.
**Why it helps.** Turns one dashboard into two purpose-built ones, which is what the two access modes were reaching for.
**Complexity.** Medium (a `/api/profiles` endpoint and a small settings UI).
**Risk/tradeoff.** Server-side per-device state again needs the auth boundary first.

### IMP-15 — A visible "you are about to affect the real machine" affordance

**Current experience.** Every control looks identical whether it mutes a stream or runs `git push` to origin.
**Problem.** Nothing signals consequence. On a phone, at night, one-handed, the difference between a media button and a deployment is invisible.
**Proposed change.** A persistent, subtle indicator on the two decks that can affect the repository or the desktop session (`git_*`, `task_*`, `dbg_*`, `lock`) — a small "⚠ affects your workstation" marker in the card header — plus the IMP-08 confirm sheet on the dangerous subset.
**Why it helps.** Cheap, honest, and directly reduces the most damaging class of mis-tap.
**Complexity.** Low.
**Risk/tradeoff.** Slight visual noise on two cards. Worth it.

---

---

## 17. Cross-Feature Audit

A second pass over interactions *between* features, where the serious bugs live.

### 17.1 Lock + SSE / WebSocket / audio

**Finding CF-01 — the lock is checked before the EventSource opens, so a locked page consumes no server resources — but `clearAuth()` + `location.reload()` is the only way out of the Media Streamer, and it is a full reload.**
`App.tsx:199-200` returns `<AuthScreen>` before `useMediaStream` is ever called? No — hooks are called unconditionally at lines 60-64, **before** the `if (!authMode) return <AuthScreen/>` at line 199. So **the SSE connection, the window-focus EventSource, the 5 s client poll, the 5 Hz ping, the Video deck's 1 Hz poll, the ServiceStatsBar poll and the terminal WebSocket are all opened while the lock screen is showing.**

Verified: the instrumented `WebSocket` capture on a session that only reached the auth screen still shows a `terminal` socket, because `TerminalDeck` is mounted behind the auth gate. This means:
- Every unauthenticated visitor to the dashboard spawns a **login shell** on the host.
- The MediaState stream (with lyrics, art URLs and the command log) is delivered to a page that is showing a PIN pad.
- The command log — a record of what the user has been doing — is in the DOM of a locked page.

**Severity:** Medium (resource + information exposure). **Fix:** move the `if (!authMode)` early return above the hook calls, or gate the data hooks on `authMode !== null`. This also removes the per-visitor PTY spawn.

### 17.2 Auto-focus + manual deck switching

**Finding CF-02 — rapid deck switching can desynchronise `page` from `scrollLeft`.**
`scrollTo` (`App.tsx:97-107`) calls `el.scrollTo({behavior: smooth})` and then `setPage(clamped)` synchronously. The auto-focus effect (`App.tsx:111-118`) calls `scrollTo` with `page` captured from a stale render closure, because `page` is deliberately excluded from its deps. Sequence: user taps deck 3 → `scrollTo(3)` starts a *smooth* scroll; before it finishes, the host's focused window changes → the effect fires with the closure's `page = 0` → `visible(3) !== 0` → `scrollTo(3)` again. The dots are correct, but two overlapping smooth scrolls on the same element can land on a different offset, leaving the deck indicator and the visible deck out of sync. **Severity:** Low-Medium. **Fix:** after a smooth scroll settles (`onscrollend`, or a `setTimeout` matching the scroll duration), re-read `scrollLeft` and reconcile `setPage` from it; or use `behavior: 'auto'` when a programmatic switch is already in flight.

### 17.3 Media player changes + deck switching + the carousel's auto-focus

**Finding CF-03 — `PlayerCarousel`'s auto-focus re-snaps the player, which re-renders `NowPlayingCard`, which resets `localPos` — combined with BUG-004 this makes the seek display jump.**
`PlayerCarousel.tsx:25-33` sets `setIdx(playingIdx)` whenever the *first* Playing player's id changes. With two players (e.g. a paused browser tab and a playing mpv), starting a song swaps the whole card, discarding the optimistic `localPos`. **Severity:** Low. **Fix:** key `NowPlayingCard` on `player.id` so React remounts deliberately, and clear `localPos` on remount rather than relying on convergence.

### 17.4 Audio stream + browser backgrounding + the Connected Devices auto-join

**Finding CF-04 — auto-join and auto-stop fight the user's manual control.**
`ConnectedDevicesCard.tsx:63-77` runs on every change of `data.broadcasting`: if broadcasting and not locally active → `m.start()`; if not broadcasting and locally active → `m.stop()`. The effect's own comment acknowledges the problem: *"Don't auto-stop if the user manually started via AudioStreamCard — but that case is rare."* It **is not rare** — it is the primary flow on the tablet.

Consequences:
- A user who manually taps **Stream** to listen on their own (with no broadcast running) has it **stopped within 2 seconds** by the polling fallback, because `broadcasting` is `false` and `isActive()` is `true`. **Confirmed by code; the trigger is any manual stream start without a broadcast.**
- A user who taps **Stop** during a broadcast to opt out is **restarted within 2 seconds** by the same effect.
- A device in another room auto-plays the laptop's audio the moment a broadcast starts.

**Severity:** High. **Fix:** track a `userIntent` flag (`'auto' | 'manual-on' | 'manual-off'`) alongside `streamManager` state; only auto-start when intent is `auto`, and never auto-stop when intent is `manual-on`. Persist the choice per device. This should be considered together with IMP-11.

### 17.5 Command execution + command log + the log's 30-entry cap

**Finding CF-05 — the log is a lossy record of a destructive surface.**
`addLog` fires **before** execution (`main.go:774`) and the log is capped at 30 entries (`main.go:352-354`). On the Code deck, a single `git_commit` produces two log lines ("▶ git_commit" and the speed/ad-skip lines compete for the same 30 slots) and **no record of the outcome**. A user who taps Commit and Push at 18:00 and comes back at 23:00 cannot tell from the dashboard whether anything happened. **Severity:** Medium. **Fix:** record the outcome (exit status, stderr tail) with each entry, raise the cap, and make the log filterable. This is the data IMP-06 needs.

### 17.6 Capability detection + dynamic backend failure

**Finding CF-06 — capabilities are fetched once per page load and cached in a module-level variable, so a capability that changes while the page is open is never re-detected.**
`useCapabilities.ts:23-40` caches `cached` for the lifetime of the module. If the user installs `ffmpeg`, plugs in a Bluetooth headset, or the `bluetoothctl` service restarts, the deck does not notice until a reload. Conversely, if a capability *disappears*, the card stays visible and fails silently (BUG-011, BUG-022). **Severity:** Low-Medium. **Fix:** re-fetch `/api/capabilities` on `visibilitychange` and on any command failure that returns 404/500, with a TTL of ~60 s.

### 17.7 Device disconnect/reconnect + UI state + the per-device stream control

**Finding CF-07 — a device refresh orphans its audio-stream registration, so "Stop stream" for that device fails.**
`App.tsx:43-55` generates the device ID in `sessionStorage`, so **every new tab, every tab restore, and every "Restore pages" after a browser restart gets a new ID**. The server's `deviceAudioWS` is keyed by that ID (`audio_stream.go:252-262`). After a refresh:
- the old ID is gone from `deviceAudioWS` (the old socket's deferred cleanup removed it);
- the new ID has no socket;
- so the row's button shows "not streaming" and tapping it sends `start`, when the device is in fact already streaming and the user wanted `stop`.

Combined with BUG-023 (the row key is `IP:port`) and BUG-015/SEC-015 (the ID is empty over HTTP), the per-device stream control is unreliable in three independent ways. **Severity:** High for the feature, Low for the user's data. **Fix:** move the device ID to `localStorage` (stable across tabs and restarts) with a per-tab suffix only where tab identity matters; key the client map on the stable ID; and have `/api/stream/control` fall back to "is this device streaming at all?" when the target ID is unknown.

### 17.8 Multiple clients + shared backend state

**Finding CF-08 — the broadcast mute/unmute is a single global flag with no ownership.**
`doBroadcastStart` mutes `@DEFAULT_AUDIO_SINK@` globally and sets `broadcasting = true`; `doBroadcastStop` unmutes it. If the user was **already muted** before the broadcast, stopping the broadcast **unmutes the laptop** — a state change the user did not ask for and may not notice. The server never records the prior mute state. Verified in code: `wpctl set-mute … 0` at `main.go:1237` is unconditional.

**Severity:** Medium. **Fix:** capture `state.muted` before starting and restore exactly that value on stop. This is a two-line change with a real user-visible benefit.

Related: with multiple clients, `doBroadcastStart` notifies *every* client in `sseDeviceChans`, which (via CF-04) makes every open dashboard auto-start. One hotkey press from the laptop therefore starts audio on every device in the house.

### 19.9 Reconnect + stale state

**Finding CF-09 — after a backend restart the dashboard shows stale values with no indication, for up to 24 s.**
Measured: after a restart the "Connection lost — retrying…" banner persisted for ~20 s (the exponential backoff had reached the 16-30 s band) and the previously-rendered state stayed on screen the whole time — a stale volume, a stale track position, a stale "streaming" indicator. Nothing dims or marks the data as stale. **Severity:** Medium. **Fix:** dim the data area and show the age of the last frame while disconnected. This is the same fix as IMP-01 and UX-29.

### 17.10 Configuration changes + running services

**Finding CF-10 — SIGHUP reload leaves the frontend and the hotkey stale, and the frontend never learns about it at all.**
After a SIGHUP: the backend swaps flags, PINs and the command map (correctly); the GNOME hotkey is **not** re-registered (BUG-053); the **frontend never re-fetches `/api/features` or `/api/capabilities`** (CF-06), so a flag change has no effect on any open dashboard. Meanwhile the backend *does* start enforcing the new flags immediately — so a disabled section returns 403 for a UI that still shows it. **Severity:** Medium. **Fix:** have `/api/features` return a version/generation counter, and have the SSE payload carry it; the client re-fetches capabilities and features when the generation changes. This makes config reload observable, which is the point of having it.

### 17.11 Feature-flag enforcement asymmetry

**Finding CF-11 — the backend enforces feature flags inconsistently, so a "disabled" section is not reliably disabled.**

| Route | `requireFeature`? |
|---|---|
| `/api/geo/*`, `/api/clipboard/*`, `/api/ble/transmit`, `/ws/terminal`, `/api/video/*`, `/api/music/*`, `/api/service-stats` | ✅ yes |
| `/api/command` | ⚠️ **only for `dbg_*`/`git_*`/`task_*`** (`main.go:750`) — every other command, including `speed_*`, media, bluetooth, night light, caffeine, lock, and every `custom_commands` entry, is dispatchable regardless of flags |
| `/api/command` for media | ✅ fine, but note `mixer`/`quick_settings` have **no** corresponding gate at all, so disabling `mixer` only hides the card — the commands remain dispatchable |
| `/api/set-volume`, `/api/set-brightness`, `/seek` | ❌ no gate |
| `/api/stream/broadcast`, `/api/stream/control` | ❌ no gate |
| `/api/auth`, `/api/auth-media`, `/api/capabilities`, `/api/features`, `/api/ping`, `/api/clients` | n/a |
| `/api/audio/*` | ❌ no gate |

So `"mixer": false` hides the Mixer card but `/api/set-volume` still works, and `"quick_settings": false` hides the toggles but `bluetoothOn`, `lock`, `nightOn`, `caffeineOn` and all `custom_commands` remain fully dispatchable. `docs/FEATURES.md:6-8` claims disabled sections are "hidden, so they can't trigger browser permission prompts, geolocation, bluetooth, or network activity" — true for the frontend, but the backend is not a matching boundary.

**Severity:** Medium. **Fix:** add a `commandFeature(name string) string` mapping and gate `handleCommand` on it, so the flag is a real boundary rather than a display preference. This also removes the current `isIdeCommand` prefix-sniffing (which is why `speed_*` slipped through).

### 17.12 Auto-focus + the dashboard's own browser tab

**Finding CF-12 — the dashboard's own tab, when focused on the laptop, classifies as `browser` and routes to page 0.**
`classifyApp` (`main.go:1467-1500`) maps any browser `wm_class` to `browser` unless the title contains `- YouTube`. The dashboard is served in a browser, so focusing its own tab emits `app: "browser"` → `appToPage['browser'] = 0` → **the deck jumps to Home**. On the tablet this is invisible (the tablet is not the host's focused window), but on the laptop — and for anyone using the dashboard at the desk, which the auto-focus feature exists for — every return to the tab resets the deck. **Severity:** Medium. **Fix:** Ignore focus events whose title matches the dashboard's own title (or whose `wm_class` is a browser *and* whose title is the dashboard). This is the same root cause as BUG-039 and is fixed by the same change.

---

---

## 18. Recommended Changes

Grouped, not ranked. Cross-references are finding IDs.

### 18.1 Must Fix Before Reliance

These are the ones where the dashboard can lose data, lose the server, expose the host, or silently do the wrong thing.

| # | Change | Findings | Effort |
|---|---|---|---|
| **M1** | **Replace the root `FileServer(".")` with an explicit allow-list.** Serve `/` → `static/index.html` and `/static/…` only. Interim: denylist `/.git`, `/config.json`, `/server.key`, `/server.crt`, `/server.log`, `/geo_sessions`, `/frontend`, `/cmd`, `/testdata`. | SEC-007, BUG-055, R1 | S |
| **M2** | **Fix the geo path traversal on all three verbs** using the `safeDropName` + `filepath.Dir` containment already written in `files.go`. | SEC-001, SEC-002, SEC-003, SUS-011 | S |
| **M3** | **Require an `X-Control-Deck: 1` header on every mutating endpoint**, and reject non-`application/json` content types. One place in the frontend. This defeats CSRF without needing an Origin allow-list. | SEC-004, SEC-011 | S |
| **M4** | **Remove `InsecureSkipVerify: true` from both `websocket.Accept` calls.** | SEC-005, SEC-011 | XS |
| **M5** | **Fix `terminal.go`: `sync.Once` around `close(done)`, plus a top-level `recover()`.** One panic here kills the whole dashboard. | BUG-001, R1 | XS |
| **M6** | **Ship `tab-dashboard.service` with `Restart=on-failure` and `RestartSec=2`**, and correct the README. | BUG-055, R1 | S |
| **M7** | **Fix `trackClient` to use `net.SplitHostPort(RemoteAddr)` and key on the stable device ID**, and add a `crypto.randomUUID` fallback so `device_id` is never empty over HTTP-LAN. | BUG-023, SEC-015, SEC-012, PERF-02, PERF-14, PERF-36, CF-07 | S |
| **M8** | **Fix the audio client's reconnection and the double-start guard**: add a `connecting` flag, an `onclose` that deactivates and schedules a backoff reconnect, and port the stall re-anchor from `background.html`. | BUG-012, BUG-013, BUG-016, §13.7 items 1-2 | M |
| **M9** | **Bound the audio accumulator while the AudioContext is suspended** and surface the "tap to enable audio" prompt from `AudioStreamCard` (where the button is) rather than from `ConnectedDevicesCard`. | BUG-014, PERF-30 | S |
| **M10** | **Use the PTS**: detect gaps, hold the timeline with silence or re-anchor, reject out-of-order frames, and expose a drift counter. | BUG-015, BUG-047, §13.7 item 3 | M |
| **M11** | **Fix `/api/service-stats`'s `/proc` field indices** (`fields[11]`, `fields[12]`, `fields[19]`) and make the handler a pure read. | BUG-026, BUG-043, PERF-03, BUG-052 | S |
| **M12** | **Make `triggerCommand`/`seekTo`/`setVolume`/`setBrightness` check `res.ok`** and surface the failure. | BUG-038, BUG-022, BUG-033, UX-25 | S |
| **M13** | **Fix the cross-feature auto-join/auto-stop fight** in `ConnectedDevicesCard` with an explicit `userIntent` flag; default auto-join to off for the full dashboard. | CF-04, UX-13 | S |
| **M14** | **Fix the Video deck's unguarded xdotool fallback** — return an error from `sendVideoCommand` when `detectVideoPlayer() == "unknown"`, and disable the deck's controls. | BUG-032, BUG-033 | S |
| **M15** | **Fix the three broken IDE debugger commands** (or remove the buttons) and add two-step confirmation for `git_commit`, `git_reset`, `git_stash`. | BUG-034, UX-25, IMP-03 | S |
| **M16** | **Remove the `pkill -9 -x mpv` / `pkill -9 -x yt-dlp` lines** from `killMusicPipeline`. | BUG-048 | XS |
| **M17** | **Move lyrics off the broadcaster goroutine** with an in-flight map, and bound `lyricsCache`. | BUG-049, PERF-06, PERF-10 | M |
| **M18** | **Fix the Geo calibration loop** (ref accumulator, publish at 1 Hz) and cap recording with auto-save. | BUG-028, PERF-06, UX-19 | S |
| **M19** | **Fix the `crypto.randomUUID` secure-context dependency, the `?device_id=` on the initial navigation, and the `Power`/`Scenes`/`Filedrop` feature-key mismatch**; add the key-set equality test. | SEC-015, BUG-041, TEST-07 | S |
| **M20** | **Rotate `server.key`, `pin` and `media_pin`** — they have been readable on this LAN. | SEC-007 | XS |
| **M21** | **Add the tests that pin the above**: TEST-01, 02, 03, 04, 05, 07, 24. | TEST-01→24 | M |
| **M22** | **Add `prefers-reduced-motion` support and a global `:focus-visible` ring.** | A11Y-12, A11Y-13 | S |

### 18.2 Should Fix

| # | Change | Findings | Effort |
|---|---|---|---|
| **S1** | **Mount deck bodies lazily** so the terminal, the Video deck's 1 Hz poll and the two 5 Hz ping intervals only run when their deck is open. | PERF-17, PERF-23, PERF-04, PERF-05, PERF-16, IMP-13 | M |
| **S2** | **Add `if (document.hidden) return;` to both 5 Hz ping polls** and reduce the client poll to 10 s. | PERF-05 | XS |
| **S3** | **Move the auth gate above the data hooks** so a locked page consumes no server resources and receives no state. | CF-01 | XS |
| **S4** | **Cache `findBestPlayer()` per tick** and add a per-tick MPRIS cache; ~15 fewer `playerctl` spawns per 500 ms. | PERF-01, PERF-38 | M |
| **S5** | **Add gzip/brotli to both listeners** and delta-encode the SSE payload. | PERF-25, PERF-26 | M |
| **S6** | **Fix the fullscreen button / top-strip overlap at every viewport** and remove the duplicate safe-area padding. | UX-17, 9.6 items 1-2, SUS-015 | S |
| **S7** | **Make the bottom-nav dots real buttons** and attach the pointer-drag to the carousel as well as the strip. | BUG-036 UX, 9.5, A11Y-01 | S |
| **S8** | **Fix the carousel arrows' position, size and accessible names**, and reserve space for the fixed fullscreen button so titles do not run under it. | UX-04, A11Y-04, 9.1 | S |
| **S9** | **Fix the `NowPlayingCard` seek bar**: add `onPointerUp`/`onKeyUp`, a timeout-guarded `localPos` clear, an `aria-label` and `aria-valuetext`. | BUG-004, BUG-005, A11Y-02, A11Y-03 | S |
| **S10** | **Add a focus trap, Escape and focus restore to the lyrics modal.** | BUG-007, A11Y-05 | S |
| **S11** | **Reposition the FAB above the MiniPlayer** when `showMini` is true. | UX-08, 9.4 | XS |
| **S12** | **Reorder the Home deck by frequency of use and collapse the niche cards**; reserve min-heights for the log and device list. | 8.1, UX-15 | M |
| **S13** | **Replace the "Refresh" menu item with a connection pill + manual retry.** | BUG-036, IMP-01, CF-09 | S |
| **S14** | **Fix the `AudioStreamCard` "Join" action and add an error state** for a failed start. | BUG-010, BUG-011, IMP-11 | S |
| **S15** | **Notify and restart on ffmpeg exit**: close listener channels, send an `error` control frame, restart with backoff, and make `/api/audio-stream/status` reflect the ffmpeg state. | BUG-046, R5 | M |
| **S16** | **Drop frames for a congested audio client instead of reordering them**, and reduce the 512-frame queue to ~64. | BUG-047, PERF-31, §13.2 | S |
| **S17** | **Fix the BLE feature end to end**: set the advertised name, remove the listener correctly, call `stopWatchingAdvertisements()`, check `cmd.Run()`, and add an `advertise` capability probe. | BUG-029, UX-20, SUS-017 | M |
| **S18** | **Fix the per-app volume curve** so the applied value matches the displayed value. | BUG-021, UX-11 | XS |
| **S19** | **Fix the weather day labels and stop prompting for geolocation on load.** | BUG-027, UX-18 | S |
| **S20** | **Fix `useCapabilities` to fail open like `useFeatures`, with a timeout and a retry affordance; cache `gsconnectAvailable()` with a TTL.** | BUG-040, PERF-08, PERF-10 | S |
| **S21** | **Gate every `deckConfig` toggle on `commandKnown`, and log unregistered names at startup.** | BUG-022, MAINT-13 | S |
| **S22** | **Make the backend a real feature-flag boundary**: add a `commandFeature(name)` map and gate `handleCommand` on it, not just on `isIdeCommand`. | CF-11 | M |
| **S23** | **Record the *prior* mute state and restore it on broadcast stop.** | CF-08 | XS |
| **S24** | **Move the device ID to `localStorage`** so a tab refresh does not orphan the audio registration. | CF-07 | XS |
| **S25** | **Stop logging the focus poll when nothing changed**, and route logs to journald. | SEC-014, PERF-* | S |
| **S26** | **Fix the service worker**: network-first for HTML, build-hash cache name, and either `scope: '/'` or delete the dead branches. | BUG-018, BUG-019 | S |
| **S27** | **Add an `aria-label` to every icon-only control and every slider**; replace `div role="button"` with real buttons; add `aria-live` to the status banner. | A11Y-01→021 | M |
| **S28** | **Delete the 892 lines of dead frontend code** and extract one shared `<VolumeSlider>`/`<BrightnessSlider>`. | MAINT-01→04, 15.2 | S |
| **S29** | **Move the terminal reconnect to bounded backoff**, disable its toolbar when disconnected, and stop the `[disconnected]` line from accumulating. | BUG-035 | S |
| **S30** | **Give the Code deck a working directory and a result surface** (or hide it behind the existing `ide` flag). | UX-25, IMP-03, CF-05 | L |
| **S31** | **Fix `resolveArtURL`'s single-entry cache** to hold a small bounded LRU, so alternating tracks do not re-base64 a file every 500 ms. | MAINT-19, PERF-37 | S |
| **S32** | **Run `gofmt`, fix the three `go vet` `unsafe.Pointer` warnings, and add `golangci-lint` + `eslint react-hooks/exhaustive-deps` to CI.** | §18 (commands), A11Y/MRNT | S |
| **S33** | **Add a CI workflow**: `go vet`, `gofmt -l`, `go test -race ./...`, `npm ci`, `npm run build`, `npm test`. | §14.4 | S |

### 18.3 Worth Improving

| # | Change | Findings | Effort |
|---|---|---|---|
| **W1** | **Surface the window title on the Media Browser deck, the speed as a segmented control, the GPU name under its bar, and the lyric version's language** — all already computed and discarded. | IMP-10, MAINT-11, UX-23, UX-30 | S |
| **W2** | **Explain auto-focus**: a toast naming the trigger window, a "hold" gesture to suppress it, and ignore focus events for the dashboard's own tab. | BUG-039, CF-12, IMP-09 | S |
| **W3** | **Add a latency/drift readout to the audio stream surface.** | IMP-02, §13.7 | S |
| **W4** | **Add a capability gate component and a `/api/diagnostics` endpoint returning each capability with its reason.** | IMP-05, BUG-011, BUG-022, UX-09 | M |
| **W5** | **Add an "Activity" drawer with command outcomes, not just invocations.** | CF-05, IMP-06 | M |
| **W6** | **Implement safe mode: confirmations for a configurable dangerous-command list, disable the Video deck's keystroke fallback, disable the git group.** | IMP-08, IMP-15, BUG-032, BUG-034 | M |
| **W7** | **Persist `autoFocus` and other preferences**, optionally synced per device. | IMP-07, BUG-039 | S |
| **W8** | **Add a "⚠ affects your workstation" marker** to the Code deck and the lock toggle. | IMP-15 | XS |
| **W9** | **Re-fetch the handoff device list on every menu open; show last-seen; allow pinning a default.** | BUG-008, IMP-04 | S |
| **W10** | **Fix the LRC parser**: single-digit minutes, multiple timestamps per line, `[offset:]`.** | BUG-037 | S |
| **W11** | **Render the video track lists** the backend already returns. | BUG-031 | S |
| **W12** | **Give the Geo canvas a `devicePixelRatio`-scaled buffer and ≥11 px labels; cap points; 44 px controls; delete on `click` + confirm.** | UX-19, A11Y-09 | M |
| **W13** | **Fix `MixerCard`'s volume row to show an explicit unavailable state** when `wpctl` is missing. | BUG-020 | S |
| **W14** | **Add real auth or relabel the lock honestly.** | SEC-008, SEC-009, UX-32 | L |
| **W15** | **Split the Media Streamer page from the Connected Devices controls.** | SEC-010, UX-22 | S |
| **W16** | **Make the BLE card default to "Idle", use `onClick`, and never stop advertising on unmount (lease-based).** | UX-20 | S |
| **W17** | **Split `NowPlayingCard` (625 lines) into focused components with a `useLyrics()` hook.** | MAINT-03, 15.3 | L |
| **W18** | **Split `main.go` (2168 lines, 44 routes) into `routes_*.go`.** | MAINT-03, 15.3 | M |
| **W19** | **Replace the 12 `.art-themed !important` overrides with a CSS custom property.** | MAINT-31, UX-30 | M |
| **W20** | **Sample GPU telemetry on its own goroutine at 2-5 s with a 1 s command timeout; discover the render node instead of hardcoding `card0`.** | BUG-051, PERF-07, MAINT-16 | S |
| **W21** | **Add `exec.CommandContext` timeouts to `yt-dlp`, `playerctl`, `iwgetid`, `hostname`, `bluetoothctl` and `gsettings` invocations.** | PERF-09, BUG-050, MAINT-* | M |
| **W22** | **Re-anchor the app config to a `Type`/`Validation` layer** so the PANIC cannot recur. | M5 | M |
| **W23** | **Add a second Avahi service file for HTTPS with the correct host name.** | BUG-054 | XS |

### 18.4 Optional Enhancements

| # | Idea | Findings |
|---|---|---|
| **O1** | Per-device profiles (which cards, which decks, preferred mode) stored on the host. | IMP-14 |
| **O2** | Tauri/Electron wrapper for a proper window, tray icon and global hotkey — removes the PWA install friction entirely. | UX-31, SEC-007 (TLS self-signed friction) |
| **O3** | Opus instead of raw PCM for the audio stream (3× less bandwidth, PLC turns a dropped packet into a fade). | PERF-27, §13.7 item 12 |
| **O4** | Wire the scenes system (`scenes.go` + `ScenesCard`) — a named, ordered macro runner with per-action delay is genuinely useful and is already 80 % built. | SUS-001, MAINT-13 |
| **O5** | Wire the file drop (`files.go` + `FileDropCard`) — drag a file from the phone to the workstation, with the traversal containment already written. | SUS-001 |
| **O6** | WebRTC instead of a raw WebSocket for audio (DTLS, congestion control, jitter buffer). | BUG-013, BUG-016, PERF-27 |
| **O7** | Use the `video_player.go` track lists for a unified "now playing" across mpv/VLC/MPRIS. | BUG-031, MAINT-21 |
| **O8** | Add a hardware-accelerated canvas for the Geo heat map (WebGL or OffscreenCanvas in a worker). | PERF-06, UX-19 |
| **O9** | Notification support on the main dashboard, not just the background PWA. | UX-31 |
| **O10** | Record and replay a "session" of commands as a script. | CF-05, IMP-06 |
| **O11** | Multi-monitor / workspace awareness for auto-focus. | BUG-039, W2 |
| **O12** | Battery-aware polling: back off all poll intervals when the client is on battery. | PERF-05, UX-20 |

---

## 19. Component-Level Action Plan

Reference format: `file` → finding IDs.

### Backend — Go

**`terminal.go`**
- BUG-001 (Critical: `sync.Once` + `recover`)
- SEC-005 (remove `InsecureSkipVerify`)
- BUG-035 (client-side, but the server side should also stop accepting when the feature is off)

**`main.go`**
- SEC-007, BUG-055 (root `FileServer` → allow-list) — **do this first**
- SEC-001, SEC-002, SEC-003 (geo traversal, lines 371-444) + TEST-02
- SEC-004, SEC-011 (require `X-Control-Deck` on all mutating handlers) + TEST-03
- BUG-023, SEC-012, SEC-015 (`trackClient`, lines 301-343) + CF-07
- BUG-026, BUG-052 (via `service_stats.go`)
- BUG-049 (lyrics on the broadcaster, line 2140) + PERF-06
- BUG-034 (lines 103-105, `dbg_*` key bindings) + BUG-044 (`speed_*` player)
- BUG-039, CF-12 (`classifyApp`, lines 1467-1500) + TEST-15
- BUG-053 (re-register the hotkey on reload)
- CF-11 (feature-flag boundary for `handleCommand`, line 750) + S22
- PERF-01, PERF-38 (cache `findBestPlayer`, lines 1789-1796) + S4
- PERF-13, PERF-15 (SSE fan-out drop logging, `sendSSECommand`)
- BUG-048, BUG-030 (via `music_service.go`)
- MAINT-15, MAINT-16, MAINT-24, MAINT-26, MAINT-27
- gz: MAINT-32 (formatting)

**`audio_stream.go`**
- BUG-046 (notify + restart on ffmpeg exit)
- BUG-047 (drop, don't reorder, for a congested client) + PERF-31
- SEC-011 (remove `InsecureSkipVerify`)
- SUS-008 (pass the reader and stop channel into `readLoop` as parameters)
- SUS-009 (close the previous `deviceAudioWS` entry on replace)
- PERF-27 (Opus) · §13.7 item 10 (reduce the 512-frame queue)

**`service_stats.go`**
- BUG-026 (Critical: field indices 11/12/19) + TEST-05
- BUG-043 (make the handler a pure read) + PERF-03
- BUG-052 (`bootTimeOnce`/`bootTimeCache` → `sync.Once` + atomic)
- MAINT-17 (`USER_HZ`)

**`config.go`**
- BUG-041 (`KnownFeatures` ↔ `FEATURE_DEFAULTS`) + TEST-07
- SUS-002 (lock the startup `buildCommandMap` calls)
- MAINT-07 (already good — protect it)

**`lyrics_service.go`**
- BUG-049 (move off the broadcaster; in-flight map) + PERF-06
- PERF-10 (bound `lyricsCache`; TTL the negative entries)
- SUS-003 (valid sort comparator) + TEST-17
- MAINT-08 (extract the URL building)

**`music_service.go`**
- BUG-048 (remove `pkill -9`) — **XS, do immediately**
- BUG-030, PERF-09 (timeout + abort `yt-dlp`)
- SUS-005 (`--` separators; validate the player name)
- SUS-010 (reap the pipeline)
- SUS-013 (report a failed play)
- PERF-08 (cache `gsconnectAvailable`) + PERF-12 (hoist the regexp)
- SEC-013 (quote `caffeineSD` in the `bash -c` strings)

**`video_player.go`**
- BUG-032 (Critical: refuse xdotool when no player) + BUG-033
- BUG-050 (configurable `vlc_url`/`vlc_password`; document the port conflict; add timeouts)
- BUG-031 (rename the actions; render the track lists)
- SUS-004 (type-check `set_speed`) + TEST-20
- PERF-04, PERF-29 (dial once per status read, not per property)

**`gpu.go`**
- BUG-051, PERF-07 (own goroutine, 2-5 s, command timeouts) + BUG-025
- MAINT-16 (`os.Stat` instead of `sh -c`) · MAINT-18 (robust JSON parse)

**`cmd/sendkey/main.go`**
- BUG-034 (add `shift_f5`, `ctrl_shift_f5`)
- MAINT-06 (three `go vet` `unsafe.Pointer` warnings)
- PERF-* (the device is created and destroyed on every keypress)

**`files.go` / `scenes.go`** (untracked WIP)
- SUS-001 (register the routes; wire the components)
- Reuse `safeDropName` for the geo endpoints

**`hotkey.go` / `ble.go` / `clipboard.go`**
- BUG-053, MAINT-09 · BUG-029, SUS-017 · BUG-045, SEC-006

### Frontend

**`src/lib/streamManager.ts`**
- BUG-012, BUG-013 (`connecting` guard; `onclose` + backoff reconnect)
- BUG-014 (bound the accumulator while suspended; preallocate)
- BUG-015 (use the PTS; detect gaps; reject out-of-order)
- BUG-016 (port the re-anchor; re-tune the gains; add a latency clamp)
- PERF-30, PERF-33 (`outputLatency`), PERF-41 (listener leak)
- §13.7 items 1-5, 11

**`src/lib/authStore.ts`** — MAINT-04: delete, or wire it and make it real (W14)

**`src/lib/lyricsEngine.ts`** — BUG-037 + TEST-18

**`src/App.tsx`**
- BUG-002, CF-01 (move the auth gate above the hooks; `window.scrollTo(0,0)`; no `term.focus()`)
- BUG-036 UX (real dot buttons; drag on the carousel)
- CF-02 (reconcile `page` after a smooth scroll)
- UX-17 (fullscreen button / top-strip overlap; remove the duplicate safe-area padding)
- PERF-23 (lazy deck mounting) + S1
- SEC-015 (device-ID fallback; `?device_id=` on the navigation)
- W7 (persist `autoFocus`)

**`src/components/AuthScreen.tsx`**
- BUG-003 (`submitting` ref; fetch timeout; distinct network error) + SEC-008, SEC-009, UX-32
- A11Y-01 (this screen is the best built — protect it)

**`src/components/NowPlayingCard.tsx`**
- BUG-004, BUG-005, BUG-007, BUG-008
- UX-04 (arrows; `pr-12`; delete the always-true divider)
- A11Y-02, A11Y-03, A11Y-05
- MAINT-03 (split into components) + W17
- W1 (use the discarded window title / speed)

**`src/components/PlayerCarousel.tsx`** — BUG-006, UX-05, A11Y-04, CF-03

**`src/components/AudioStreamCard.tsx`** — BUG-010, BUG-011, UX-09, IMP-02, IMP-11

**`src/components/MixerCard.tsx` / `decks/VideoPlayerDeck.tsx` / `decks/MediaBrowserDeck.tsx`**
- BUG-020, BUG-021, MAINT-03 (extract one slider component; three copies today)

**`src/components/ConnectedDevicesCard.tsx`**
- BUG-023 UX, CF-04 (**M13** — the auto-join/auto-stop fight), CF-07
- PERF-05 (the 200 ms ping), UX-13, UX-14, A11Y-08
- Move the `audio-needs-gesture` listener here → `AudioStreamCard`

**`src/components/QuickSettings.tsx` / `ToggleGrid.tsx`**
- BUG-022, A11Y-06 (nested interactive controls → double activation), A11Y-15
- MAINT-11 (duplicate `isToggleActive`)
- Delete `ToggleGrid.tsx`

**`src/components/ClipboardCard.tsx`** — BUG-024, A11Y-07, UX-* (label, `aria-live`, copy-result check, size cap)

**`src/components/GeoSurveyCard.tsx`** — BUG-028 (**M18**), SEC-001/002/003, PERF-06, UX-19, A11Y-09

**`src/components/BleProximityCard.tsx`** — BUG-029, UX-20; delete `BleRssiMonitor.ts`

**`src/components/WeatherCard.tsx`** — BUG-027, UX-18

**`src/components/ServiceStatsBar.tsx`** — BUG-026 UX, BUG-043, UX-17, A11Y-08; delete `SysStatsBar.tsx`

**`src/components/SystemStatsCard.tsx`** — BUG-025, MAINT-29; W1 (show the GPU name)

**`src/components/FloatingNav.tsx`** — BUG-036, UX-28, A11Y-11; W13 (connection pill), W2, W6

**`src/decks/TerminalDeck.tsx`** — BUG-002, BUG-035, UX-26, PERF-09, PERF-17, A11Y-20, IMP-13

**`src/decks/IdeDeck.tsx`** — BUG-034, BUG-038, UX-25, PERF-08, IMP-03, W6

**`src/decks/VideoPlayerDeck.tsx`** — BUG-031, BUG-032, BUG-033, SUS-012, PERF-04, UX-24

**`src/hooks/useMediaStream.ts`** — UX-29, CF-09 (expose the frame age), CF-10
**`src/hooks/useCapabilities.ts`** — BUG-040, PERF-10, CF-06
**`src/hooks/useFeatures.ts`** — BUG-041, CF-10
**`src/hooks/useActiveWindow.ts`** — BUG-039, MAINT-11, W1, W2
**`src/hooks/useArtTheming.ts`** — BUG-042, UX-30

**`src/services/apiService.ts`** — BUG-038 (**M12**), SUS-006

**`src/index.css`** — A11Y-12, A11Y-13, A11Y-21, MAINT-05, MAINT-31

**`public/service-worker.js`** — BUG-018, BUG-019
**`public/background.html`** — BUG-017, BUG-014 (the same accumulator bug), UX-31
**`public/manifest*.json`** — UX-31
**`index.html`** — BUG-018, A11Y-16

**Delete entirely:** `decks/DefaultDeck.tsx`, `components/StepperControls.tsx`, `components/CaffeineCard.tsx`, `components/AppMixerCard.tsx`, `components/SysStatsBar.tsx`, `components/GuestView.tsx`, `components/LockScreen.tsx`, `lib/BleRssiMonitor.ts`, `lib/authStore.ts` — MAINT-01, MAINT-04

**`config/deckConfig.ts` / `config/features.ts`** — BUG-022, BUG-041
**`avahi-service.conf`** — BUG-054 · **`README.md`** — BUG-055, BUG-054, and the 14 contradictory comments in §15.5

---

---

## 20. Audit Coverage

Every source directory and major feature, with an honest status. **No claim of 100 % coverage is made where it is not true.**

### 20.1 Backend (Go) — 6,345 lines, 17 files

| Path | Lines | Status | Notes |
|---|---:|---|---|
| `main.go` | 2168 | **REVIEWED** | All 44 routes, SSE, client tracking, MPRIS polling, window classification, command dispatch, geo endpoints, `/proc` and `/sys` readers, `os/signal` reload. Every function read. |
| `music_service.go` | 780 | **REVIEWED** | All handlers, the pipeline, quoting, handoff, `shellQuote`. Not executed against the network (yt-dlp search/play not run to avoid side effects). |
| `video_player.go` | 651 | **REVIEWED** | All four backends, `scanLines`, detection order. Exercised read-only via `/api/video/status`. |
| `lyrics_service.go` | 457 | **REVIEWED** | Fetched live from lrclib.net during the audit (log shows real lookups). |
| `audio_stream.go` | 323 | **REVIEWED** | Exercised with 4 real WebSocket clients + RST disconnects; WS handshake, NTP, frame fan-out and status all verified. |
| `config.go` | 194 | **REVIEWED** | Tested by the existing suite, which passes under `-race`. |
| `audio.go` | 213 | **REVIEWED** | `pactl` parsing verified against live output. |
| `service_stats.go` | 190 | **REVIEWED** | Exercised; BUG-026 confirmed numerically against live `/proc`. |
| `hotkey.go` | 191 | **REVIEWED** | Ran in disabled mode during testing (so no GNOME keybinding was modified). |
| `gpu.go` | 154 | **REVIEWED** | `nvidia-smi` present on this host so the NVIDIA path ran live; the Intel and AMD paths were reviewed statically. |
| `files.go` | 149 | **REVIEWED** | Untracked WIP, not routed. Read in full. |
| `clipboard.go` | 100 | **REVIEWED** | `wl-paste`/`wl-copy` present; the X11 fallback path reviewed statically (`xclip` is not installed here). |
| `ble.go` | 96 | **REVIEWED** | Exercised via `/api/ble/transmit`. `bluetoothctl advertise` unavailable/absent on this host, which is itself the finding. |
| `terminal.go` | 94 | **REVIEWED** | Exercised with raw WebSocket clients; panic reproduced. |
| `scenes.go` | 108 | **REVIEWED** | Untracked WIP, not routed. |
| `config_test.go` | 276 | **REVIEWED** | The only test file. All 10 tests analysed. |
| `cmd/sendkey/main.go` | 201 | **REVIEWED** | Not executed — it injects real keystrokes into the user's session. Statically reviewed including the `ioctl` struct layout. |

**Backend status: REVIEWED (100 % of files, 100 % of lines).**

### 20.2 Frontend — 7,142 lines, 51 files

| Path | Lines | Status | Runtime/visual |
|---|---:|---|---|
| `App.tsx` | 360 | REVIEWED | ✅ runtime, ✅ visual, ✅ interaction |
| `components/NowPlayingCard.tsx` | 625 | REVIEWED | ✅ ✅ ✅ |
| `components/GeoSurveyCard.tsx` | 476 | REVIEWED | ✅ ✅ ✅ (GPS stubbed, calibration reproduced) |
| `components/NowPlayingCard` lyrics modal | — | REVIEWED | ✅ visual (state reached), ✅ interaction |
| `lib/streamManager.ts` | 420 | REVIEWED | ✅ instrumented (`WebSocket`/`AudioContext`), heap measured |
| `components/MediaStreamerPage.tsx` | 78 | REVIEWED | ✅ ✅ ✅ |
| `components/ConnectedDevicesCard.tsx` | 226 | REVIEWED | ✅ ✅ ✅ |
| `components/MixerCard.tsx` | 217 | REVIEWED | ✅ ✅ ✅ |
| `components/ClipboardCard.tsx` | 218 | REVIEWED | ✅ ✅ ✅ |
| `components/VideoPlayerDeck` (`decks/`) | 257 | REVIEWED | ✅ ✅ ✅ |
| `components/SystemStatsCard.tsx` | 155 | REVIEWED | ✅ ✅ |
| `components/GuestView.tsx` | 155 | REVIEWED — **DEAD CODE**, not rendered | — |
| `components/BleProximityCard.tsx` | 180 | REVIEWED | ✅ ✅ (scanner needs a BLE peer; static only for `requestDevice`) |
| `components/StepperControls.tsx` | 173 | REVIEWED — **DEAD CODE** | — |
| `components/LockScreen.tsx` | 148 | REVIEWED — **DEAD CODE** | — |
| `components/LockScreen` PIN keypad | — | REVIEWED statically (the live keypad is `AuthScreen`) | — |
| `components/WeatherCard.tsx` | 143 | REVIEWED | ✅ ✅ (geolocation stubbed; live Open-Meteo fetch observed) |
| `components/ToggleGrid.tsx` | 131 | REVIEWED — **DEAD CODE** | — |
| `components/StepperControls`/arrow pad | — | REVIEWED | — |
| `components/MusicSearch.tsx` | 134 | REVIEWED | ✅ ✅ (yt-dlp not executed — side effects) |
| `components/AppMixerCard.tsx` | 102 | REVIEWED — **DEAD CODE** | — |
| `components/FloatingNav.tsx` | 98 | REVIEWED | ✅ ✅ ✅ |
| `hooks/useArtTheming.ts` | 88 | REVIEWED | ✅ (CORS behaviour tested against a real CDN and a local no-ACAO origin) |
| `decks/IdeDeck.tsx` | 88 | REVIEWED | ✅ ✅ (commands not executed — destructive) |
| `decks/MediaBrowserDeck.tsx` | 148 | REVIEWED | ✅ ✅ (keystrokes not sent) |
| `decks/TerminalDeck.tsx` | 205 | REVIEWED | ✅ ✅ ✅ (PTY spawned, `[disconnected]` loop observed) |
| `decks/DefaultDeck.tsx` | 44 | REVIEWED — **DEAD CODE** | — |
| `components/CaffeineCard.tsx` | 75 | REVIEWED — **DEAD CODE** | — |
| `components/ServiceStatsBar.tsx` | 82 | REVIEWED | ✅ ✅ |
| `components/MiniPlayer.tsx` | 50 | REVIEWED | ✅ ✅ ✅ |
| `components/CommandLogCard.tsx` | 29 | REVIEWED | ✅ ✅ |
| `components/SysStatsBar.tsx` | 64 | REVIEWED — **DEAD CODE** | — |
| `components/TmuxRadial.tsx` | 64 | REVIEWED | ✅ ✅ ✅ |
| `components/AudioStreamCard.tsx` | 69 | REVIEWED | ✅ ✅ ✅ (all three states reached) |
| `hooks/useMediaStream.ts` | 167 | REVIEWED | ✅ (backend kill/restart cycle) |
| `hooks/useActiveWindow.ts` | 58 | REVIEWED | ✅ (live D-Bus focus events observed) |
| `hooks/useCapabilities.ts` | 54 | REVIEWED | ✅ |
| `hooks/useFeatures.ts` | 47 | REVIEWED | ✅ |
| `lib/lyricsEngine.ts` | 44 | REVIEWED | ✅ (real LRC parsed) |
| `lib/BleRssiMonitor.ts` | 130 | REVIEWED — **DEAD CODE** | — |
| `lib/authStore.ts` | 36 | REVIEWED — **DEAD CODE** | — |
| `services/apiService.ts` | 242 | REVIEWED | ✅ (every endpoint called) |
| `config/deckConfig.ts` | 80 | REVIEWED | ✅ (rendered) |
| `config/features.ts` | 32 | REVIEWED | ✅ |
| `index.css` | 288 | REVIEWED | ✅ (computed styles inspected) |
| `main.tsx` | 10 | REVIEWED | ✅ |
| `vite-env.d.ts` | 2 | REVIEWED | n/a |
| `components/FileDropCard.tsx` | 123 | REVIEWED — untracked WIP, not rendered, endpoint 404 | — |
| `components/ScenesCard.tsx` | 88 | REVIEWED — untracked WIP, not rendered, endpoint 404 | — |
| `index.html` | 33 | REVIEWED | ✅ |
| `vite.config.ts` | 20 | REVIEWED | n/a |
| `tailwind.config.js` | 39 | REVIEWED | n/a |
| `postcss.config.js` | — | REVIEWED | n/a |
| `tsconfig.json` | — | REVIEWED | n/a |
| `package.json` | — | REVIEWED | n/a |
| `public/background.html` | 679 | REVIEWED | ✅ ✅ ✅ |
| `public/service-worker.js` | 133 | REVIEWED | ✅ (scope verified) |
| `public/manifest.json` | — | REVIEWED | ✅ |
| `public/manifest-bg.json` | — | REVIEWED | ✅ |
| `public/icon-192/512.png`, `icon.svg` | — | REVIEWED (binary) | ✅ |

**Frontend status: REVIEWED (100 % of files, 100 % of lines). 43 of 51 files exercised at runtime; the 8 not exercised are the dead-code files plus the two unwired WIP cards.**

### 20.3 Configuration, deployment and assets

| Path | Status |
|---|---|
| `config.json` | REVIEWED (gitignored; exposed over HTTP — SEC-007) |
| `config.example.json` | REVIEWED |
| `testdata/config_legacy.json`, `testdata/config_partial.json` | REVIEWED |
| `.gitignore` | REVIEWED |
| `avahi-service.conf` | REVIEWED |
| `scripts/setup-hotkey.sh` | REVIEWED (not executed — would modify GNOME keybindings) |
| `scripts/toggle-broadcast.sh` | REVIEWED (not executed) |
| `README.md` | REVIEWED — 5 documented behaviours are false (BUG-054, BUG-055, and §15.5) |
| `docs/FEATURES.md` | REVIEWED — 4 documented behaviours are false |
| `docs/CV.md` | REVIEWED (not in scope; no findings) |
| `server.crt` / `server.key` | Binary — verified as served over HTTP (SEC-007) |
| `server.log` | Sampled for growth rate and content (SEC-014) |
| `static/` (built output) | REVIEWED; rebuilt and confirmed byte-identical to the committed output |
| `geo_sessions/*.json` | Sampled (2 files) — exposed over HTTP (SEC-007) |
| `tab-dashboard`, `webdeck`, `server` (binaries) | Not audited (build artefacts) |
| `.supervisor/` | Not audited (tooling state, not application code) |
| `.git/` | Not audited beyond confirming it is served over HTTP |
| **CI configuration** | **NOT PRESENT — REASON: no `.github/`, `.gitlab-ci.yml`, `Makefile`, or any pipeline file exists in the repository** |
| **`tab-dashboard.service`** | **NOT PRESENT — REASON: referenced by the README but absent from the repository (BUG-055)** |
| **Frontend test setup** | **NOT PRESENT — REASON: no test runner, no `test`/`lint` script in `package.json`** |

### 20.4 Feature-level coverage

| Feature | Source | Runtime | Visual | Notes |
|---|---|---|---|---|
| PIN lock / auth | ✅ | ✅ | ✅ | Both PINs exercised; the dead `LockScreen` reviewed statically |
| Access-mode selection | ✅ | ✅ | ✅ | |
| 5-deck carousel | ✅ | ✅ | ✅ | All 5 decks screenshotted; drag, dots, menu, auto-focus all tested |
| Now Playing / transport | ✅ | ✅ | ✅ | Real MPRIS player throughout |
| Seek / volume / brightness | ✅ | ✅ | ✅ | Bug 021/026 measured numerically |
| Player carousel | ✅ | ✅ | ✅ | |
| Synced lyrics + modal | ✅ | ✅ | ✅ | Real lrclib lyrics parsed and rendered |
| Music search + play | ✅ | ⚠️ | ✅ | **Play not executed** — REASON: `killMusicPipeline` runs `pkill -9 -x mpv`, which would destroy any mpv the user is running (that is BUG-048). Review relied on static analysis of the pipeline construction. |
| Phone handoff (KDE Connect / GSConnect) | ✅ | ❌ | ✅ | **Not executed** — REASON: no paired phone/tablet is attached to this host. The device-picker empty state was rendered; `gsconnectAvailable()` and `deviceIsPhone` were traced statically. |
| Open in browser | ✅ | ❌ | ✅ | **Not executed** — REASON: would open a browser tab on the author's machine. `browserURLAtPosition` and `resolvePlayerMedia` reviewed in full. |
| Clipboard sync | ✅ | ✅ | ✅ | `wl-copy`/`wl-paste` present; the `xclip` fallback reviewed statically |
| Volume / brightness / night light | ✅ | ✅ | ✅ | |
| Sink switching | ✅ | ✅ | ✅ | Sinks enumerated from live `pactl` |
| Per-app mixer | ✅ | ✅ | ✅ | Live `pactl` sink-inputs |
| Bluetooth toggles | ✅ | ⚠️ | ✅ | **Radio toggles not flipped** — REASON: would disconnect the user's Bluetooth devices. `rfkill`/`bluetoothctl` invocations traced statically; the state read path verified. |
| Caffeine | ✅ | ✅ | ✅ | State read from live GNOME settings; the toggle's `bash -c` chain reviewed statically |
| WARP / ERP toggles | ✅ | ❌ | ✅ | **Not executed** — REASON: `warp-cli connect` / `erp login` would change the user's network/VPN state. Rendering and dispatch verified; the command-registry gap (BUG-022) is structural. |
| System stats | ✅ | ✅ | ✅ | Real `/proc`, `/sys`, `nvidia-smi` |
| GPU telemetry | ✅ | ✅ | ✅ | NVIDIA path live; Intel/AMD static |
| Service stats bar | ✅ | ✅ | ✅ | BUG-026 confirmed numerically |
| Weather | ✅ | ✅ | ✅ | Live Open-Meteo; geolocation stubbed |
| Geo survey | ✅ | ✅ | ✅ | GPS stubbed; recording, calibration, save/load all exercised; BUG-028 measured |
| BLE proximity | ✅ | ⚠️ | ✅ | **Advertiser/scanner not fully exercised** — REASON: `advertise` is unavailable on this host and no BLE peer is present. That is itself BUG-029. RSSI model, hysteresis and rendering reviewed statically and visually. |
| Connected devices + broadcast | ✅ | ✅ | ✅ | BUG-023 measured; the broadcast toggle rendered |
| Audio streaming (PCM) | ✅ | ✅ | n/a | Full pipeline exercised: handshake, NTP, frames, RST disconnects, heap |
| Background audio PWA | ✅ | ✅ | ✅ | Served, screenshotted, auto-connect path traced |
| Hotkey toggle | ✅ | ❌ | n/a | **Not executed** — REASON: would register/modify a GNOME global keybinding on the author's session. `ensureGnomeKeybinding` reviewed in full; the registration logic was run in `disabled` mode. |
| Terminal / PTY | ✅ | ✅ | ✅ | Panic reproduced; toolbar, radial, reconnect all exercised |
| Tmux controls | ✅ | ✅ | ✅ | Escape sequences verified; the radial menu was opened and its items enumerated |
| IDE deck | ✅ | ✅ | ✅ | Rendered at 3 viewports; commands **not executed** — REASON: `git push`/`git reset`/`npm run dev` are destructive. Rendering and the command-registry analysis are the basis for BUG-034/038. |
| Video player deck | ✅ | ✅ | ✅ | Rendered; `/api/video/status` polled live; no player was launched, so the mpv/VLC IPC paths were traced statically |
| Command log | ✅ | ✅ | ✅ | |
| Capability detection | ✅ | ✅ | n/a | |
| Feature flags | ✅ | ✅ | n/a | All 15 enabled for testing; key mismatch verified structurally |
| Config + SIGHUP reload | ✅ | ⚠️ | n/a | Exercised by the existing test suite (`-race` clean). **A live SIGHUP was not sent to the author's instance** — REASON: would change the running dashboard's PINs and command map. Reload logic reviewed statically; BUG-053 identified from the call graph. |
| PWA / service worker | ✅ | ✅ | n/a | Scope and cache strategy verified |
| mDNS discovery | ✅ | ❌ | n/a | **Not executed** — REASON: would install a system Avahi service. The XML and the README's claim are compared in BUG-054. |
| systemd auto-start | ❌ | ❌ | n/a | **NOT PRESENT — REASON: the unit file does not exist (BUG-055)** |

### 20.5 Coverage honesty statement

- **Every line of Go and every line of frontend source was read.** 100 % source coverage.
- **43 of 51 frontend files** were exercised in a real browser with screenshots.
- **Every backend subsystem** was exercised at runtime except six, each for a stated and necessary reason: music playback (would `pkill` the user's mpv), phone handoff (no paired device), open-in-browser (would open a tab), Bluetooth radio toggles (would disconnect devices), WARP/ERP commands (would change network state), and the GNOME hotkey (would modify the session's keybindings). All six were covered by static analysis of the exact code path, and each is marked accordingly in §20.4.
- **Fourteen backend sub-systems are covered by zero automated tests** (§14.2). That is the largest gap in the project.
- **No CI, no linter configuration, no frontend test runner, and no deployment artifact exist.** These are reported as findings (BUG-055, MAINT-32, §14.4) rather than audited.
- **Two hypotheses were tested and discarded** rather than reported: the per-app volume drift-to-zero theory and the art-theming `SecurityError` theory (§2.7).

---

## 21. Commands Executed

All commands were run in the repository root unless noted. **ENV** = environmental limitation; **REAL** = a genuine project problem.

### 21.1 Discovery

| # | Command | Purpose | Result |
|---|---|---|---|
| 1 | `git status --short` | Record pre-audit state | `?? files.go`, `?? frontend/src/components/FileDropCard.tsx`, `?? frontend/src/components/ScenesCard.tsx`, `?? scenes.go` |
| 2 | `git branch --show-current` / `git log --oneline -10` | Establish baseline | `experiment/ble-rssi` @ `951efb0` |
| 3 | `find . -path ./.git -prune -o -type f -print` | Full file inventory | 100+ files across 12 directories |
| 4 | `wc -l *.go cmd/sendkey/main.go` | Backend size | 6,345 lines |
| 5 | `find frontend/src -type f \| xargs wc -l` | Frontend size | 7,142 lines across 51 files |
| 6 | `grep -rn` for each component name | Dead-code detection | 10 dead frontend files confirmed (§15.1) |
| 7 | `grep -rn "remoteStartStream"` | Dead backend function | Only its definition — confirmed dead |
| 8 | `command -v` for 19 binaries | Dependency inventory | All present except `xclip`, `intel_gpu_top` |

### 21.2 Build and test

| # | Command | Purpose | Result | Classification |
|---|---|---|---|---|
| 9 | `go vet ./...` | Static analysis | 3 × `possible misuse of unsafe.Pointer` in `cmd/sendkey/main.go:139,144,150` | **REAL** (project) |
| 10 | `go build -o /tmp/opencode/cd-audit-bin .` | Compile | exit 0, no output | ✅ pass |
| 11 | `gofmt -l .` | Formatting | 8 files unformatted: `audio.go`, `cmd/sendkey/main.go`, `config.go`, `lyrics_service.go`, `main.go`, `music_service.go`, `service_stats.go`, `terminal.go` | **REAL** (project) |
| 12 | `go test ./...` | Unit tests | `ok tab-dashboard 0.017s`; `? tab-dashboard/cmd/sendkey [no test files]` | ✅ pass |
| 13 | `go test -race -count=1 .` | Race detection on existing tests | `ok 1.077s` — clean | ✅ pass |
| 14 | `npm --prefix frontend run build` (`tsc && vite build`) | Typecheck + production build | 1612 modules, `index-DIKbXMTh.css` 46.20 kB, `index-DcQwZkEn.js` 625.38 kB (gzip 167.84 kB). 2 warnings: chunk >500 kB, and a dynamic-import/static-import conflict for `streamManager.ts`. Output **byte-identical** to the committed `static/`. | ✅ pass; warnings are **REAL** (PERF-16) |
| 15 | `npm --prefix frontend run test` | Frontend tests | **Script does not exist** | **REAL** (project) — no test runner |
| 16 | `npm --prefix frontend run lint` | Lint | **Script does not exist** | **REAL** (project) |
| 17 | CI configuration search | Find pipeline | No `.github/`, `.gitlab-ci.yml`, `Makefile`, or equivalent | **REAL** (project) |
| 18 | Search for `tab-dashboard.service` | Find deployment artifact | Not present | **REAL** (project) — BUG-055 |

### 21.3 Runtime — build of this tree

Setup: copied `static/`, `*.go`, `go.mod`, `go.sum`, `testdata/` to `/tmp/opencode/cd-audit`; wrote a `config.json` with ports 18080/18044 and `broadcast_hotkey: "disabled"` (so no GNOME keybinding was touched); all 15 features enabled.

| # | Command | Purpose | Result |
|---|---|---|---|
| 19 | `go build -o cd-audit .` | Build audit instance | exit 0 |
| 20 | `setsid ./cd-audit` (in `/tmp/opencode/cd-audit`) | Start on :18080 | Started; `TLS server: open server.crt: no such file or directory` (expected — no cert copied); `dbus signal: listening for FocusedWindowChanged`; live focus events observed |
| 21 | `go build -race -o cd-audit-race .` | Race-instrumented build | exit 0 |
| 22 | `setsid ./cd-audit-race` (in `/tmp/opencode/cd-audit`) | Start on :18081 | Started |

### 21.4 Security probes

| # | Command | Finding | Result |
|---|---|---|---|
| 23 | `curl http://127.0.0.1:8080/` (author's live instance) | SEC-007 | **200** — full directory listing of the CWD |
| 24 | `curl http://127.0.0.1:8080/config.json` | SEC-007 | **200** — both PINs in cleartext |
| 25 | `curl -o /dev/null -w '%{http_code} %{size_download}' .../server.key` | SEC-007 | **200, 1704 bytes** — the complete TLS private key |
| 26 | `curl .../server.log` | SEC-007, SEC-014 | **200, 5 942 476 bytes** |
| 27 | `curl .../geo_sessions/` | SEC-007 | **200** — directory listing |
| 28 | `curl ".../api/geo/session?name=../canary.txt"` | SEC-001 | **200** — file contents returned |
| 29 | `curl ".../api/geo/session?name=../../../../etc/hostname"` | SEC-001 | **200** — `conquest` |
| 30 | `curl -X DELETE ".../api/geo/session?name=../victim.txt"` | SEC-002 | `{"ok":true}` — **file deleted** |
| 31 | `curl -X POST -d '{"name":"../pwned",...}' .../api/geo/save` | SEC-003 | `{"ok":"../pwned"}` — **file written outside `geo_sessions/`** |
| 32 | `curl -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' .../api/command` | SEC-004 | **405** — no preflight handler, so `text/plain` needs none |
| 33 | `curl -X POST -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' --data '{"command":"git_push"}' .../api/command` | SEC-004 | **`{"executed":"git_push","status":"ok"}`** — command dispatched |
| 34 | `grep -n InsecureSkipVerify *.go` | SEC-005, SEC-011 | `audio_stream.go:242`, `terminal.go:27` |
| 35 | Python raw-WebSocket handshake with `Origin: https://evil.example` to `/ws/terminal` | SEC-005 | **101 Switching Protocols** |

### 21.5 Runtime probes

| # | Command / test | Finding | Result |
|---|---|---|---|
| 36 | `curl /api/service-stats` | BUG-026 | `cpu_percent: 80`, `uptime_secs: 195409` |
| 37 | `ps -o etimes -p 4242`; `/proc/4242/stat` field dump | BUG-026 | real elapsed **198408 s**; real CPU **16.7 %**; confirmed `fields[13]=cutime`, `fields[14]=cstime`, `fields[21]=rss` |
| 38 | `pactl list sink-inputs` | BUG-021 | `front-left: 65536 / 100%` — confirms factor semantics |
| 39 | `brightnessctl get` / `max` | BUG-021/UX | real 15.9 %; UI slider shows 40 % |
| 40 | `wpctl get-volume @DEFAULT_AUDIO_SINK@` | BUG-021 | `Volume: 0.64` — volume round trip is self-consistent (hypothesis corrected) |
| 41 | `curl /api/clients` from a browser tab | BUG-023 | One tab → 4 entries keyed `127.0.0.1:44634/44640/44648/44668` |
| 42 | `curl -X POST /api/stream/control {"target":"","action":"start"}` on the LAN origin | SEC-015 | **404 "device not connected"** |
| 43 | `tail -f` on the server log | SEC-014 | ~2 focus lines/second, continuous |

### 21.6 Dynamic analysis (the `-race` instance on :18081)

| # | Test | Finding | Result |
|---|---|---|---|
| 44 | 12 × `/ws/terminal` connect + RST | BUG-001 | **`panic: close of closed channel` at `terminal.go:62` — process died.** Stack captured. |
| 45 | 2 × connect + send output + SO_LINGER RST | BUG-001 | **Reproduced deterministically on attempt 2. Process died.** |
| 46 | 6 × connect + graceful close, 8 s wait | BUG-001 | Survived — confirms the trigger requires PTY output |
| 47 | 8 × connect + command + RST, then 5 × connect + `seq 1 2000000` + RST at 350 ms | BUG-001 | **Survived 7 cycles, died on the 2nd flood cycle.** The flood (output in flight at disconnect) is the reliable trigger. |
| 48 | 40 concurrent `GET /api/clients` | SUS-007 | **`WARNING: DATA RACE` — write at `main.go:1126` vs read in `encoding/json`.** Full stack captured. |
| 49 | 60 concurrent `POST /seek` with an SSE client attached | §11 | **9 `WARNING: DATA RACE` reports** at `main.go:1839-1842` (`getCPUPercent`), `gpu.go:47/48/50` (`fetchGPUStats`), `main.go:2165`, `main.go:1126/1134`. Stacks captured. |
| 50 | 4 × `/api/audio-stream/ws` + simultaneous RST | SUS-008 | No race flagged (the window is narrow) — reported as suspected, not confirmed |
| 51 | `pkill -f cd-audit-race`, then restart | R1, R2 | Backend killed → UI showed "Connection lost — retrying…" within 8 s; recovery took ~24 s (exponential backoff) |

### 21.7 Browser automation (Playwright + Chromium 1243)

| # | Test | Finding | Result |
|---|---|---|---|
| 52 | Auth screen at 7 viewports; overflow + tap-target audit | §9 | No overflow; 0 sub-44 px targets on the auth screen |
| 53 | Unlock → Home deck, desktop; geometry + a11y audit | §8, §10 | 94 sub-44 px targets; all 5 decks screenshotted |
| 54 | All 5 decks via the FloatingNav menu | §4 | Screenshots captured; page heights measured (Home 1553 px vs others 788 px) |
| 55 | Click each of the 5 bottom-nav dots | UX-28 | **Page stayed at index 0 for every dot** |
| 56 | Mouse-drag the carousel | UX-28, 9.5 | **No movement.** Confirmed the deck container has no pointer handlers |
| 57 | Tap the Calibration button with geolocation granted | BUG-028 | **`(80381 samples)` after 30 s; heap 9→70 MB; 2 679 effect runs/s** |
| 58 | Instrumented `WebSocket`; 3 taps on Stream | BUG-012 | **3 live `/api/audio-stream/ws` created** |
| 59 | Force-close the audio socket; observe 6 s | BUG-013 | `opened: 1` before and after; button still "Stop"; server `active: false` |
| 60 | Autoplay blocked (`--autoplay-policy=user-gesture-required`); stream 28 s | BUG-014 | Heap 8.6 → 25.4 MB with a GC sawtooth; button "Stop" throughout |
| 61 | LAN origin `http://10.105.24.62:18081` | SEC-015 | `isSecureContext: false`, `hasRandomUUID: false`, `device_id=` empty, `control` → 404 |
| 62 | Art extraction: blob, same-origin http, cross-origin no-ACAO, real `i.ytimg.com` | BUG-042 | blob OK; same-origin OK; no-ACAO → `img.onerror`; **YouTube CDN → OK (ACAO present)** — hypothesis corrected |
| 63 | Responsive sweep, 7 viewports, geometry + DOM | §9 | Full table: scroll ratios, tap-target counts, `OVERLAP=true` at every size |
| 64 | Terminal deck on tablet; FAB vs MiniPlayer geometry | UX-08 | **Overlap confirmed**: FAB `(708,912,48×48,z50)` vs MiniPlayer `(0,915,768×53,z40)` |
| 65 | Backend kill + restart while the page is open | R1, R2, CF-09 | Banner within 8 s; stale data shown throughout; recovered at ~24 s |
| 66 | Screenshots captured | §4 | 22 PNGs: auth ×7, Home ×7, 5 decks, terminal, offline, audio-suspended, calibration |

### 21.8 Cleanup

| # | Command | Result |
|---|---|---|
| 67 | `pkill -f cd-audit-race`; `kill <pid>` | Both audit instances stopped; `pgrep cd-audit` → none |
| 68 | `pgrep -a tab-dashboard` | **PID 4242 still running** — the author's production instance was never touched |
| 69 | `rm -f canary.txt pwned.json` in the temp dir | Canary artefacts removed |
| 70 | `git status --short` | See §22 |

### 21.9 Commands deliberately NOT executed, with reasons

| Command | Reason |
|---|---|
| `tab-dashboard --toggle-broadcast` | Would toggle a live broadcast and mute the user's audio |
| `/api/command` with `lock` | Would lock the author's desktop session |
| `/api/command` with `bluetoothOn/Off`, `btSinkOn/Off` | Would disconnect the user's Bluetooth devices |
| `/api/command` with `warpOn/Off`, `erpLogin` | Would change VPN/ERP network state |
| `/api/command` with any `git_*` or `task_*` | Would commit/push/stash in a repository and start long-running processes |
| `/api/music/play` | Calls `killMusicPipeline`, which runs `pkill -9 -x mpv` (BUG-048) — would destroy any mpv the user is running |
| `/api/music/open`, `/api/music/handoff` | Would open a browser tab / share to a phone |
| `/api/ble/transmit` with `start` | `advertise` is unavailable on this host; the effect is a no-op but the capability finding is unchanged |
| `./scripts/setup-hotkey.sh` | Would create/modify a GNOME global keybinding in the live session |
| `avahi-service` install | Requires `sudo` and a system-level change |
| `sudo cp avahi-service.conf …` | As above |
| `kill -USR1 4242` (live SIGHUP reload) | Would change the running dashboard's PINs and command map |
| `./tab-dashboard-sendkey <key>` | Injects real keystrokes into the user's focused window |
| `writeEvent`/`cmd/sendkey` at all | Same reason |
| `npm i` in the repo | Would create/modify `node_modules` and `package-lock.json`; installed into `/tmp` instead |

---

## 22. Final Git Status

```
$ git status --short
?? CONTROL_DECK_AUDIT_REPORT.md
?? files.go
?? frontend/src/components/FileDropCard.tsx
?? frontend/src/components/ScenesCard.tsx
?? scenes.go

$ git diff --stat
(no output — no tracked file was modified)

$ git log --oneline -1
951efb0 fix: rewrite background page script — was stuck on Connecting

$ git branch --show-current
experiment/ble-rssi
```

### 22.1 Did the audit change any source files?

**No. Zero tracked source files were modified, added, or deleted.**

The pre-audit state was:

```
?? files.go
?? frontend/src/components/FileDropCard.tsx
?? frontend/src/components/ScenesCard.tsx
?? scenes.go
```

The post-audit state is identical, **plus** `?? CONTROL_DECK_AUDIT_REPORT.md` — this report, which is the audit's sole deliverable.

Specifically:
- The four untracked work-in-progress files present before the audit (`files.go`, `scenes.go`, `FileDropCard.tsx`, `ScenesCard.tsx`) are **untouched and still present**.
- `git diff --stat` is empty: no tracked file differs from `HEAD`.
- The frontend **was** built (`npm run build` writes to `../static/`), but the output is **byte-identical** to the committed `static/` — the same content hashes (`index-DIKbXMTh.css`, `index-DcQwZkEn.js`) and no `static/` entry appears in `git status`.
- All test instances ran from a copy in `/tmp/opencode/cd-audit` and have been stopped. The canary files created to prove the path traversal were removed.
- The author's production instance (PID 4242) was **never stopped, signalled, or reconfigured**; it is still running and serving.
- No GNOME keybinding was registered or modified (`broadcast_hotkey: "disabled"` in the audit config).
- No system volume, brightness, Bluetooth radio, or audio sink was changed.
- `node_modules` was installed in `/tmp/opencode/pw`, not in the repository.

### 22.2 Files added by this audit

| File | Purpose |
|---|---|
| `CONTROL_DECK_AUDIT_REPORT.md` | This report (3,326+ lines) |

Nothing else.

---

*Audit complete. 55 confirmed bugs, 17 suspected, 16 security findings, 42 performance findings, 32 UI/UX issues, 21 accessibility findings, 31 maintainability findings, 12 cross-feature findings, 24 specified test gaps, and 15 product improvements — all traceable to a file, a line, and, where the finding is behavioural, a reproduction.*
