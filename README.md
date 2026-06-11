# Realm

**A world built for agents.**

Realm is an isolated AI execution environment platform. Agents interact with a universal API and never know which engine (Container, Browser, or future VM) is executing their task.

## Architecture

```
User
  |
  v
Pathway (orchestration layer)
  |
  v
Oasis Cognition (agent runtime)
  |
  v
Realm API (universal interface)
  |
  +--- Container Engine (Docker)
  +--- Browser Engine (Playwright/Chromium)
  +--- VM Engine (future: Apple Virtualization Framework)
```

## Packages

| Package | Description |
|---------|-------------|
| `@theaiinc/realm-core` | Core abstractions, types, API facade, audit logging |
| `@theaiinc/realm-container` | Docker-based container engine |
| `@theaiinc/realm-browser` | Playwright/Chromium browser engine |
| `@theaiinc/realm-api` | Fastify HTTP API server (port 8542) |
| `@theaiinc/realm-cli` | CLI client for managing realms |
| `@theaiinc/realm-veil` | Veil PII redaction integration |

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the Realm API server
pnpm realm:api

# In another terminal, create a realm
pnpm realm create --name my-realm --engine container

# Start it
pnpm realm start <realm-id>

# Execute a command
pnpm realm exec <realm-id> -- echo "hello from realm"

# Stop and destroy
pnpm realm stop <realm-id>
pnpm realm destroy <realm-id>
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/realms` | List all realms |
| POST | `/api/v1/realms` | Create a realm |
| GET | `/api/v1/realms/:id` | Get realm details |
| POST | `/api/v1/realms/:id/start` | Start a realm |
| POST | `/api/v1/realms/:id/stop` | Stop a realm |
| DELETE | `/api/v1/realms/:id` | Destroy a realm |
| GET | `/api/v1/realms/:id/capture` | Capture screenshot |
| POST | `/api/v1/realms/:id/click` | Click at coordinates |
| POST | `/api/v1/realms/:id/type` | Type text |
| POST | `/api/v1/realms/:id/exec` | Execute command |
| POST | `/api/v1/realms/:id/import` | Import file |
| POST | `/api/v1/realms/:id/export` | Export file |
| GET | `/api/v1/audit` | Get audit log |

## Security Model

**Default deny** — nothing is accessible unless explicitly granted:

- Internet access (disabled / restricted / full)
- File import (copied, not mounted directly)
- File export (requires user approval)
- Clipboard (needs explicit permission)
- Shared folder (read-only / read-write / disabled)

## Veil Integration

All outbound data (screenshots, documents, logs, reports) passes through Veil PII detection before reaching the agent or being exported.

Detected PII types:
- Email addresses
- Phone numbers
- Credit card numbers
- Passport numbers
- API keys and secrets
- Access tokens
- Names

## Test Suite

```bash
pnpm test
```

**51 tests** across 4 packages: core (20), container (10), browser (13), veil (8).
