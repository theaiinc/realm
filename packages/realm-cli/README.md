# @theaiinc/realm-cli

![Realm](logo.svg)

**CLI client for managing Realm execution environments.**

Create, start, stop, exec, and destroy sandboxed realms directly from your terminal.

## Features

- **Create realms** — Spin up container, browser, or Ubuntu desktop sessions
- **Lifecycle management** — Start, stop, destroy realms
- **Command execution** — Run commands inside active realms
- **File operations** — Import and export files
- **Screenshots** — Capture realm display output

## Installation

```bash
pnpm add -g @theaiinc/realm-cli
```

## Usage

```bash
# Create a new realm
realm create --name my-realm --engine container

# List active realms
realm list

# Execute a command
realm exec <realm-id> -- echo "hello from realm"

# Capture a screenshot
realm capture <realm-id> --output screenshot.png

# Stop and destroy
realm stop <realm-id>
realm destroy <realm-id>
```

## Dependencies

- **commander** — CLI framework

## License

MIT
