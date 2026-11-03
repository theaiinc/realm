import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESOURCE_LIMITS,
  FREE_PLAN_LIMITS,
  assertExecAllowed,
  checkEgress,
  limitsForPlan,
  validateExecEnv,
  type AuditSink,
  type HostedAuditEvent,
  type EgressPolicy,
  type ExecRequest,
  type EgressAuthorizeRequest,
  type EgressDecision,
  type Broker,
} from './hosted-sandbox.js';

class DeterministicFakeBroker implements Broker {
  readonly requests: EgressAuthorizeRequest[] = [];
  constructor(private readonly allowedHosts: ReadonlySet<string> = new Set()) {}
  async authorize(request: EgressAuthorizeRequest): Promise<EgressDecision> {
    this.requests.push(request);
    if (!this.allowedHosts.has(request.host)) return { decision: 'deny', reason: 'host_not_allowed' };
    return { decision: 'allow', lease: `fake-lease-${this.requests.length}`, expiresAt: '2099-01-01T00:00:00.000Z' };
  }
}

describe('hosted sandbox core policy', () => {
    it('uses known, configured-free, then built-in plan limits', () => {
      const configured = { pro: { ...FREE_PLAN_LIMITS, dailyCpuMinutes: 240 }, free: { ...FREE_PLAN_LIMITS, dailyCpuMinutes: 60 } };
      expect(limitsForPlan('pro', configured).dailyCpuMinutes).toBe(240);
      expect(() => limitsForPlan('unknown', configured)).toThrow('unknown plan');
      expect(limitsForPlan(undefined, {})).toEqual(FREE_PLAN_LIMITS);
      expect(() => limitsForPlan('constructor', {})).toThrow('unknown plan');
    });

    it('denies hosts, allows configured hosts with leases, and records order', async () => {
      const broker = new DeterministicFakeBroker(new Set(['github.com']));
      const denied = await broker.authorize({ reference: 'arcana://x', sandboxId: 's', userId: 'u', host: 'evil.test', method: 'GET', path: '/', requestId: '1' });
      const allowed = await broker.authorize({ reference: 'arcana://x', sandboxId: 's', userId: 'u', host: 'github.com', method: 'GET', path: '/', requestId: '2' });
      expect(denied.decision).toBe('deny');
      expect(allowed).toMatchObject({ decision: 'allow', lease: 'fake-lease-2' });
      expect(broker.requests.map(({ requestId }) => requestId)).toEqual(['1', '2']);
    });

    it('records a well-formed audit event in an in-memory sink', async () => {
      const events: HostedAuditEvent[] = [];
      const sink: AuditSink = { append: async (event) => { events.push(event); } };
      await sink.append({ id: 'e1', userId: 'u', sandboxId: 's', action: 'create', timestamp: new Date().toISOString(), success: true });
      expect(events[0]).toMatchObject({ id: 'e1', userId: 'u', sandboxId: 's', action: 'create', success: true });
    });

    it('checks host, method, and allowed requests with deny-by-default policy', () => {
      const policy: EgressPolicy = { version: 1, denyByDefault: true, allowedHosts: { 'github.com': { methods: ['GET'], paths: ['/org/repo'] } } };
      expect(checkEgress(policy, { host: 'unknown.test', method: 'GET', path: '/' }).decision).toBe('deny');
      expect(checkEgress(policy, { host: 'github.com', method: 'POST', path: '/org/repo' }).decision).toBe('deny');
      expect(checkEgress(policy, { host: 'github.com', method: 'GET', path: '/org/repo' }).decision).toBe('allow');
    });

    it('denies paths, unconstrained host rules, and normalizes hostnames', () => {
      const policy: EgressPolicy = {
        version: 1,
        denyByDefault: true,
        allowedHosts: {
          'github.com': { methods: ['GET'], paths: ['/org/repo'] },
          'example.com': {},
        },
      };
      expect(checkEgress(policy, { host: 'github.com', method: 'GET', path: '/other' }).decision).toBe('deny');
      expect(checkEgress(policy, { host: 'example.com', method: 'GET', path: '/' }).decision).toBe('deny');
      expect(checkEgress(policy, { host: 'GITHUB.COM.:443', method: 'GET', path: '/org/repo' }).decision).toBe('allow');
    });

    it('enforces execution timeout and resource limits', () => {
      const request: ExecRequest = { command: 'npm test', timeoutSec: FREE_PLAN_LIMITS.maxExecDurationSec + 1 };
      expect(() => assertExecAllowed(request, FREE_PLAN_LIMITS)).toThrow('exec timeout');
      expect(() => assertExecAllowed({ command: 'nan', timeoutSec: Number.NaN } as ExecRequest, FREE_PLAN_LIMITS)).toThrow('exec timeout');
      expect(() => assertExecAllowed({ command: 'infinite', timeoutSec: Number.POSITIVE_INFINITY } as ExecRequest, FREE_PLAN_LIMITS)).toThrow('exec timeout');
      expect(DEFAULT_RESOURCE_LIMITS).toMatchObject({
        memoryBytes: 2 * 1024 ** 3,
        maxProcesses: 128,
        maxProcessesPerSession: 32,
        idleShutdownSec: 15 * 60,
        maxConcurrentTerminals: 1,
        maxConcurrentExecs: 1,
      });
      expect(() => assertExecAllowed({ command: 'large', timeoutSec: FREE_PLAN_LIMITS.maxExecDurationSec } as ExecRequest, FREE_PLAN_LIMITS)).not.toThrow();
      expect(FREE_PLAN_LIMITS.diskLimitBytes).toBe(10 * 1024 ** 3);
      expect(FREE_PLAN_LIMITS.dailyCpuMinutes).toBeLessThanOrEqual(60);
    });

    it('rejects secret environment values and keys', () => {
      expect(() => validateExecEnv({ TOKEN: 'safe-looking' })).toThrow();
      expect(() => validateExecEnv({ APIKEY: 'safe-looking' })).toThrow();
      expect(() => validateExecEnv({ GH_PAT: 'safe-looking' })).toThrow();
      expect(() => validateExecEnv({ SAFE_MODE: 'https://user:password@example.com' })).toThrow();
      expect(() => validateExecEnv({ SAFE_MODE: 'ghp_exampletoken' })).toThrow();
      expect(() => validateExecEnv({ SAFE_MODE: 'github_pat_exampletoken' })).toThrow();
      expect(() => validateExecEnv({ SAFE_MODE: 'sk-exampletoken' })).toThrow();
      expect(() => validateExecEnv({ SAFE_MODE: 'AKIA1234567890ABCDEF' })).toThrow();
      expect(() => validateExecEnv({ SAFE_MODE: '-----BEGIN RSA PRIVATE KEY-----' })).toThrow();
      expect(() => validateExecEnv({ SAFE_MODE: '1' })).not.toThrow();
    });
  });
