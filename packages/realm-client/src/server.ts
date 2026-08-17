// Node-only entry point (@theaiinc/realm-client/server) — pulls in
// guacamole-lite. Keep browser code importing from the package root
// instead, which only has the REST client.
export { buildConnectionSettings, encryptToken, issueToken, createStreamServer, createApiTargetResolver } from './stream-server.js';
export type { RealmStreamTarget, RealmTargetResolver, StreamServerOptions } from './stream-server.js';
