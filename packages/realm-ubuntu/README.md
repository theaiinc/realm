# @theaiinc/realm-ubuntu

![Realm](logo.svg)

**Ubuntu Desktop engine for Realm.**

Provides a full XFCE4 desktop environment inside a Docker container, with VNC remote access, Chromium browser, and an embedded Yggdrasil Ratatoskr daemon — purpose-built for AI agent computer-use tasks.

## Features

- **Full Ubuntu Desktop** — XFCE4 with panel, terminal, and window manager
- **Virtual display** — Xvfb framebuffer at configurable resolution (default: 1920×1080)
- **VNC access** — Connect via any VNC client to observe and interact
- **xdotool input** — Mouse, keyboard, and scroll simulation
- **ImageMagick screenshots** — Fast, lightweight screen capture
- **Chromium browser** — Bundled via Playwright (arm64-compatible). Firefox ESR also included.
- **Oasis Chrome Bridge** — Pre-installed extension connects to the dev-agent WebSocket for computer-use automation
- **Embedded Ratatoskr** — Yggdrasil runner daemon starts automatically when `YGGDRASIL_URL` is configured
- **Pre-installed tooling** — Node.js 22, Python 3 (with pyautogui), Git, GitHub CLI, and more

## Installation

```bash
pnpm add @theaiinc/realm-ubuntu
```

## Quick Start

```bash
# Step 1: Build the Docker image
cd packages/realm-ubuntu
pnpm build:docker

# Step 2: Run with Ratatoskr for Yggdrasil orchestration
docker run -d \
  --name my-ubuntu-realm \
  -p 5901:5901 \
  -e YGGDRASIL_URL=http://host.docker.internal:3000 \
  -e CAPABILITIES=agent,code \
  realm-ubuntu

# Step 3: Connect via VNC
open vnc://localhost:5901
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YGGDRASIL_URL` | — | Yggdrasil server URL (enables Ratatoskr) |
| `CAPABILITIES` | `agent,code` | Ratatoskr capability presets |
| `API_KEY` | — | Yggdrasil API key |
| `RUNNER_NAME` | `realm-ubuntu` | Ratatoskr runner name |
| `LLM_MODEL` | `google/gemma-4-26b-a4b-qat` | LLM model for agent tasks |
| `LLM_BASE_URL` | `http://host.docker.internal:1234/v1` | LLM API base URL |
| `VNC_PORT` | `5901` | VNC server port |
| `DEV_AGENT_WS_HOST` | `host.docker.internal` | Oasis Chrome Bridge WebSocket host |
| `DEV_AGENT_WS_PORT` | `8008` | Oasis Chrome Bridge WebSocket port |

## Docker Image

The Dockerfile builds an image with:

- **OS:** Ubuntu 24.04 (Noble)
- **Desktop:** XFCE4 + Xvfb + x11vnc
- **Browsers:** Chromium (Playwright) + Firefox ESR
- **Input/Display:** xdotool + ImageMagick
- **Languages:** Node.js 22, Python 3.12
- **Dev tools:** Git, GitHub CLI, jq, ripgrep, build-essential, SQLite, PostgreSQL client, Redis tools
- **Ratatoskr:** `@theaiinc/yggdrasil-ratatoskr` v0.2.x (global)

## Architecture

```
┌─────────────────────────────────────────────┐
│  realm-ubuntu Container                     │
│                                             │
│  Xvfb ── XFCE4 ── x11vnc (:5901)           │
│    │                                        │
│    ├── Chromium + Oasis Bridge Extension    │
│    │        └── WebSocket ── host:8008      │
│    │                                        │
│    └── Ratatoskr                            │
│             └── HTTP ── host.docker:3000    │
│                                             │
└─────────────────────────────────────────────┘
```

## License

MIT
