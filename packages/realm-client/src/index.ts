// Browser-safe entry point — only the REST client. The streaming server
// (stream-server.ts) pulls in guacamole-lite, a Node-only dependency
// (crypto/net/events), and lives at the "./server" subpath instead so
// browser bundlers (realm-ui) never need to externalize Node builtins.
export { RealmHttpClient } from './realm-http-client.js';
export type { RealmSummary } from './realm-http-client.js';
