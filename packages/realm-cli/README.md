# @theaiinc/realm-cli

<p align="center">
  <a href="https://github.com/theaiinc/realm"><img alt="GitHub Repo" src="https://img.shields.io/badge/github-theaiinc%2Frealm-181717?style=flat-square&logo=github"/></a>
  <a href="https://www.npmjs.com/package/@theaiinc/realm-cli"><img alt="npm" src="https://img.shields.io/npm/v/@theaiinc/realm-cli?style=flat-square&logo=npm"/></a>
  <a href="https://github.com/theaiinc/realm/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/theaiinc/realm?style=flat-square"/></a>
</p>

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
