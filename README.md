# Control Deck

A web‑based dashboard for a local Linux workstation, accessed from tablets and phones over the local network. Media controls, system stats, clipboard sync, audio streaming, and more.

## Features

- **Now Playing** — MPRIS media controls: play/pause, next/previous, timeline seek, album art
- **Volume & Brightness** — sliders with night‑light toggle and audio output sink switching
- **System Stats** — CPU, RAM, battery, temperature, network info with ping status
- **Clipboard Sync** — bi‑directional pull/push between browser and host (wl‑paste/wl‑copy + xclip)
- **Audio Stream** — real‑time MP3 stream from the host's audio output to the browser
- **Caffeine** — toggle GNOME Caffeine extension (30m, 1h, or infinite)
- **Lock Screen** — PIN‑protected dashboard lock with 6‑hour session
- **Toggles** — Bluetooth, WARP, Lock Desktop, ERP Login

## Architecture

```
┌──────────────┐     HTTP/SSE/WS      ┌──────────────┐
│   Go Server  │ ◄──────────────────► │  React PWA   │
│  (port 8080) │                      │  (tablet)    │
│              │                      │              │
│  ffmpeg ─────┼──audio stream────────┤  <audio>     │
│              │                      │              │
│  playerctl ──┼──MPRIS state─────────┤  NowPlaying  │
└──────────────┘                      └──────────────┘
```

- **Backend**: Go (`main.go`) — MPRIS polling, command execution, clipboard, audio capture, SSE broadcast
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS — single‑page PWA
- **Audio**: FFmpeg captures PulseAudio monitor → MP3 → chunked HTTP → `<audio>` element

## Setup

### Prerequisites

- Go 1.21+
- Node.js 18+
- `playerctl` (media controls)
- `pulseaudio-utils` / PipeWire (audio capture)
- `brightnessctl` (backlight control)
- `wl-clipboard` or `xclip` (clipboard sync)
- `wpctl` (WirePlumber volume control)

### Install

```sh
git clone <repo-url> tab-dashboard
cd tab-dashboard
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
# Generate self-signed cert
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

- **PIN**: Change `dashPIN` in `main.go` (default `"0616"`)
- **Sinks**: Audio output toggle detects BT vs internal via `bluez` in sink name
- **Player**: `findBestPlayer()` in `main.go` scores MPRIS players to prefer real media players over browser tabs

## Development

```sh
cd frontend && npm run dev   # Vite dev server with HMR
```

Rebuild frontend: `cd frontend && npm run build`

The built assets go to `../static/` which the Go server serves at runtime.

## License

MIT
