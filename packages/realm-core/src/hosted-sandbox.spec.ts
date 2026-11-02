import { describe, expect, it } from 'vitest';
import {
  FREE_PLAN_LIMITS,
  DeterministicFakeBroker,
  checkEgress,
  limitsForPlan,
  validateExecEnv,
  type AuditSink,
  type HostedAuditEvent,
  type EgressPolicy,
} from './hosted-sandbox.js';

describe('hosted sandbox core policy', () => {
  it('uses known, configured-free, then built-in plan limits', () => {
    const configured = { pro: { ...FREE_PLAN_LIMITS, dailyCpuMinutes: 240 }, free: { ...FREE_PLAN_LIMITS, dailyCpuMinutes: 60 } };
    expect(limitsForPlan('pro', configured).dailyCpuMinutes).toBe(240);
    expect(limitsForPlan('unknown', configured).dailyCpuMinutes).toBe(60);
    expect(limitsForPlan('unknown', {})).toEqual(FREE_PLAN_LIMITS);
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

  it('rejects secret environment values and keys', () => {
    expect(() => validateExecEnv({ TOKEN: 'arcana://github/user' })).toThrow();
    expect(() => validateExecEnv({ API_TOKEN: 'not-a-reference' })).toThrow();
    expect(() => validateExecEnv({ SAFE_MODE: '1' })).not.toThrow();
  });
});
