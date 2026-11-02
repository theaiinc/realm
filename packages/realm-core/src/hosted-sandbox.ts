export type PlanId = string;

export interface PlanLimits {
  dailyCpuMinutes: number;
  maxExecDurationSec: number;
  diskLimitBytes: number;
  maxPtyDurationSec: number;
}

export const FREE_PLAN_LIMITS: Readonly<PlanLimits> = {
  dailyCpuMinutes: 60,
  maxExecDurationSec: 6 * 60 * 60,
  diskLimitBytes: 10 * 1024 ** 3,
  maxPtyDurationSec: 2 * 60 * 60,
};

export type PlanLimitsMap = Readonly<Record<PlanId, PlanLimits>>;

export function limitsForPlan(plan: string | undefined, configured: PlanLimitsMap): PlanLimits {
  return configured[plan ?? ''] ?? configured.free ?? FREE_PLAN_LIMITS;
}

export interface PtyOpenRequest { cwd?: string; cols?: number; rows?: number; command?: string; }
export interface PtySession { sessionId: string; cols: number; rows: number; }
export interface PtyOutput { data: string; nextOffset: number; closed: boolean; exitCode?: number; }
export interface PtyAdapter {
  open(request: PtyOpenRequest): Promise<PtySession>;
  input(sessionId: string, data: string): Promise<void>;
  output(sessionId: string, offset: number): Promise<PtyOutput>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
}

export interface ExecRequest { command: string; cwd?: string; timeoutSec?: number; env?: Record<string, string>; }
export interface ExecState { executionId: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out'; exitCode?: number; output: string; nextOffset: number; }
export interface ExecAdapter {
  start(request: ExecRequest): Promise<{ executionId: string }>;
  status(executionId: string, offset: number): Promise<ExecState>;
  cancel(executionId: string): Promise<void>;
}

export type HostedAuditAction = 'create' | 'command_start' | 'resize' | 'cancel' | 'timeout' | 'network_allow' | 'network_deny' | 'quota_reject' | 'sync_in' | 'sync_out' | 'destroy';
export interface HostedAuditEvent { id: string; userId: string; sandboxId: string; action: HostedAuditAction; timestamp: string; success: boolean; detail?: Record<string, unknown>; }
export interface AuditSink { append(event: HostedAuditEvent): Promise<void>; }

export interface EgressAuthorizeRequest { reference: string; sandboxId: string; userId: string; host: string; method: string; path: string; requestId: string; }
export interface EgressDecision { decision: 'allow' | 'deny'; lease?: string; expiresAt?: string; reason?: string; }
export interface Broker { authorize(request: EgressAuthorizeRequest): Promise<EgressDecision>; }

export class DeterministicFakeBroker implements Broker {
  constructor(private readonly allowedHosts: ReadonlySet<string> = new Set()) {}
  readonly requests: EgressAuthorizeRequest[] = [];
  async authorize(request: EgressAuthorizeRequest): Promise<EgressDecision> {
    this.requests.push(request);
    if (!this.allowedHosts.has(request.host)) return { decision: 'deny', reason: 'host_not_allowed' };
    return { decision: 'allow', lease: `fake-lease-${this.requests.length}`, expiresAt: '2099-01-01T00:00:00.000Z' };
  }
}
