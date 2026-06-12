# @theaiinc/realm-container

<p align="center">
  <a href="https://github.com/theaiinc/realm"><img alt="GitHub Repo" src="https://img.shields.io/badge/github-theaiinc%2Frealm-181717?style=flat-square&logo=github"/></a>
  <a href="https://www.npmjs.com/package/@theaiinc/realm-container"><img alt="npm" src="https://img.shields.io/npm/v/@theaiinc/realm-container?style=flat-square&logo=npm"/></a>
  <a href="https://github.com/theaiinc/realm/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/theaiinc/realm?style=flat-square"/></a>
</p>

![Realm](logo.svg)

**Docker-based container engine for Realm.**

Provides isolated Linux sandboxes with full lifecycle management, filesystem access, network control, and command execution — all behind the universal Realm API.

## Features

- **Container lifecycle** — Create, start, stop, destroy containers via Docker
- **Command execution** — Run arbitrary commands inside containers
- **Filesystem operations** — Import/export files via tar streams
- **Network control** — Restrict, disable, or allow full internet access
- **Screenshot capture** — Capture container display output
- **TypeScript-first** — Full type safety with the `RealmEngine` interface

## Installation

```bash
pnpm add @theaiinc/realm-container
```

## Usage

```typescript
import { ContainerEngine } from '@theaiinc/realm-container';

const engine = new ContainerEngine();
const session = await engine.create({
  image: 'ubuntu:24.04',
  networkMode: 'isolated',
});
await engine.exec(session.id, 'echo "hello from realm"');
```

## Dependencies

- **dockerode** — Docker Engine API client

## License

MIT
