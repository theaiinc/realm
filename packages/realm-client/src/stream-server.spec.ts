import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildConnectionSettings, encryptToken, issueToken } from './stream-server.js';

const CRYPT_KEY = '01234567890123456789012345678901'.slice(0, 32);

function decryptToken(token: string, key: string): unknown {
  const { iv, value } = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

describe('buildConnectionSettings', () => {
  it('pins the given hostname/port as an RDP connection', () => {
    const settings = buildConnectionSettings({ hostname: 'host.docker.internal', port: 3389 });
    expect(settings.connection.type).toBe('rdp');
    expect(settings.connection.settings.hostname).toBe('host.docker.internal');
    expect(settings.connection.settings.port).toBe('3389');
    expect(settings.connection.settings['ignore-cert']).toBe('true');
  });
});

describe('encryptToken', () => {
  it('round-trips through guacamole-lite\'s expected {iv, value} base64 token format', () => {
    const settings = buildConnectionSettings({ hostname: '127.0.0.1', port: 3389 });
    const token = encryptToken(settings, CRYPT_KEY);

    const decrypted = decryptToken(token, CRYPT_KEY);
    expect(decrypted).toEqual(settings);
  });

  it('produces a different token each time (random IV)', () => {
    const settings = buildConnectionSettings({ hostname: '127.0.0.1', port: 3389 });
    const tokenA = encryptToken(settings, CRYPT_KEY);
    const tokenB = encryptToken(settings, CRYPT_KEY);
    expect(tokenA).not.toBe(tokenB);
  });
});

describe('issueToken', () => {
  it('never trusts the caller for hostname/port — only the resolver', async () => {
    const resolveTarget = async (realmId: string) =>
      realmId === 'realm-1' ? { hostname: 'host.docker.internal', port: 4001 } : undefined;

    const token = await issueToken('realm-1', resolveTarget, CRYPT_KEY);
    expect(token).toBeDefined();

    const decrypted = decryptToken(token as string, CRYPT_KEY) as ReturnType<typeof buildConnectionSettings>;
    expect(decrypted.connection.settings.port).toBe('4001');
  });

  it('returns undefined for an unknown/stopped realm rather than guessing a target', async () => {
    const resolveTarget = async () => undefined;
    await expect(issueToken('missing-realm', resolveTarget, CRYPT_KEY)).resolves.toBeUndefined();
  });
});

describe('createApiTargetResolver', () => {
  it('resolves a realm\'s target from its session.metadata.rdpPort via realm-api', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ realm: { id: 'realm-1', config: {}, session: { metadata: { rdpPort: '54321' } } } }), {
        status: 200,
      })) as typeof fetch;
    try {
      const { createApiTargetResolver } = await import('./stream-server.js');
      const resolveTarget = createApiTargetResolver('http://127.0.0.1:8542', 'host.docker.internal');
      const target = await resolveTarget('realm-1');
      expect(target).toEqual({ hostname: 'host.docker.internal', port: 54321 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns undefined when the realm has no running session', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ realm: { id: 'realm-1', config: {} } }), { status: 200 })) as typeof fetch;
    try {
      const { createApiTargetResolver } = await import('./stream-server.js');
      const resolveTarget = createApiTargetResolver('http://127.0.0.1:8542');
      await expect(resolveTarget('realm-1')).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
