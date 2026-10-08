import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { RealmEngine } from '@theaiinc/realm-core';
import { EngineType, NetworkMode, RealmError, RealmNotFoundError, RealmState } from '@theaiinc/realm-core';
import type { ActionResult, FileRef, RealmConfig, RealmSession } from '@theaiinc/realm-core';

/** Result of one `sbx` invocation. */
export interface SbxResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `sbx` with arguments; injectable so tests don't need Docker. */
export type SbxRunner = (args: string[], options?: { timeoutMs?: number }) => Promise<SbxResult>;

/** The real `sbx` CLI (SBX_BIN overrides the binary). Never throws on a non-zero exit. */
export const runSbx: SbxRunner = (args, options = {}) =>
  new Promise((resolve) => {
    execFile(
      process.env.SBX_BIN || 'sbx',
      args,
      { maxBuffer: 32 * 1024 * 1024, timeout: options.timeoutMs ?? 15 * 60_000 },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((error as { code?: unknown }).code) : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && !stderr ? error.message : '')) });
      },
    );
  });

/**
 * What a sandbox realm is made of. Engine settings travel in the realm's
 * `environment` (the convention realm-host set with HOST_TARGET); the
 * `SANDBOX_*` keys are read here and every other key becomes an environment
 * variable inside the sandbox.
 *
 * | Key | Meaning |
 * |---|---|
 * | SANDBOX_KIT | Agent name (`claude`, `shell`) or kit reference (dir, OCI, git). Required. |
 * | SANDBOX_KIT_ARGS | `name=value` pairs separated by `;` or newlines |
 * | SANDBOX_CLOUD | `false` for a local sandbox; cloud by default |
 * | SANDBOX_CPUS / SANDBOX_MEMORY | Size, e.g. `1` and `2g` (cloud default 2 / 4g) |
 * | SANDBOX_TTL | Cloud time-to-live (e.g. `45m`); the sandbox stops when it lapses |
 * | SANDBOX_ALLOW_NETWORK | Extra egress hosts, comma separated (restricted mode) |
 */
export interface SandboxRecord {
  name: string;
  sandboxName: string;
  kit: string;
  kitArgs: string[];
  cloud: boolean;
  cpus?: string;
  memory?: string;
  ttl?: string;
  allowNetwork: string[];
  networkMode: NetworkMode;
  env: Record<string, string>;
  /** Created in Docker (it exists, running or stopped). */
  created: boolean;
}

const SANDBOX_KEYS = new Set([
  'SANDBOX_KIT', 'SANDBOX_KIT_ARGS', 'SANDBOX_CLOUD', 'SANDBOX_CPUS', 'SANDBOX_MEMORY', 'SANDBOX_TTL', 'SANDBOX_ALLOW_NETWORK',
]);

function notSupported(operation: string): RealmError {
  return new RealmError(
    `${operation} is not supported by realm-sandbox: a Docker sandbox is headless (commands and files only).`,
    'SANDBOX_OPERATION_NOT_SUPPORTED',
    { operation },
  );
}

function failed(what: string, result: SbxResult, details: Record<string, unknown> = {}): RealmError {
  const message = (result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 500);
  return new RealmError(`${what} failed: ${message || `sbx exited ${result.code}`}`, 'SANDBOX_COMMAND_FAILED', { ...details, exitCode: result.code });
}

/** `a=1;b=2` or one per line → ["a=1", "b=2"]; rejects entries without a name. */
export function parseKitArgs(value: string | undefined): string[] {
  return String(value ?? '')
    .split(/[;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!/^[A-Za-z_][\w.-]*=/.test(entry)) {
        throw new RealmError(`SANDBOX_KIT_ARGS entry "${entry}" must be name=value`, 'SANDBOX_INVALID_CONFIG', { entry });
      }
      return entry;
    });
}

/** Sandbox names are visible in Docker; keep them short, stable and safe. */
export function sandboxNameFor(realmName: string, realmId: string): string {
  const slug = realmName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'realm';
  return `${slug}-${realmId.slice(0, 8)}`;
}

/**
 * DockerSandboxEngine — a realm is one Docker Agentic Platform sandbox,
 * cloud by default. Docker provides the isolation Realm promises: a microVM
 * per sandbox, egress through a policy proxy, and credentials injected by
 * that proxy so they never enter the sandbox. This engine maps Realm's
 * lifecycle, command and file operations onto `sbx`; there is no display, so
 * capture/click/type/navigate are refused rather than faked.
 */
export class DockerSandboxEngine implements RealmEngine {
  readonly type = EngineType.DockerSandbox;

  private readonly realms = new Map<string, SandboxRecord>();
  private readonly startedAt = Date.now();

  constructor(private readonly sbx: SbxRunner = runSbx) {}

  private record(realmId: string): SandboxRecord {
    const record = this.realms.get(realmId);
    if (!record) throw new RealmNotFoundError(realmId);
    return record;
  }

  private scope(record: SandboxRecord): string[] {
    return record.cloud ? ['--cloud'] : [];
  }

  async create(config: RealmConfig): Promise<string> {
    const env = config.environment ?? {};
    const kit = env['SANDBOX_KIT']?.trim();
    if (!kit) throw new RealmError('SANDBOX_KIT is required (an agent name such as "claude", or a kit reference)', 'SANDBOX_INVALID_CONFIG');
    const networkMode = config.networkMode ?? NetworkMode.Restricted;
    if (networkMode === NetworkMode.Disabled) {
      // Every sandbox talks to its agent's API through Docker's proxy; "no
      // network" isn't a mode Docker offers, so say so instead of pretending.
      throw new RealmError('A Docker sandbox cannot run with networking disabled; use restricted (the kit\'s allowlist)', 'SANDBOX_INVALID_CONFIG', { networkMode });
    }
    const realmId = crypto.randomUUID();
    const passthrough = Object.fromEntries(Object.entries(env).filter(([key]) => !SANDBOX_KEYS.has(key)));
    this.realms.set(realmId, {
      name: config.name,
      sandboxName: sandboxNameFor(config.name, realmId),
      kit,
      kitArgs: parseKitArgs(env['SANDBOX_KIT_ARGS']),
      cloud: env['SANDBOX_CLOUD'] !== 'false',
      cpus: env['SANDBOX_CPUS']?.trim() || undefined,
      memory: env['SANDBOX_MEMORY']?.trim() || undefined,
      ttl: env['SANDBOX_TTL']?.trim() || undefined,
      allowNetwork: (env['SANDBOX_ALLOW_NETWORK'] ?? '').split(',').map((h) => h.trim()).filter(Boolean),
      networkMode,
      env: passthrough,
      created: false,
    });
    return realmId;
  }

  /** `sbx run` arguments that create the sandbox, detached. */
  runArgs(record: SandboxRecord): string[] {
    const args = [...this.scope(record), 'run', record.kit, '--detached', '--name', record.sandboxName];
    if (record.cloud) args.push('--new');
    if (record.cpus) args.push('--cpus', record.cpus);
    if (record.memory) args.push('--memory', record.memory);
    if (record.cloud && record.ttl) args.push('--ttl', record.ttl, '--on-timeout', 'stop');
    for (const kitArg of record.kitArgs) args.push('--kit-arg', kitArg);
    for (const [key, value] of Object.entries(record.env)) args.push('--env', `${key}=${value}`);
    if (record.cloud) {
      const allow = record.networkMode === NetworkMode.Full ? ['*'] : record.allowNetwork;
      for (const host of allow) args.push('--allow-network', host);
    }
    return args;
  }

  async start(realmId: string): Promise<RealmSession> {
    const record = this.record(realmId);
    // First start creates the sandbox; later starts restart the same one
    // (its files, links and caches survive a stop).
    const args = record.created
      ? [...this.scope(record), 'run', '--name', record.sandboxName, '--detached']
      : this.runArgs(record);
    const result = await this.sbx(args, { timeoutMs: 30 * 60_000 });
    if (result.code !== 0) throw failed(`Starting sandbox ${record.sandboxName}`, result, { realmId });
    record.created = true;
    if (!record.cloud && record.allowNetwork.length) {
      const policy = await this.sbx(['policy', 'allow', 'network', '--sandbox', record.sandboxName, record.allowNetwork.join(',')]);
      if (policy.code !== 0) throw failed('Allowing network hosts', policy, { realmId });
    }
    return this.session(realmId, record, RealmState.Running);
  }

  private session(realmId: string, record: SandboxRecord, state: RealmState): RealmSession {
    return {
      id: `session-sandbox-${realmId}`,
      realmId,
      state,
      startedAt: new Date().toISOString(),
      metadata: { sandbox: record.sandboxName, kit: record.kit, cloud: String(record.cloud) },
      grantedCapabilities: [],
    };
  }

  async stop(realmId: string): Promise<void> {
    const record = this.record(realmId);
    if (!record.created) return;
    const result = await this.sbx([...this.scope(record), 'stop', record.sandboxName]);
    if (result.code !== 0) throw failed(`Stopping sandbox ${record.sandboxName}`, result, { realmId });
  }

  /** A stopped Docker sandbox keeps its state and isn't billed: that is a pause. */
  async pause(realmId: string): Promise<void> {
    await this.stop(realmId);
  }

  async resume(realmId: string): Promise<RealmSession> {
    const record = this.record(realmId);
    if (!record.created) throw new RealmError(`Sandbox ${record.sandboxName} was never started`, 'SANDBOX_NOT_STARTED', { realmId });
    return this.start(realmId);
  }

  async destroy(realmId: string): Promise<void> {
    const record = this.record(realmId);
    if (record.created) {
      const result = await this.sbx([...this.scope(record), 'rm', '--force', record.sandboxName]);
      if (result.code !== 0 && !/not found|no such/i.test(result.stderr + result.stdout)) {
        throw failed(`Removing sandbox ${record.sandboxName}`, result, { realmId });
      }
    }
    this.realms.delete(realmId);
  }

  async capture(): Promise<Buffer> {
    throw notSupported('capture');
  }

  async click(): Promise<ActionResult> {
    throw notSupported('click');
  }

  async typeText(): Promise<ActionResult> {
    throw notSupported('typeText');
  }

  async keyPress(): Promise<ActionResult> {
    throw notSupported('keyPress');
  }

  async scroll(): Promise<ActionResult> {
    throw notSupported('scroll');
  }

  async navigate(): Promise<ActionResult> {
    throw notSupported('navigate');
  }

  async execute(realmId: string, command: string, args: string[] = []): Promise<ActionResult> {
    const record = this.record(realmId);
    if (!record.created) throw new RealmError(`Start the realm before running commands`, 'SANDBOX_NOT_STARTED', { realmId });
    const begun = Date.now();
    const result = await this.sbx([...this.scope(record), 'exec', record.sandboxName, command, ...args]);
    return {
      success: result.code === 0,
      data: { stdout: result.stdout, stderr: result.stderr, exitCode: result.code },
      ...(result.code === 0 ? {} : { error: (result.stderr || `exit code ${result.code}`).trim().slice(0, 2000) }),
      durationMs: Date.now() - begun,
      timestamp: new Date().toISOString(),
    };
  }

  async importFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    const record = this.record(realmId);
    const result = await this.sbx([...this.scope(record), 'cp', sourcePath, `${record.sandboxName}:${destPath}`]);
    if (result.code !== 0) throw failed('Importing a file', result, { realmId, destPath });
    const { size } = await stat(sourcePath);
    return { path: destPath, name: path.basename(destPath), sizeBytes: size };
  }

  async exportFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    const record = this.record(realmId);
    const result = await this.sbx([...this.scope(record), 'cp', `${record.sandboxName}:${sourcePath}`, destPath]);
    if (result.code !== 0) throw failed('Exporting a file', result, { realmId, sourcePath });
    const { size } = await stat(destPath);
    return { path: destPath, name: path.basename(destPath), sizeBytes: size };
  }

  async listFiles(realmId: string, dirPath: string): Promise<FileRef[]> {
    const result = await this.execute(realmId, 'find', [dirPath, '-mindepth', '1', '-maxdepth', '1', '-printf', '%s\\t%p\\n']);
    if (!result.success) throw new RealmError(`Listing ${dirPath} failed: ${result.error}`, 'SANDBOX_COMMAND_FAILED', { realmId, dirPath });
    const { stdout } = result.data as { stdout: string };
    return stdout.split('\n').filter(Boolean).map((line) => {
      const tab = line.indexOf('\t');
      const filePath = tab >= 0 ? line.slice(tab + 1) : line;
      return { path: filePath, name: path.basename(filePath), sizeBytes: Number(line.slice(0, Math.max(tab, 0))) || 0 };
    });
  }

  async setNetworkMode(realmId: string, mode: NetworkMode, allowedDomains: string[] = []): Promise<void> {
    const record = this.record(realmId);
    if (mode === NetworkMode.Disabled) throw new RealmError('A Docker sandbox cannot run with networking disabled', 'SANDBOX_INVALID_CONFIG', { mode });
    if (mode === NetworkMode.Full) {
      throw new RealmError('Full network access is chosen when the sandbox is created (SANDBOX_ALLOW_NETWORK or networkMode at create)', 'SANDBOX_INVALID_CONFIG', { mode });
    }
    record.networkMode = mode;
    if (!allowedDomains.length) return;
    record.allowNetwork = [...new Set([...record.allowNetwork, ...allowedDomains])];
    if (record.created) {
      const result = await this.sbx([...this.scope(record), 'policy', 'allow', 'network', '--sandbox', record.sandboxName, allowedDomains.join(',')]);
      if (result.code !== 0) throw failed('Allowing network hosts', result, { realmId });
    }
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }> {
    const result = await this.sbx(['version'], { timeoutMs: 15_000 });
    return { status: result.code === 0 ? 'healthy' : 'unhealthy', uptimeSec: Math.round((Date.now() - this.startedAt) / 1000) };
  }
}
