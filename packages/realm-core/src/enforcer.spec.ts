/**
 * Tests for the capability enforcement model.
 *
 * Validates:
 *   - Observe-only: capture ✓, click ✗, type ✗
 *   - Mouse-only: click ✓, capture ✗
 *   - Keyboard-only: type ✓, keyPress ✓, capture ✗
 *   - No session: all operations denied
 *   - All capabilities: everything allowed
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RealmAPI, AuditLogger, PermissionDeniedError } from './api.js';
import { EngineType, RealmState } from './types.js';
import type { RealmEngine, RealmSession, ActionResult, FileRef, RealmConfig } from './index.js';

// --- Mock Engine ---
class MockEngine implements RealmEngine {
  readonly type = EngineType.Container;
  private realmData = new Map<string, boolean>();

  async create(config: RealmConfig): Promise<string> {
    const id = `realm-${config.name}-${Date.now()}`;
    this.realmData.set(id, false);
    return id;
  }

  async start(realmId: string): Promise<RealmSession> {
    this.realmData.set(realmId, true);
    return {
      id: `session-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: new Date().toISOString(),
      grantedCapabilities: [],
    };
  }

  async stop(realmId: string): Promise<void> {
    this.realmData.set(realmId, false);
  }

  async pause(_realmId: string): Promise<void> {
    // no-op
  }

  async resume(realmId: string): Promise<RealmSession> {
    return {
      id: `session-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: new Date().toISOString(),
      grantedCapabilities: [],
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

  async setNetworkMode(_realmId: string, _mode: never): Promise<void> {
    // no-op
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }> {
    return { status: 'healthy', uptimeSec: 60 };
  }
}

describe('Capability Enforcement', () => {
  let api: RealmAPI;
  let audit: AuditLogger;
  let engine: MockEngine;
  let realmId: string;

  beforeEach(async () => {
    audit = new AuditLogger();
    api = new RealmAPI(audit);
    engine = new MockEngine();
    api.registerEngine(engine);

    realmId = await api.create({ name: 'enforcement-test', engine: EngineType.Container });
  });

  describe('observe-only session', () => {
    beforeEach(async () => {
      await api.start(realmId, ['observe']);
    });

    it('should allow capture', async () => {
      const result = await api.capture(realmId);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should deny click', async () => {
      await expect(api.click(realmId, 100, 200)).rejects.toThrow(PermissionDeniedError);
    });

    it('should deny type', async () => {
      await expect(api.type(realmId, 'hello')).rejects.toThrow(PermissionDeniedError);
    });

    it('should deny scroll', async () => {
      await expect(api.scroll(realmId, 0, 100)).rejects.toThrow(PermissionDeniedError);
    });

    it('should deny keyPress', async () => {
      await expect(api.keyPress(realmId, 'Enter')).rejects.toThrow(PermissionDeniedError);
    });
  });

  describe('mouse-only session', () => {
    beforeEach(async () => {
      await api.start(realmId, ['mouse']);
    });

    it('should allow click', async () => {
      const result = await api.click(realmId, 100, 200);
      expect(result.success).toBe(true);
    });

    it('should deny capture', async () => {
      await expect(api.capture(realmId)).rejects.toThrow(PermissionDeniedError);
    });

    it('should deny type', async () => {
      await expect(api.type(realmId, 'hello')).rejects.toThrow(PermissionDeniedError);
    });
  });

  describe('keyboard-only session', () => {
    beforeEach(async () => {
      await api.start(realmId, ['keyboard']);
    });

    it('should allow type', async () => {
      const result = await api.type(realmId, 'hello');
      expect(result.success).toBe(true);
    });

    it('should allow keyPress', async () => {
      const result = await api.keyPress(realmId, 'Enter');
      expect(result.success).toBe(true);
    });

    it('should deny capture', async () => {
      await expect(api.capture(realmId)).rejects.toThrow(PermissionDeniedError);
    });

    it('should deny click', async () => {
      await expect(api.click(realmId, 100, 200)).rejects.toThrow(PermissionDeniedError);
    });
  });

  describe('scroll-only session', () => {
    beforeEach(async () => {
      await api.start(realmId, ['scroll']);
    });

    it('should allow scroll', async () => {
      const result = await api.scroll(realmId, 0, 100);
      expect(result.success).toBe(true);
    });

    it('should deny capture', async () => {
      await expect(api.capture(realmId)).rejects.toThrow(PermissionDeniedError);
    });

    it('should deny click', async () => {
      await expect(api.click(realmId, 100, 200)).rejects.toThrow(PermissionDeniedError);
    });
  });

  describe('no session (not started)', () => {
    it('should deny capture with no_session error', async () => {
      await expect(api.capture(realmId)).rejects.toThrow(PermissionDeniedError);
    });

    it('should deny click with no_session error', async () => {
      await expect(api.click(realmId, 100, 200)).rejects.toThrow(PermissionDeniedError);
    });
  });

  describe('all capabilities session', () => {
    beforeEach(async () => {
      await api.start(realmId, ['observe', 'mouse', 'keyboard', 'scroll', 'drag', 'clipboard']);
    });

    it('should allow capture', async () => {
      const result = await api.capture(realmId);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should allow click', async () => {
      const result = await api.click(realmId, 100, 200);
      expect(result.success).toBe(true);
    });

    it('should allow type', async () => {
      const result = await api.type(realmId, 'hello');
      expect(result.success).toBe(true);
    });

    it('should allow scroll', async () => {
      const result = await api.scroll(realmId, 0, 100);
      expect(result.success).toBe(true);
    });

    it('should allow keyPress', async () => {
      const result = await api.keyPress(realmId, 'Enter');
      expect(result.success).toBe(true);
    });
  });

  describe('start with default capabilities', () => {
    it('should grant all capabilities by default', async () => {
      const session = await api.start(realmId);
      expect(session.grantedCapabilities).toContain('observe');
      expect(session.grantedCapabilities).toContain('mouse');
      expect(session.grantedCapabilities).toContain('keyboard');
    });
  });

  describe('session carries granted capabilities', () => {
    it('should persist the granted set on the session', async () => {
      const capabilities: Array<'observe' | 'mouse'> = ['observe', 'mouse'];
      const session = await api.start(realmId, capabilities);
      expect(session.grantedCapabilities).toEqual(capabilities);
    });
  });

  describe('permission events', () => {
    beforeEach(async () => {
      await api.start(realmId, ['observe']);
    });

    it('should log a permission event when an operation is denied', async () => {
      try {
        await api.click(realmId, 100, 200);
      } catch {
        // expected
      }

      const events = api.getPermissionEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.operation).toBe('click');
      expect(events[0]!.allowed).toBe(false);
      expect(events[0]!.reason).toContain('missing_capability');
      expect(events[0]!.realmId).toBe(realmId);
      expect(events[0]!.sessionId).toBeDefined();
      expect(events[0]!.timestamp).toBeDefined();
    });

    it('should not log events for allowed operations', async () => {
      await api.capture(realmId);

      const events = api.getPermissionEvents();
      expect(events).toHaveLength(0);
    });

    it('should log multiple denial events', async () => {
      try { await api.click(realmId, 100, 200); } catch { /* expected */ }
      try { await api.type(realmId, 'hello'); } catch { /* expected */ }
      try { await api.scroll(realmId, 0, 100); } catch { /* expected */ }

      const events = api.getPermissionEvents();
      expect(events).toHaveLength(3);
      expect(events.map((e) => e.operation)).toEqual(['click', 'type', 'scroll']);
    });
  });
});
