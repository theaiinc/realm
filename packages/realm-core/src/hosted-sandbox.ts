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
  if (plan === undefined) {
    const freeLimits = configured.free;
    return freeLimits === undefined ? FREE_PLAN_LIMITS : freeLimits;
  }
  if (!Object.hasOwn(configured, plan)) throw new Error(`unknown plan: ${plan}`);
  const limits = configured[plan];
  if (limits === undefined) throw new Error(`unknown plan: ${plan}`);
  return limits;
}

export interface PtyOpenRequest { cwd?: string; cols?: number; rows?: number; command?: string; timeoutSec?: number; }
export interface PtySession { sessionId: string; cols: number; rows: number; }
export interface PtyOutput { data: string; nextOffset: number; closed: boolean; exitCode?: number; }
export interface PtyAdapter {
  open(request: PtyOpenRequest): Promise<PtySession>;
  input(sessionId: string, data: string): Promise<void>;
  output(sessionId: string, offset: number): Promise<PtyOutput>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
}

export interface ExecRequest {
  command: string;
  cwd?: string;
  timeoutSec?: number;
  /** Environment values are non-secret configuration only; secrets never enter the sandbox. */
  env?: Record<string, string>;
}
export interface ExecState { executionId: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out'; exitCode?: number; output: string; nextOffset: number; }

const SECRET_ENV_KEY = /(?:TOKEN|SECRET|APIKEY|GH_PAT|PASSWORD|KEY)$/i;
const SECRET_ENV_VALUE = /(?:arcana:\/\/|bearer\s+|(?:token|secret|password|api[_-]?key)\s*[:=]|[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@|(?:ghp_|github_pat_|sk-|AKIA[A-Z0-9]{16})|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

export function validateExecEnv(env: Record<string, string> | undefined): void {
  for (const [key, value] of Object.entries(env ?? {})) {
    if (SECRET_ENV_KEY.test(key) || SECRET_ENV_VALUE.test(value)) {
      throw new Error(`secret environment value is not allowed: ${key}`);
    }
  }
}
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

export interface EgressRule { methods?: readonly string[]; paths?: readonly string[]; }
export interface EgressPolicy {
  version: number;
  allowedHosts: Readonly<Record<string, EgressRule | undefined>>;
  denyByDefault: true;
}
export interface EgressCheckRequest { host: string; method: string; path: string; }
export interface EgressCheckResult { decision: 'allow' | 'deny'; reason: string; }

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+\.?$/, '').replace(/\.$/, '');
}

export function checkEgress(policy: EgressPolicy, request: EgressCheckRequest): EgressCheckResult {
  const host = normalizeHost(request.host);
  const rule = Object.entries(policy.allowedHosts).find(([allowedHost]) => normalizeHost(allowedHost) === host)?.[1];
  if (policy.denyByDefault !== true || !rule) return { decision: 'deny', reason: 'host_not_allowed' };
  if (!rule.methods && !rule.paths) return { decision: 'deny', reason: 'rule_has_no_constraints' };
  if (rule.methods && !rule.methods.some((method) => method.toUpperCase() === request.method.toUpperCase())) {
    return { decision: 'deny', reason: 'method_not_allowed' };
  }
  if (rule.paths && !rule.paths.includes(request.path)) return { decision: 'deny', reason: 'path_not_allowed' };
  return { decision: 'allow', reason: 'allowed' };
}

export interface ResourceLimits {
  memoryBytes: number;
  maxProcesses: number;
  maxProcessesPerSession: number;
  idleShutdownSec: number;
  maxConcurrentTerminals: number;
  maxConcurrentExecs: number;
  maxExecDurationSec: number;
}

export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = {
  memoryBytes: 2 * 1024 ** 3,
  maxProcesses: 128,
  maxProcessesPerSession: 32,
  idleShutdownSec: 15 * 60,
  maxConcurrentTerminals: 1,
  maxConcurrentExecs: 1,
  maxExecDurationSec: 6 * 60 * 60,
};

export function assertExecAllowed(request: ExecRequest, limits: Pick<ResourceLimits, 'maxExecDurationSec'>): void {
  if (request.timeoutSec !== undefined && (!Number.isFinite(request.timeoutSec) || request.timeoutSec > limits.maxExecDurationSec)) {
    throw new Error('exec timeout exceeds limit');
  }
}
