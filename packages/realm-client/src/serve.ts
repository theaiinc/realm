#!/usr/bin/env node
// Standalone runner: guacamole-lite WS proxy + a minimal token-issuing HTTP
// endpoint the browser calls before opening the WebSocket.
//
// Resolves each realm's actual RDP target dynamically via realm-api's REST
// surface (RealmSession.metadata.rdpPort) — supports any number of
// concurrently running realm-ubuntu realms, not just one pinned by env var.
import http from 'node:http';
import { createStreamServer, issueToken, createApiTargetResolver } from './stream-server.js';

const WS_PORT = Number(process.env['STREAM_WS_PORT'] ?? 8080);
const TOKEN_PORT = Number(process.env['STREAM_TOKEN_PORT'] ?? 8081);
const GUACD_HOST = process.env['GUACD_HOST'] ?? 'localhost';
const GUACD_PORT = Number(process.env['GUACD_PORT'] ?? 4822);
const CRYPT_KEY = process.env['STREAM_CRYPT_KEY'];
const REALM_API_URL = process.env['REALM_API_URL'] ?? 'http://127.0.0.1:8542';
const REALM_RDP_HOST = process.env['REALM_RDP_HOST'] ?? 'host.docker.internal';

if (!CRYPT_KEY || CRYPT_KEY.length !== 32) {
  console.error('[realm-client] STREAM_CRYPT_KEY must be set to exactly 32 characters (AES-256-CBC key)');
  process.exit(1);
}

const resolveTarget = createApiTargetResolver(REALM_API_URL, REALM_RDP_HOST);

createStreamServer({ wsPort: WS_PORT, guacd: { host: GUACD_HOST, port: GUACD_PORT }, cryptKey: CRYPT_KEY, resolveTarget });
console.log(`[realm-client] Guacamole WS proxy listening on :${WS_PORT}, forwarding to guacd at ${GUACD_HOST}:${GUACD_PORT}`);
console.log(`[realm-client] Resolving realm targets dynamically via ${REALM_API_URL}`);

const tokenServer = http.createServer((req, res) => {
  // realm-ui runs on its own origin (Vite dev server / a static host), so
  // this token endpoint needs CORS headers for browser fetches — curl and
  // server-to-server calls don't hit this, only real browsers enforce it.
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${TOKEN_PORT}`);
  if (url.pathname !== '/token') {
    res.writeHead(404).end();
    return;
  }
  const realmId = url.searchParams.get('realmId');
  if (!realmId) {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'realmId query param required' }));
    return;
  }
  issueToken(realmId, resolveTarget, CRYPT_KEY)
    .then((token) => {
      if (!token) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unknown or stopped realm' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ token }));
    })
    .catch((err: unknown) => {
      res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    });
});

tokenServer.listen(TOKEN_PORT, () => {
  console.log(`[realm-client] Token endpoint listening on :${TOKEN_PORT} (GET /token?realmId=...)`);
});
