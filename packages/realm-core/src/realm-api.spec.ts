import { describe, it, expect, beforeEach } from 'vitest';
import { RealmAPI, AuditLogger } from './api.js';
import { EngineType, NetworkMode, PermissionType } from './types.js';
import type { RealmEngine } from './engine.js';
import type { RealmConfig, RealmSession, ActionResult, FileRef } from './types.js';

// --- Mock Engine ---
class MockEngine implements RealmEngine {
  readonly type = EngineType.Container;
  private realmData = new Map<string, boolean>();

  async create(config: RealmConfig): Promise<string> {
    const id = `realm-${config.name}-${Date.now()}`;
    this.realmData.set(id, false); // not started
    return id;
  }

  async start(realmId: string): Promise<RealmSession> {
    this.realmData.set(realmId, true);
    return {
      id: `session-${realmId}`,
      realmId,
      state: 'running' as const,
      startedAt: new Date().toISOString(),
    };
  }

  async stop(realmId: string): Promise<void> {
    this.realmData.set(realmId, false);
  }

  async pause(realmId: string): Promise<void> {
    // no-op
  }

  async resume(realmId: string): Promise<RealmSession> {
    return {
      id: `session-${realmId}`,
      realmId,
      state: 'running' as const,
      startedAt: new Date().toISOString(),
    };
  }

  async destroy(realmId: string): Promise<void> {
    this.realmData.delete(realmId);
  }

  async capture(_realmId: string): Promise<Buffer> {
    return Buffer.from('fake-screenshot-data');
  }

  async click(_realmId: string, x: number, y: number): Promise<ActionResult> {
    return { success: true, data: { x, y }, durationMs: 10, timestamp: new Date().toISOString() };
  }

  async typeText(_realmId: string, text: string): Promise<ActionResult> {
    return { success: true, data: { length: text.length }, durationMs: 5, timestamp: new Date().toISOString() };
  }

  async keyPress(_realmId: string, _key: string): Promise<ActionResult> {
    return { success: true, durationMs: 3, timestamp: new Date().toISOString() };
  }

  async scroll(_realmId: string, dx: number, dy: number): Promise<ActionResult> {
    return { success: true, data: { dx, dy }, durationMs: 8, timestamp: new Date().toISOString() };
  }

  async navigate(_realmId: string, url: string): Promise<ActionResult> {
    return { success: true, data: { url }, durationMs: 10, timestamp: new Date().toISOString() };
  }

  async execute(_realmId: string, cmd: string): Promise<ActionResult> {
    return { success: true, data: { stdout: `executed: ${cmd}` }, durationMs: 50, timestamp: new Date().toISOString() };
  }

  async importFile(_realmId: string, src: string, dst: string): Promise<FileRef> {
    return { path: dst, name: src.split('/').pop() ?? 'file', sizeBytes: 1024 };
  }

  async exportFile(_realmId: string, src: string, dst: string): Promise<FileRef> {
    return { path: dst, name: src.split('/').pop() ?? 'file', sizeBytes: 1024 };
  }

  async listFiles(_realmId: string, path: string): Promise<FileRef[]> {
    return [{ path, name: 'test.txt', sizeBytes: 100, mimeType: 'text/plain' }];
  }

  async setNetworkMode(_realmId: string, _mode: NetworkMode): Promise<void> {
    // no-op
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }> {
    return { status: 'healthy', uptimeSec: 60 };
  }
}

describe('RealmAPI', () => {
  let api: RealmAPI;
  let audit: AuditLogger;
  let engine: MockEngine;

  beforeEach(() => {
    audit = new AuditLogger();
    api = new RealmAPI(audit);
    engine = new MockEngine();
    api.registerEngine(engine);
  });

  describe('engine registration', () => {
    it('should register an engine', () => {
      expect(api.getEngine(EngineType.Container)).toBe(engine);
    });

    it('should return all registered engines', () => {
      const engines = api.getEngines();
      expect(engines).toHaveLength(1);
      expect(engines[0]?.type).toBe(EngineType.Container);
    });
  });

  describe('realm lifecycle', () => {
    it('should create a realm', async () => {
      const config: RealmConfig = {
        name: 'test-realm',
        engine: EngineType.Container,
      };
      const id = await api.create(config);
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should fail on duplicate realm name', async () => {
      const config: RealmConfig = {
        name: 'dup-realm',
        engine: EngineType.Container,
      };
      await api.create(config);
      await expect(api.create(config)).rejects.toThrow(/already exists/);
    });

    it('should fail on unsupported engine', async () => {
      const config: RealmConfig = {
        name: 'bad-engine',
        engine: EngineType.VM,
      };
      await expect(api.create(config)).rejects.toThrow(/not supported/);
    });

    it('should start and stop a realm', async () => {
      const id = await api.create({ name: 'lifecycle', engine: EngineType.Container });
      const session = await api.start(id);
      expect(session.state).toBe('running');
      expect(session.realmId).toBe(id);

      await api.stop(id);
      const realm = api.getRealm(id);
      expect(realm?.session).toBeUndefined();
    });

    it('should destroy a realm', async () => {
      const id = await api.create({ name: 'destroy-me', engine: EngineType.Container });
      await api.destroy(id);
      expect(api.getRealm(id)).toBeUndefined();
    });

    it('should fail on non-existent realm', async () => {
      await expect(api.start('fake-id')).rejects.toThrow(/not found/);
    });
  });

  describe('actions', () => {
    let realmId: string;

    beforeEach(async () => {
      realmId = await api.create({ name: 'action-test', engine: EngineType.Container });
    });

    it('should capture a screenshot', async () => {
      const buf = await api.capture(realmId);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.toString()).toBe('fake-screenshot-data');
    });

    it('should click at coordinates', async () => {
      const result = await api.click(realmId, 100, 200);
      expect(result.success).toBe(true);
    });

    it('should type text', async () => {
      const result = await api.type(realmId, 'hello world');
      expect(result.success).toBe(true);
    });

    it('should execute a command', async () => {
      const result = await api.execute(realmId, 'ls -la');
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
    });
  });

  describe('audit logging', () => {
    it('should log all actions', async () => {
      const id = await api.create({ name: 'audit-test', engine: EngineType.Container });
      await api.start(id);
      await api.click(id, 10, 20);
      await api.type(id, 'test');
      await api.stop(id);
      await api.destroy(id);

      const entries = api.getAuditLog();
      expect(entries.length).toBeGreaterThanOrEqual(6);
      const actions = entries.map((e) => e.action);
      expect(actions).toContain('realm.create');
      expect(actions).toContain('realm.start');
      expect(actions).toContain('realm.click');
      expect(actions).toContain('realm.type');
      expect(actions).toContain('realm.stop');
      expect(actions).toContain('realm.destroy');
    });

    it('should filter audit entries by action', async () => {
      const audit = new AuditLogger();
      const api2 = new RealmAPI(audit);
      api2.registerEngine(engine);

      const id = await api2.create({ name: 'filter-test', engine: EngineType.Container });
      await api2.start(id);
      await api2.destroy(id);

      const createEntries = audit.getEntriesByAction('realm.create');
      expect(createEntries).toHaveLength(1);
      expect(createEntries[0]?.action).toBe('realm.create');
    });
  });
});
