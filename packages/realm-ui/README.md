# @theaiinc/realm-ui

Web viewer for Realm — the first frontend package in this repo. Vite + vanilla TypeScript (no framework), since it's a single view: a live desktop canvas plus a small control panel.

Two panels:

- **Primary — XFCE desktop.** Real-time, interactive, via `guacamole-common-js` connected to `realm-client`'s Guacamole WebSocket proxy (`packages/realm-client`), which bridges to `guacd` (`packages/realm-guacd`), which bridges to `realm-ubuntu`'s `xrdp`.
- **Secondary — Android Auto / DHU (host).** Polled screenshots via `realm-api`'s existing `/capture` endpoint against a `realm-host` realm. Deliberately not real-time streaming — a narrow, host-launched capability doesn't warrant a second streaming pipeline.

## Running

```bash
pnpm --filter @theaiinc/realm-ui dev
```

Configure via env vars (`.env` or shell), all optional (defaults point at localhost):

- `VITE_REALM_API_URL` (default `http://127.0.0.1:8542`)
- `VITE_STREAM_TOKEN_URL` (default `http://127.0.0.1:8081`)
- `VITE_STREAM_WS_URL` (default `ws://127.0.0.1:8080`)
