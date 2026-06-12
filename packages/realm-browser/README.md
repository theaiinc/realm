# @theaiinc/realm-browser

<p align="center">
  <a href="https://github.com/theaiinc/realm"><img alt="GitHub Repo" src="https://img.shields.io/badge/github-theaiinc%2Frealm-181717?style=flat-square&logo=github"/></a>
  <a href="https://www.npmjs.com/package/@theaiinc/realm-browser"><img alt="npm" src="https://img.shields.io/npm/v/@theaiinc/realm-browser?style=flat-square&logo=npm"/></a>
  <a href="https://github.com/theaiinc/realm/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/theaiinc/realm?style=flat-square"/></a>
</p>

![Realm](logo.svg)

**Playwright/Chromium browser engine for Realm.**

Enables AI agents to interact with web pages through an automated browser — navigate, click, type, extract text, and capture screenshots — all behind the universal Realm API.

## Features

- **Headless Chromium** — Full browser automation via Playwright
- **Page interaction** — Navigate, click, type, scroll, extract text
- **Screenshot capture** — Full-page and viewport screenshots
- **Session isolation** — Each realm gets its own browser context
- **Network control** — Restrict or allow internet access per session

## Installation

```bash
pnpm add @theaiinc/realm-browser
```

## Usage

```typescript
import { BrowserEngine } from '@theaiinc/realm-browser';

const engine = new BrowserEngine();
const session = await engine.create({ headless: true });
await engine.navigate(session.id, 'https://example.com');
const text = await engine.getPageText(session.id);
```

## Dependencies

- **playwright** — Browser automation framework

## License

MIT
