# @theaiinc/realm-api

<p align="center">
  <a href="https://github.com/theaiinc/realm"><img alt="GitHub Repo" src="https://img.shields.io/badge/github-theaiinc%2Frealm-181717?style=flat-square&logo=github"/></a>
  <a href="https://www.npmjs.com/package/@theaiinc/realm-api"><img alt="npm" src="https://img.shields.io/npm/v/@theaiinc/realm-api?style=flat-square&logo=npm"/></a>
  <a href="https://github.com/theaiinc/realm/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/theaiinc/realm?style=flat-square"/></a>
</p>

![Realm](logo.svg)

**Fastify HTTP API server for the Realm platform.**

Exposes realm lifecycle, execution, and audit endpoints over REST. This is the primary entry point for orchestration layers (Pathway, Oasis Cognition) to interact with Realm engines.

## Features

- **REST API** — Full CRUD for realm sessions
- **Multi-engine support** — Routes to Container, Browser, and Ubuntu engines
- **Screenshot endpoint** — Capture realm display output
- **Interaction endpoints** — Click, type, exec, import, export
- **Audit logging** — Built-in audit trail endpoint
- **CORS enabled** — Ready for frontend integration

## Installation

```bash
pnpm add @theaiinc/realm-api
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

## Quick Start

```bash
pnpm realm:api
```

Server starts on **port 8542**.

## Dependencies

- **fastify** — HTTP server framework
- **@fastify/cors** — CORS support
- All Realm engine packages

## License

MIT
