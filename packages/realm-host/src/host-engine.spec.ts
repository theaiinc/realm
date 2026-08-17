import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealmError, RealmNotFoundError } from '@theaiinc/realm-core';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(null, { stdout: '', stderr: '' });
  }),
  spawn: vi.fn(),
}));

const { HostEngine } = await import('./host-engine.js');

describe('HostEngine.create', () => {
  it('rejects a HOST_TARGET outside the hardcoded allowlist', async () => {
    const engine = new HostEngine();
    await expect(engine.create({ name: 'x', environment: { HOST_TARGET: 'arbitrary-shell' } } as never)).rejects.toMatchObject({
      code: 'HOST_TARGET_NOT_ALLOWED',
    });
  });

  it('rejects a missing HOST_TARGET', async () => {
    const engine = new HostEngine();
    await expect(engine.create({ name: 'x', environment: {} } as never)).rejects.toBeInstanceOf(RealmError);
  });

  it('accepts the allowlisted android-auto target', async () => {
    const engine = new HostEngine();
    const realmId = await engine.create({ name: 'x', environment: { HOST_TARGET: 'android-auto' } } as never);
    expect(realmId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('HostEngine — operations explicitly out of scope for a narrow launcher', () => {
  const engine = new HostEngine();

  it.each(['pause', 'resume', 'scroll', 'navigate', 'execute', 'listFiles', 'setNetworkMode'] as const)(
    '%s rejects with HOST_OPERATION_NOT_SUPPORTED',
    async (method) => {
      await expect((engine[method] as () => Promise<unknown>)()).rejects.toMatchObject({
        code: 'HOST_OPERATION_NOT_SUPPORTED',
      });
    },
  );
});

describe('HostEngine — operations on an unknown realm', () => {
  let engine: InstanceType<typeof HostEngine>;
  beforeEach(() => {
    engine = new HostEngine();
  });

  it('capture rejects with RealmNotFoundError', async () => {
    await expect(engine.capture('missing')).rejects.toBeInstanceOf(RealmNotFoundError);
  });

  it('click rejects with RealmNotFoundError', async () => {
    await expect(engine.click('missing', 0, 0)).rejects.toBeInstanceOf(RealmNotFoundError);
  });

  it('setLocation rejects with RealmNotFoundError', async () => {
    await expect(engine.setLocation('missing', 0, 0)).rejects.toBeInstanceOf(RealmNotFoundError);
  });

  it('installApp rejects with RealmNotFoundError', async () => {
    await expect(engine.installApp('missing', '/tmp/x.apk')).rejects.toBeInstanceOf(RealmNotFoundError);
  });

  it('importFile rejects with RealmNotFoundError', async () => {
    await expect(engine.importFile('missing', '/tmp/x', '/sdcard/x')).rejects.toBeInstanceOf(RealmNotFoundError);
  });

  it('exportFile rejects with RealmNotFoundError', async () => {
    await expect(engine.exportFile('missing', '/sdcard/x', '/tmp/x')).rejects.toBeInstanceOf(RealmNotFoundError);
  });
});

describe('HostEngine — setLocation/installApp are implemented (optional RealmEngine methods)', () => {
  it('setLocation is present on the instance', () => {
    const engine = new HostEngine();
    expect(typeof engine.setLocation).toBe('function');
  });

  it('installApp is present on the instance', () => {
    const engine = new HostEngine();
    expect(typeof engine.installApp).toBe('function');
  });
});

describe('HostEngine.health', () => {
  it('reports healthy', async () => {
    const engine = new HostEngine();
    await expect(engine.health()).resolves.toMatchObject({ status: 'healthy' });
  });
});
