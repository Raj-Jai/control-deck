# Control Deck

A web‑based dashboard for a local Linux workstation, accessed from tablets and phones over the local network. Media controls, system stats, clipboard sync, audio streaming, and more.

## Features

- **Now Playing** — MPRIS media controls for all active players (swipe between them): play/pause, next/previous, timeline seek, album art
- **Per‑App Audio Mixer** — view and control volume/mute of individual app audio streams (PulseAudio sink-inputs)
- **Volume & Brightness** — sliders with night‑light toggle and audio output sink switching
- **System Stats** — CPU, RAM, battery, temperature, network info with ping status
- **Clipboard Sync** — bi‑directional pull/push between browser and host (wl‑paste/wl‑copy + xclip)
- **Audio Stream** — real‑time MP3 stream from the host's audio output to the browser
- **BT Speaker** — make the host discoverable as a Bluetooth speaker (phone → laptop streaming)
- **Caffeine** — toggle GNOME Caffeine extension (30m, 1h, or infinite)
- **Lock Screen** — PIN‑protected dashboard lock with 6‑hour session
- **Toggles** — Bluetooth, BT Speaker, WARP, Lock Desktop, ERP Login, and any custom commands from config
- **Command Log** — Every action (play/pause, skip, seek, volume, brightness, ad-skip) is logged with a timestamp and displayed in real-time via SSE in a Command Log card on the dashboard, newest first
- **Capability Detection** — frontend auto-hides cards whose backend dependencies are missing

## Architecture

```
┌──────────────┐    HTTP/SSE     ┌──────────────┐
│   Go Server  │ ◄─────────────► │  React PWA   │
│  (port 8080) │                 │  (tablet)    │
│              │                 │              │
│  ffmpeg ─────┼──MP3 chunked HTTP──►  <audio>  │
│              │                 │              │
│  playerctl ──┼──SSE: all players──►  Carousel │
│              │                 │              │
│  pactl ──────┼──SSE: app streams►  Mixer     │
└──────────────┘                 └──────────────┘
```

- **Backend**: Go (`main.go`) — MPRIS polling, command execution, clipboard, audio capture, SSE broadcast
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS — single‑page PWA
- **Audio**: FFmpeg captures PulseAudio monitor → MP3 → chunked HTTP → `<audio>` element
- **State**: All dashboard state (media, sinks, app streams, system stats) pushed via SSE — no polling

## Setup

### Prerequisites

**Languages & build tools:**
- Go 1.21+
- Node.js 18+

**Linux packages (install via your distro's package manager):**

| Package / Tool | Required by | Purpose |
|----------------|-------------|---------|
| `playerctl` | Media controls | Query MPRIS players, play/pause/next/prev/seek |
| `wireplumber` (or `pipewire-media-session`) | Volume control | `wpctl` — get/set/mute system volume |
| `pulseaudio-utils` | Audio sink switching + app mixer | `pactl` — list sinks, set default, list sink-inputs |
| `brightnessctl` | Brightness control | Get/set display backlight |
| `ffmpeg` | Audio streaming | Capture PulseAudio monitor → MP3 stream |
| `wl-clipboard` **or** `xclip` | Clipboard sync | Bi-directional clipboard pull/push (Wayland: `wl-copy`/`wl-paste`, X11: `xclip`) |
| `iw` / `wireless-tools` | System stats | `iwgetid` — get current Wi-Fi SSID |
| `bluez` | Bluetooth toggles | `bluetoothctl` — connect/discover; `rfkill` — toggle radio |
| `networkmanager` | System info | `hostname -I` — get local IP |
| `iputils` | Ping check | `ping` — internet connectivity indicator |
| `systemd` | Lock Desktop | `loginctl lock-session` |
| `glib2` / `glib2-tools` | GNOME toggles | `gsettings` — night light and Caffeine extension (GNOME only) |
| `bash` | Caffeine commands | Compound `gsettings` invocations for Caffeine timers |

**GNOME Shell extension (optional):**
- [Caffeine](https://extensions.gnome.org/extension/517/caffeine/) — needed for the Caffeine toggle card

### Install

```sh
git clone git@github.com:Raj-Jai/control-deck.git
cd control-deck
```

#### Backend

```sh
go build -o tab-dashboard .
```

#### Frontend

```sh
cd frontend
npm install
npm run build
```

### TLS (optional, for PWA)

```sh
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt \
  -days 3650 -nodes -subj "/CN=$(hostname)"
```

### Run

```sh
./tab-dashboard
```

Open `http://localhost:8080/static/` in a browser, or `https://localhost:8443/static/` for PWA support.

## Auto‑start (systemd)

```sh
go build -o ~/.local/bin/tab-dashboard .
cp tab-dashboard.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now tab-dashboard
loginctl enable-linger
```

## Network Discovery (mDNS/Avahi)

```sh
sudo cp avahi-service.conf /etc/avahi/services/tab-dashboard.service
```

The dashboard becomes discoverable as `control-deck.local` on the local network.

## Configuration

All user-specific settings live in `config.json`:

```json
{
  "pin": "1234",
  "bt_mac": "AA:BB:CC:DD:EE:FF",
  "ping_target": "8.8.8.8",
  "http_port": 8080,
  "https_port": 8443,
  "caffeine_schema_dir": "",
  "custom_commands": {
    "erpLogin": ["erp", "login"],
    "warpOn": ["warp-cli", "connect"],
    "warpOff": ["warp-cli", "disconnect"]
  }
}
```

| Key | Description |
|-----|-------------|
| `pin` | Dashboard lock-screen PIN |
| `bt_mac` | Bluetooth MAC address for the "Connect Headphone" button |
| `ping_target` | Host to ping for internet connectivity check |
| `http_port` / `https_port` | Listen ports (HTTP and HTTPS) |
| `caffeine_schema_dir` | Override GSettings schema directory for Caffeine extension (auto-derived from `$HOME` if empty) |
| `custom_commands` | Extra CLI commands exposed as toggle/deck actions |

To override without modifying `config.json` (e.g., for local dev):

```sh
cp config.json config.local.json
# edit config.local.json
CONFIG_PATH=config.local.json ./control-deck
```

- **Player selection**: `findBestPlayer()` scores MPRIS players to prefer real media players over browser tabs
- **Multi‑player**: All active MPRIS players appear in a swipeable carousel; each has independent controls
- **App mixer**: Per‑app volume sliders use `pactl` sink-inputs, pushed via SSE
- **BT Speaker**: `bluetoothctl discoverable on && pairable on` — phone can stream to host
- **Capabilities**: `GET /api/capabilities` returns detected features; frontend hides unsupported cards

## Development

```sh
cd frontend && npm run dev   # Vite dev server with HMR
```

Rebuild frontend: `cd frontend && npm run build`

The built assets go to `../static/` which the Go server serves at runtime.

## License

MIT
