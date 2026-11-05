# @theaiinc/realm-core

<p align="center">
  <a href="https://github.com/theaiinc/realm"><img alt="GitHub Repo" src="https://img.shields.io/badge/github-theaiinc%2Frealm-181717?style=flat-square&logo=github"/></a>
  <a href="https://www.npmjs.com/package/@theaiinc/realm-core"><img alt="npm" src="https://img.shields.io/npm/v/@theaiinc/realm-core?style=flat-square&logo=npm"/></a>
  <a href="https://github.com/theaiinc/realm/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/theaiinc/realm?style=flat-square"/></a>
</p>

![Realm](logo.svg)

**Core abstractions, types, and API facade for the Realm platform.**

`@theaiinc/realm-core` defines the universal interface that all Realm engines implement. Agents interact with this API and never know which engine is executing their task.

## Features

- **`RealmEngine` interface** — Contract for execution engines (lifecycle, interaction, filesystem, network, snapshots)
- **`RealmAPI` facade** — Entry point that routes calls to registered engines
- **`EngineType` enum** — Identifies engine implementations (`Container`, `Browser`, `Ubuntu`, `VM`)
- **Core types** — `RealmConfig`, `RealmSession`, `EngineStatus`, `NetworkMode`, `Interaction` interfaces
- **Audit logging** — Built-in audit trail for all realm operations

## Installation

```bash
pnpm add @theaiinc/realm-core
```

## Usage

```typescript
import { RealmAPI, EngineType } from '@theaiinc/realm-core';

const api = new RealmAPI();
api.registerEngine(myEngine);
const session = await api.create({ type: EngineType.Container });
```

## Local folder PTY adapter

The Node-only `@theaiinc/realm-core/node` entry exports `FolderPtyAdapter` for local development and tests. It provides a confined working directory and bounded session behavior, but it is **not a security sandbox**: shells can still read host files and use host kernel capabilities. Production isolation must be supplied by a hardened container, VM, or equivalent wrapper.

`node-pty` is an optional dependency used only by this adapter. On macOS, ensure the package's `spawn-helper` is executable after installation (for example, run `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper` when the package manager preserves incorrect permissions).

## License

MIT
