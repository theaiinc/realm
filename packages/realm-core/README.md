# @theaiinc/realm-core

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

## License

MIT
