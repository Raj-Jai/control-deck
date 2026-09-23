# Control Deck

A web-based local network dashboard for a Linux workstation, served to tablets and phones over LAN. Media control, system telemetry, clipboard sync, multi-device synchronized audio streaming, and a swipeable touch UI.

## Features

- **Multi-Deck Touch UI** — 5 swipeable pages (Home / Media / Video / Code / Terminal) with `scroll-snap` carousel, dot indicators, fixed bottom nav bar, and a floating navigation bubble for quick deck switching
- **Now Playing** — MPRIS media controls fixed across all decks, showing the active player with play/pause, next/prev, seek, volume, album art, and synced lyrics. Swipeable carousel when multiple players are active
- **Auto-Focus Toggle** — disable automatic page switching when changing focused windows, letting you stay on your current deck
- **Synchronized Audio Stream** — real-time PCM audio from the host's audio output (`@DEFAULT_MONITOR@`) broadcast to every connected device via WebSocket, with NTP-based clock sync and Web Audio API scheduling for sample-accurate multi-device alignment
- **Per-App Audio Mixer** — view and control volume/mute of individual PulseAudio sink-inputs
- **Volume & Brightness** — sliders, night-light toggle, audio output sink switching
- **System Stats** — CPU, RAM, battery, temperature, network info, ping status
- **Clipboard Sync** — bi-directional pull/push between browser and host (wl-paste/wl-copy + xclip)
- **Speed Control** — 8-step playback speed toggle (0.25x–2.0x) for YouTube and video players via keystroke injection
- **Window Detection** — GNOME Shell D-Bus extension + godbus signal listener for instant focus events; app routing matrix maps `wm_class` to the correct deck page (YouTube enrichment via window title)
- **Custom Commands** — configurable CLI commands exposed as toggle buttons (ERP login, WARP, etc.)
- **Sendkey Tool** — keystroke injection via `/dev/uinput` for shift combos, arrows, F-keys, ctrl combos; optionally raises MPRIS windows via D-Bus
- **Toggles** — Bluetooth, BT Speaker, WARP, Lock Desktop, Caffeine, ERP Login, Night Light, Audio Stream
- **Global Hotkey** — `<Control><Alt>b` (configurable via `broadcast_hotkey` in `config.json`) mutes laptop and streams to all devices without opening the dashboard; also `scripts/toggle-broadcast.sh` and `tab-dashboard --toggle-broadcast`
- **Background Audio Mode** — ultra-lightweight ` /static/background.html` PWA for phones: auto-connects on broadcast, Media Session notification keeps it alive when screen locked, polling fallback if SSE missed, ~624 kB JS, no React overhead, `Add to Home screen` for app-like background use with minimal battery
- **Command Log** — every action logged with timestamp, displayed in real-time via SSE
- **Capability Detection** — frontend auto-hides cards whose backend dependencies are missing
- **Dashboard Lock** — optional PIN lock with 6-hour session

## Architecture

```
┌───────────────────┐     HTTP/SSE/WS      ┌──────────────────┐
│   Go Server       │ ◄──────────────────► │  React PWA       │
│  (localhost:8080) │                      │  (tablet/phone)  │
│                   │                      │                  │
│  ffmpeg ──────PCM────WebSocket────────►  │  Web Audio API   │
│  PulseAudio       │   NTP sync +         │  AudioContext     │
│  @DEFAULT_MONITOR │   timestamped        │  + buffer         │
│                   │   frames             │  scheduling       │
│  MPRIS ────SSE───────all players──────►  │  PlayerCarousel   │
│  (playerctl)      │                      │                  │
│                   │                      │  ┌────────────┐  │
│  Window Focus ──SSE──active app────────►  │  │ 5-Deck UI  │  │
│  (D-Bus signal)   │                      │  └────────────┘  │
│                   │                      │                  │
│  pactl ────SSE───────app streams───────►  │  Mixer sliders  │
└───────────────────┘                      └──────────────────┘
```

### Audio Streaming Pipeline

```
PulseAudio @DEFAULT_MONITOR
       │
       ▼
FFmpeg → PCM s16le 48000Hz stereo → pipe
       │
       ▼
readLoop() → io.ReadFull(8192B) → sample-accurate PTS
       │
       ▼
Binary frame: [0x02 | PTS(uint64 BE) | PCM data]
       │
       ▼
WebSocket fan-out to N clients
       │
       ▼
SyncedAudioPlayer (Web Audio API):
  1. NTP clock sync (10-ping, outlier rejection)
  2. Accumulate 3 frames (~128ms) per batch
  3. PI drift compensator adjusts playbackRate ±0.3%
  4. 2ms GainNode crossfade at buffer boundaries
  5. AudioBufferSourceNode.start(ctxTime)
```

- **Backend**: Go — MPRIS polling, command execution, clipboard, audio capture, SSE broadcast, WebSocket audio streaming
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS — single-page PWA
- **Audio**: FFmpeg captures PulseAudio monitor → raw PCM → WebSocket → Web Audio API `AudioContext` with NTP-synchronized sample-accurate scheduling
- **State**: Media state, app focus, system stats pushed via SSE — no polling
- **Window Detection**: GNOME Shell D-Bus extension + Go godbus signal listener for sub-100ms focus change events

## Setup

### Prerequisites

**Languages & build tools:**
- Go 1.21+
- Node.js 18+

**Linux packages (install via your distro's package manager):**

| Package / Tool | Purpose |
|----------------|---------|
| `playerctl` | Query MPRIS players, play/pause/next/prev/seek |
| `wireplumber` (or `pipewire-media-session`) | `wpctl` — get/set/mute system volume |
| `pulseaudio-utils` | `pactl` — list sinks, set default, list sink-inputs |
| `brightnessctl` | Get/set display backlight |
| `ffmpeg` | PulseAudio monitor capture → PCM stream |
| `wl-clipboard` **or** `xclip` | Bi-directional clipboard (Wayland: `wl-copy`/`wl-paste`, X11: `xclip`) |
| `iw` / `wireless-tools` | `iwgetid` — current Wi-Fi SSID |
| `bluez` | `bluetoothctl` — connect/discover; `rfkill` — toggle radio |
| `networkmanager` | `hostname -I` — local IP |
| `iputils` | `ping` — internet connectivity indicator |
| `systemd` | `loginctl lock-session` |
| `glib2` / `glib2-tools` | `gsettings` — night light and Caffeine extension (GNOME) |

**GNOME Shell extension (required for instant window detection):**

Install from [window-focus-dbus](https://github.com/Raj-Jai/window-focus-dbus):
```sh
git clone https://github.com/Raj-Jai/window-focus-dbus.git
mkdir -p ~/.local/share/gnome-shell/extensions
cp -r window-focus-dbus/window-focus-dbus@jairaj.dev ~/.local/share/gnome-shell/extensions/
gnome-extensions enable window-focus-dbus@jairaj.dev
```

Requires a GNOME Shell restart (Alt+F2, `r`) or logout/login.

### Build

```sh
git clone git@github.com:Raj-Jai/control-deck.git
cd control-deck
go build -o tab-dashboard .
cd frontend && npm install && npm run build && cd ..
```

### Run

```sh
./tab-dashboard
```

Open `http://localhost:8080/` in a browser. For PWA / HTTPS support, see below.

### TLS (for PWA on HTTPS)

```sh
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt \
  -days 3650 -nodes -subj "/CN=$(hostname)"
# HTTPS served on :8443; HTTP :8080 stays active
```

### Auto-start (systemd user service)

```sh
cp tab-dashboard.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tab-dashboard
loginctl enable-linger
```

### Network Discovery (mDNS/Avahi)

```sh
sudo cp avahi-service.conf /etc/avahi/services/tab-dashboard.service
```

The dashboard is then discoverable as `control-deck.local`.

### Background Audio on Phone (no need to keep Chrome open)

The full dashboard is heavy; for just listening, use the lightweight background page:

1. On your phone, open `http://<laptop-ip>:8080/static/background.html` (or `https://<laptop-ip>:8443/static/background.html` for PWA)
2. Tap **Add to Home screen** (Chrome → ⋮ → Add to Home screen). It installs as a standalone app (`Background Audio` shortcut from `manifest.json`).
3. Open the installed app once and tap **Connect** (or leave **Auto-connect** checked). Grant audio permission if prompted. The page shows “Idle — waiting for broadcast”.
4. On your laptop, press `<Control><Alt>b` (or `curl -X POST :8080/api/stream/broadcast -d '{"action":"toggle"}'`). The phone will auto-connect within 2 s (SSE + polling fallback) and start playing with a media notification. You can now lock the screen or switch apps — audio keeps playing via Media Session.
5. If you see “Tap to enable audio”, tap anywhere once — browsers block autoplay until a gesture. After that one tap, all future hotkey toggles work without extra taps (AudioContext is reused).
6. **Low power**: When idle (no broadcast), the page polls every 8 s and keeps the EventSource open but otherwise sleeps; when hidden it backs off to 15 s. No React, no polling of media state — ~5 MB RAM, negligible CPU. Enable **Keep screen awake** only if you want to prevent sleep.

Troubleshooting: If the first hotkey shows glow but no sound, ensure the background app was opened at least once and you tapped the page after install (autoplay unlock). Subsequent hotkeys will then be instant.

## Configuration

All user-specific settings in `config.json`:

| Key | Description |
|-----|-------------|
| `pin` | Dashboard lock-screen PIN |
| `bt_mac` | Bluetooth MAC address for headphone connect |
| `ping_target` | Host to ping for internet connectivity check |
| `http_port` / `https_port` | Listen ports |
| `caffeine_schema_dir` | Override GSettings schema dir for Caffeine (auto-derived from `$HOME` if empty) |
| `broadcast_hotkey` | Global hotkey to toggle mute+stream (default `<Control><Alt>b`, `"disabled"` to turn off auto-registration) |
| `custom_commands` | Extra CLI commands exposed as toggle/deck actions |

Override without modifying `config.json`:
```sh
CONFIG_PATH=config.local.json ./tab-dashboard
```

## Development

```sh
cd frontend && npm run dev   # Vite dev server with HMR (port 5173)
```

Frontend built assets go to `../static/` which the Go server serves at runtime.

## License

MIT
