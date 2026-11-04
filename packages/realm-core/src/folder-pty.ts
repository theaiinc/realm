import { mkdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as pty from 'node-pty';

import { assertExecAllowed, DEFAULT_PTY_TIMEOUT_SEC, DEFAULT_RESOURCE_LIMITS } from './hosted-sandbox.js';
import type { PtyAdapter, PtyOpenRequest, PtyOutput, PtySession } from './hosted-sandbox.js';

const SESSION_ID = /^[A-Za-z0-9_-]+$/;
const OUTPUT_LIMIT = 64 * 1024;
const TERM_GRACE_MS = 250;
const PROCESS_POLL_MS = 100;
const MEMORY_LIMIT_BYTES = DEFAULT_RESOURCE_LIMITS.memoryBytes;

export interface FolderPtyOptions {
  root: string;
  auditSink?: import('./hosted-sandbox.js').AuditSink;
  userId?: string;
  sandboxId?: string;
}

interface RunningSession {
  id: string;
  cwd: string;
  directory: string;
  process: pty.IPty;
  output: string;
  closed: boolean;
  terminating: boolean;
  exitCode?: number;
  timer?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  processTimer?: ReturnType<typeof setInterval>;
  auditSink?: import('./hosted-sandbox.js').AuditSink;
  userId: string;
  sandboxId: string;
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID.test(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${name}`);
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  if (isAbsolute(rel) || rel === '..') return false;
  const segments = rel.split(/[\\/]+/).filter(Boolean);
  return !segments.includes('..');
}

async function confinedCwd(root: string, sessionId: string, cwd?: string): Promise<{ directory: string; cwd: string }> {
  validateSessionId(sessionId);
  const directory = resolve(root, sessionId);
  await mkdir(directory, { recursive: true });

  let rootReal: string;
  try {
    rootReal = await realpath(directory);
  } catch {
    throw new Error('session folder is unavailable');
  }

  const requested = cwd ?? '.';
  const candidate = resolve(rootReal, requested);
  if (!isInside(rootReal, candidate)) throw new Error('cwd escapes session folder');

  let cwdReal: string;
  try {
    cwdReal = await realpath(candidate);
  } catch {
    throw new Error('cwd is unavailable');
  }
  if (!isInside(rootReal, cwdReal)) throw new Error('cwd escapes session folder');
  return { directory, cwd: cwdReal };
}

export class FolderPtyAdapter implements PtyAdapter {
  private readonly root: string;
  private readonly sessions = new Map<string, RunningSession>();
  private readonly closed = new Map<string, PtyOutput>();

  constructor(options: FolderPtyOptions) {
    this.root = resolve(options.root);
    this.auditSink = options.auditSink;
    this.userId = options.userId ?? 'local';
    this.sandboxId = options.sandboxId ?? 'folder-pty';
  }

  private readonly auditSink?: import('./hosted-sandbox.js').AuditSink;
  private readonly userId: string;
  private readonly sandboxId: string;

  async open(request: PtyOpenRequest = {}): Promise<PtySession> {
    if (this.sessions.size >= DEFAULT_RESOURCE_LIMITS.maxConcurrentTerminals) throw new Error('terminal concurrency limit exceeded');
    const timeoutSec = request.timeoutSec ?? DEFAULT_PTY_TIMEOUT_SEC;
    assertExecAllowed({ command: request.command ?? 'shell', timeoutSec }, { maxExecDurationSec: DEFAULT_PTY_TIMEOUT_SEC });
    if (request.cols !== undefined) validatePositiveInteger(request.cols, 'columns');
    if (request.rows !== undefined) validatePositiveInteger(request.rows, 'rows');
    const sessionId = randomUUID().replaceAll('-', '_');
    const { directory, cwd } = await confinedCwd(this.root, sessionId, request.cwd);
    const env = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: directory,
      LANG: 'C.UTF-8',
      TERM: 'xterm-256color',
    };
    const command = request.command;
    const resourceLimits = [
      `ulimit -u ${DEFAULT_RESOURCE_LIMITS.maxProcessesPerSession}`,
      `ulimit -v ${Math.floor(MEMORY_LIMIT_BYTES / 1024)}`,
    ].join('; ');
    const shellArguments = command === undefined
      ? `${resourceLimits}; exec /bin/bash --noprofile --norc`
      : `${resourceLimits}; exec /bin/bash --noprofile --norc -c ${JSON.stringify(command)}`;
    const child = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-c', shellArguments], {
      name: 'xterm-color',
      cols: request.cols ?? 80,
      rows: request.rows ?? 24,
      cwd,
      env,
    });
    const session: RunningSession = {
      id: sessionId,
      cwd,
      directory,
      process: child,
      output: '',
      closed: false,
      terminating: false,
      auditSink: this.auditSink,
      userId: this.userId,
      sandboxId: this.sandboxId,
    };
    child.onData((data) => {
      session.output = (session.output + data).slice(-OUTPUT_LIMIT);
    });
    session.processTimer = setInterval(() => {
      const tree = this.processTree(session.process.pid);
      if (tree.length > DEFAULT_RESOURCE_LIMITS.maxProcessesPerSession) this.terminate(session, 'process_limit');
    }, PROCESS_POLL_MS);
    void this.audit(session, 'command_start', true);
    child.onExit(({ exitCode }) => {
      session.closed = true;
      session.exitCode ??= exitCode;
      if (session.timer) clearTimeout(session.timer);
      if (session.killTimer) clearTimeout(session.killTimer);
      if (session.processTimer) clearInterval(session.processTimer);
      void this.audit(session, 'destroy', true, { exitCode });
      this.closed.set(session.id, {
        data: session.output,
        nextOffset: session.output.length,
        closed: true,
        exitCode,
      });
      this.sessions.delete(session.id);
      void rm(session.directory, { recursive: true, force: true });
    });
    session.timer = setTimeout(() => this.terminate(session), timeoutSec * 1000);
    this.sessions.set(sessionId, session);
    return { sessionId, cols: request.cols ?? 80, rows: request.rows ?? 24 };
  }

  async input(sessionId: string, data: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      validateSessionId(sessionId);
      if (this.closed.has(sessionId)) throw new Error(`PTY session is closed: ${sessionId}`);
      throw new Error(`unknown PTY session: ${sessionId}`);
    }
    if (session.closed) throw new Error(`PTY session is closed: ${sessionId}`);
    session.process.write(data);
  }

  async output(sessionId: string, offset: number): Promise<PtyOutput> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid output offset');
    validateSessionId(sessionId);
    const closed = this.closed.get(sessionId);
    if (closed !== undefined) {
      return { ...closed, data: closed.data.slice(offset), nextOffset: closed.nextOffset };
    }
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error(`unknown PTY session: ${sessionId}`);
    return {
      data: session.output.slice(offset),
      nextOffset: session.output.length,
      closed: session.closed,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    };
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    validatePositiveInteger(cols, 'columns');
    validatePositiveInteger(rows, 'rows');
    const session = this.get(sessionId);
    if (session.closed) throw new Error(`PTY session is closed: ${sessionId}`);
    session.process.resize(cols, rows);
  }

  async close(sessionId: string): Promise<void> {
    validateSessionId(sessionId);
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      // The PTY may have exited between the caller's operation and close().
      // Closed sessions remain queryable through the closed-result map, and
      // closing an already-exited session is intentionally idempotent.
      return;
    }
    if (!session.closed) this.terminate(session);
    await new Promise<void>((resolve) => {
      if (session.closed) {
        resolve();
        return;
      }
      const timer = setInterval(() => {
        if (session.closed) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
  }

  private get(sessionId: string): RunningSession {
    validateSessionId(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown PTY session: ${sessionId}`);
    return session;
  }

  private async audit(session: RunningSession, action: 'command_start' | 'timeout' | 'quota_reject' | 'destroy', success: boolean, detail?: Record<string, unknown>): Promise<void> {
    await session.auditSink?.append({
      id: randomUUID(), userId: session.userId, sandboxId: session.sandboxId,
      action, timestamp: new Date().toISOString(), success, detail,
    });
  }

  private terminate(session: RunningSession, reason = 'timeout'): void {
    if (session.terminating || session.closed) return;
    session.terminating = true;
    void this.audit(session, reason === 'timeout' ? 'timeout' : 'destroy', true, { reason });
    session.exitCode ??= 143;
    if (session.timer) clearTimeout(session.timer);
    const descendants = this.processTree(session.process.pid);
    for (const pid of descendants) {
      try { process.kill(pid, 'SIGTERM'); } catch { void 0; }
    }
    try { process.kill(-session.process.pid, 'SIGTERM'); } catch {
      try { session.process.kill(); } catch { void 0; }
    }
    session.killTimer = setTimeout(() => {
      if (!session.terminating) return;
      for (const pid of this.processTree(session.process.pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch { void 0; }
      }
      try { process.kill(-session.process.pid, 'SIGKILL'); } catch {
        try { session.process.kill(); } catch { void 0; }
      }
    }, TERM_GRACE_MS);
  }

  private processTree(rootPid: number): number[] {
    if (process.platform === 'win32') return [rootPid];
    try {
      const lines = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
      const children = new Map<number, number[]>();
      for (const line of lines.trim().split('\\n')) {
        const [pidText, parentText] = line.trim().split(/\\s+/);
        const pid = Number(pidText);
        const parent = Number(parentText);
        if (Number.isInteger(pid) && Number.isInteger(parent)) {
          const list = children.get(parent) ?? [];
          list.push(pid);
          children.set(parent, list);
        }
      }
      const result: number[] = [];
      const pending = [rootPid];
      while (pending.length > 0) {
        const pid = pending.pop()!;
        result.push(pid);
        pending.push(...(children.get(pid) ?? []));
      }
      return result.reverse();
    } catch {
      return [rootPid];
    }
  }
}