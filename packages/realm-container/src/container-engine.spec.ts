import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContainerEngine } from './container-engine.js';
import type { RealmConfig } from '@theaiinc/realm-core';
import { EngineType, NetworkMode } from '@theaiinc/realm-core';

vi.mock('dockerode', () => {
  const mockExecStream = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') cb(Buffer.from('0000000000000004test'));
      if (event === 'end') cb();
      return mockExecStream;
    }),
  };

  const mockExec = {
    start: vi.fn().mockResolvedValue(mockExecStream),
  };

  const mockContainer = {
    id: 'test-container-id',
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    unpause: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({
      State: { StartedAt: new Date().toISOString() },
      HostConfig: { NetworkMode: 'bridge' },
    }),
    exec: vi.fn().mockResolvedValue(mockExec),
    putArchive: vi.fn().mockResolvedValue(undefined),
    getArchive: vi.fn().mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('test-archive-data');
      },
    }),
  };

  const mockDocker = vi.fn(() => ({
    getContainer: vi.fn().mockReturnValue(mockContainer),
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getImage: vi.fn().mockReturnValue({ inspect: vi.fn().mockRejectedValue(new Error('not found')) }),
    pull: vi.fn((_img: string, _opts: unknown, cb: (err: Error | null, stream: unknown) => void) => {
      cb(null, {
        on: vi.fn(),
        pipe: vi.fn(),
      });
    }),
    modem: {
      followProgress: vi.fn((_stream: unknown, cb: (err: Error | null) => void) => cb(null)),
    },
    info: vi.fn().mockResolvedValue({ SystemStatus: 'running' }),
    listContainers: vi.fn().mockResolvedValue([]),
  }));

  return { default: mockDocker };
});

describe('ContainerEngine', () => {
  let engine: ContainerEngine;

  beforeEach(() => {
    engine = new ContainerEngine();
    vi.clearAllMocks();
  });

  it('should have the correct type', () => {
    expect(engine.type).toBe(EngineType.Container);
  });

  it('should create a realm', async () => {
    const config: RealmConfig = {
      name: 'test-realm',
      engine: EngineType.Container,
    };
    const id = await engine.create(config);
    expect(id).toBe('test-container-id');
  });

  it('should start a realm', async () => {
    const session = await engine.start('test-container-id');
    expect(session.state).toBe('running');
    expect(session.realmId).toBe('test-container-id');
  });

  it('should stop a realm', async () => {
    await expect(engine.stop('test-container-id')).resolves.toBeUndefined();
  });

  it('should pause a realm', async () => {
    await expect(engine.pause('test-container-id')).resolves.toBeUndefined();
  });

  it('should resume a realm', async () => {
    const session = await engine.resume('test-container-id');
    expect(session.state).toBe('running');
  });

  it('should destroy a realm', async () => {
    await expect(engine.destroy('test-container-id')).resolves.toBeUndefined();
  });

  it('should return health status', async () => {
    const health = await engine.health();
    expect(health.status).toBe('healthy');
  });

  it('should capture screenshot', async () => {
    const screenshot = await engine.capture('test-container-id');
    expect(screenshot).toBeInstanceOf(Buffer);
  });

  it('should execute a command', async () => {
    const result = await engine.execute('test-container-id', 'echo hello');
    expect(result.success).toBe(true);
  });
});
