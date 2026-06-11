# AGENT_GUIDELINES

## Project: Realm — Isolated AI Execution Environment

### Repo Structure
```
theaiincrealm/
├── packages/
│   ├── realm-core/        # Core abstractions (types, API, engine interface, audit, security)
│   ├── realm-container/   # Docker container engine
│   ├── realm-browser/     # Playwright/Chromium browser engine
│   ├── realm-api/         # Fastify HTTP API server (port 8542)
│   ├── realm-cli/         # CLI client (HTTP to API server)
│   └── realm-veil/        # Veil PII redaction integration
├── docs/
│   └── product-design.prd # Product requirements document
├── README.md
├── CONTRIBUTION_GUIDELINES.md
└── AGENT_GUIDELINES.md    # This file — agent dev log
```

### Architecture TL;DR
- Realm is an **execution abstraction layer** — agents hit a universal API, engines handle the runtime
- MVP has two engines: Container (Docker) and Browser (Playwright)
- macOS VM (Apple Virtualization Framework) is V2
- Oasis Cognition replaces Mythos as the agent runtime
- Pathway orchestrates workflows on top
- Veil secures all outbound data (PII detection/redaction)
- Yggdrasil integration planned for distributed orchestration (post-MVP)

### Key Conventions
- **Language:** TypeScript, ESM, strict mode
- **Monorepo:** pnpm workspaces, no Nx v2 dependency yet (each package builds independently with tsup)
- **Testing:** vitest, tests co-located as `src/*.spec.ts`
- **Engine interface:** `RealmEngine` in `packages/realm-core/src/engine.ts`
- **Core facade:** `RealmAPI` in `packages/realm-core/src/api.ts`
- **Security model:** Default deny in `packages/realm-core/src/security.ts`
- **Audit:** `AuditLogger` in `packages/realm-core/src/api.ts` — logs all actions

### Build & Test
```bash
pnpm install && pnpm build   # Build all packages
pnpm test                    # Run all tests (51 tests across 4 packages)
```

### Aha Moments & Memorizable Info
1. **TypeScript ESM + tsup:** Workspace packages need `.js` extensions in imports. tsup handles bundling. For DTS generation, bundles with cross-workspace references can fail — use `--dts` only on leaf packages (realm-core), skip for entry points (realm-api, realm-cli).
2. **ContainerEngine architecture:** Uses `dockerode` for Docker API. Stream multiplexing (first byte = stream type, next 4 bytes = length, then payload) is parsed manually since dockerode doesn't auto-demux in all cases.
3. **BrowserEngine architecture:** Uses Playwright's `launchPersistentContext` for isolated browser profiles per realm. Screenshots, mouse, keyboard, and page evaluation are mapped to RealmEngine methods. The `navigate()` and `getDomSnapshot()` methods exist beyond the base interface for browser-specific use.
4. **Veil pipeline does offline regex PII detection** — no external API needed for basic patterns. Production should use `@theaiinc/veil` npm package for more sophisticated detection.
5. **PermissionManager** implements default-deny with an optional async request handler. Caches grants per realm for the session lifetime.
6. **The PRD was rewritten from v1 to v2.0** — Realm changed from a VM product to an execution abstraction layer. The plan and codebase follow v2.0.
