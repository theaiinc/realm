# @theaiinc/realm-client

Streaming and control client for Realm.

Two concerns, one package:

- **Streaming** (`@theaiinc/realm-client/server`, `stream-server.ts`): wraps [`guacamole-lite`](https://github.com/vadimpronin/guacamole-lite) (MIT) to bridge a browser WebSocket to a `guacd` sidecar (see `packages/realm-guacd`), which speaks RDP to a `realm-ubuntu` container's `xrdp` bridge. Connection tokens (hostname/port) are always built server-side from a trusted `RealmTargetResolver`, AES-256-CBC encrypted, and handed to the browser — the browser never supplies or can forge which host/port it connects to.
- **Control** (`@theaiinc/realm-client`, `realm-http-client.ts`): a thin typed `fetch` wrapper around `realm-api`'s REST surface, mirroring `realm-cli`'s `api()` helper.

These are two separate entry points on purpose: `guacamole-lite` is Node-only (`crypto`/`net`/`events`), so it lives behind the `./server` subpath — importing the package root (`@theaiinc/realm-client`, used by `realm-ui`) only ever pulls in the browser-safe REST client.

## Running the streaming proxy standalone

```bash
STREAM_CRYPT_KEY=<32-char-key> \
REALM_API_URL=http://127.0.0.1:8542 \
pnpm --filter @theaiinc/realm-client build && pnpm --filter @theaiinc/realm-client serve
```

This starts the Guacamole WebSocket proxy (default `:8080`) and a token-issuing HTTP endpoint (default `:8081`, `GET /token?realmId=...`) that `realm-ui` calls before opening its WebSocket connection.

Realm targets are resolved dynamically via `createApiTargetResolver` (`stream-server.ts`), which queries `realm-api`'s `GET /api/v1/realms/:id` and reads `session.metadata.rdpPort` — populated by `UbuntuEngine.start()` (`packages/realm-ubuntu`) from the host port Docker actually assigned (see that package's notes on why host ports aren't pinned: it lets multiple `realm-ubuntu` realms run concurrently). This supports any number of realms, not just one pinned by env var.
