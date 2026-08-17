import crypto from 'node:crypto';
import GuacamoleLite from 'guacamole-lite';
import type { ConnectionSettings } from 'guacamole-lite';
import { RealmHttpClient } from './realm-http-client.js';

/** Where a realm's RDP endpoint actually lives, resolved server-side only. */
export interface RealmStreamTarget {
  hostname: string;
  port: number;
}

/** Looks up the current RDP target for a realm. Returns undefined if unknown/stopped. */
export type RealmTargetResolver = (realmId: string) => Promise<RealmStreamTarget | undefined>;

/**
 * A real, multi-realm-capable resolver: looks up a realm's actual assigned
 * RDP port via realm-api's REST surface (RealmSession.metadata.rdpPort,
 * populated by UbuntuEngine.start() — see packages/realm-ubuntu). guacd
 * always reaches a realm-ubuntu container over `host.docker.internal`
 * (itself a container under Docker Desktop), so hostname is fixed;
 * only the per-realm port varies.
 */
export function createApiTargetResolver(apiBaseUrl: string, hostname = 'host.docker.internal'): RealmTargetResolver {
  const client = new RealmHttpClient(apiBaseUrl);
  return async (realmId) => {
    const { realm } = await client.getRealm(realmId).catch(() => ({ realm: undefined }));
    const rdpPort = realm?.session?.metadata?.['rdpPort'];
    return rdpPort ? { hostname, port: parseInt(rdpPort, 10) } : undefined;
  };
}

export interface StreamServerOptions {
  /** Port the browser-facing WebSocket server listens on */
  wsPort: number;
  /** guacd sidecar (packages/realm-guacd) connection */
  guacd: { host: string; port: number };
  /** AES-256-CBC key used to encrypt/decrypt connection tokens (32 bytes) */
  cryptKey: string;
  /** Server-side source of truth for realmId -> RDP target, never trusted from the client */
  resolveTarget: RealmTargetResolver;
}

/**
 * Builds the Guacamole connection settings for a realm's RDP target.
 * hostname/port always come from the trusted resolver, never from caller input.
 */
export function buildConnectionSettings(target: RealmStreamTarget): ConnectionSettings {
  return {
    connection: {
      type: 'rdp',
      settings: {
        hostname: target.hostname,
        port: String(target.port),
        username: 'na',
        password: 'na',
        security: 'any',
        'ignore-cert': 'true',
        'color-depth': '24',
        'enable-drive': 'false',
        'enable-wallpaper': 'true',
      },
    },
  };
}

/**
 * Encrypts connection settings into the token format guacamole-lite expects:
 * base64(JSON.stringify({iv, value})), AES-256-CBC.
 */
export function encryptToken(settings: ConnectionSettings, cryptKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', cryptKey, iv);
  const value = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()]).toString('base64');
  return Buffer.from(JSON.stringify({ iv: iv.toString('base64'), value })).toString('base64');
}

/** Builds an encrypted connection token for a realm, resolving its target server-side. */
export async function issueToken(realmId: string, resolveTarget: RealmTargetResolver, cryptKey: string): Promise<string | undefined> {
  const target = await resolveTarget(realmId);
  if (!target) return undefined;
  return encryptToken(buildConnectionSettings(target), cryptKey);
}

/**
 * Starts the guacamole-lite WebSocket proxy: browser <-> this process <-> guacd.
 *
 * The real security boundary is that tokens are only ever minted by `issueToken`
 * against the trusted `resolveTarget`, and the browser has no way to produce a
 * valid token without the crypt key. `processConnectionSettings` here is a
 * shallow sanity check (well-formed RDP settings, not an arbitrary protocol) on
 * top of that, not a second full re-validation — the decrypted settings carry
 * hostname/port only, not a realmId to look back up against the resolver.
 */
export function createStreamServer(options: StreamServerOptions): GuacamoleLite {
  const { wsPort, guacd, cryptKey } = options;

  return new GuacamoleLite(
    { port: wsPort },
    { host: guacd.host, port: guacd.port },
    {
      crypt: { cypher: 'AES-256-CBC', key: cryptKey },
      processConnectionSettings: (settings, callback) => {
        if (settings.connection.type !== 'rdp' || !settings.connection.settings.hostname || !settings.connection.settings.port) {
          callback(new Error('Rejected connection: not a well-formed pinned RDP target'));
          return;
        }
        callback(null, settings);
      },
    },
  );
}
