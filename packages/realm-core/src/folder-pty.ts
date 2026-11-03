import { mkdir } from 'node:fs/promises';
import { platform } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';

import { assertExecAllowed, DEFAULT_RESOURCE_LIMITS } from './hosted-sandbox.js';
import type { PtyAdapter, PtyOpenRequest, PtyOutput, PtySession } from './hosted-sandbox.js';

const SESSION_ID = /^[A-Za-z0-9_-]+$/;

export interface FolderPtyOptions {
  root: string;
}

interface RunningSession {
  id: string;
  cwd: string;
  process: pty.IPty;
  output: string;
  closed: boolean;
  exitCode?: number;
  timer?: ReturnType<typeof setTimeout>;
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID.test(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
}

async function confinedCwd(root: string, sessionId: string, cwd?: string): Promise<string> {
  validateSessionId(sessionId);
  const sessionDir = resolve(root, sessionId);
  await mkdir(sessionDir, { recursive: true });
  const candidate = resolve(sessionDir, cwd ?? '.');
  const rel = relative(sessionDir, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('cwd escapes session folder');
  return candidate;
}

export class FolderPtyAdapter implements PtyAdapter {
  private readonly root: string;
  private readonly sessions = new Map<string, RunningSession>();

  constructor(options: FolderPtyOptions) {
    this.root = resolve(options.root);
  }

  async open(request: PtyOpenRequest = {}): Promise<PtySession> {
    const sessionId = randomUUID().replaceAll('-', '_');
    const cwd = await confinedCwd(this.root, sessionId, request.cwd);
    assertExecAllowed({ command: request.command ?? 'shell', timeoutSec: request.timeoutSec }, DEFAULT_RESOURCE_LIMITS);
    const shell = platform() === 'win32' ? 'cmd.exe' : (process.env.SHELL ?? '/bin/sh');
    const command = request.command;
    const child = command === undefined
      ? pty.spawn(shell, [], {
          name: 'xterm-color',
          cols: request.cols ?? 80,
          rows: request.rows ?? 24,
          cwd,
          env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
        })
      : pty.spawn(shell, ['-lc', command], {
          name: 'xterm-color',
          cols: request.cols ?? 80,
          rows: request.rows ?? 24,
          cwd,
          env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
        });
    const session: RunningSession = {
      id: sessionId,
      cwd,
      process: child,
      output: '',
      closed: false,
    };
    child.onData((data) => { session.output += data; });
    child.onExit(({ exitCode }) => {
      session.closed = true;
      session.exitCode = exitCode;
      if (session.timer) clearTimeout(session.timer);
    });
    if (request.timeoutSec !== undefined) {
      session.timer = setTimeout(() => this.terminate(session), request.timeoutSec * 1000);
    }
    this.sessions.set(sessionId, session);
    return { sessionId, cols: request.cols ?? 80, rows: request.rows ?? 24 };
  }

  async input(sessionId: string, data: string): Promise<void> {
    const session = this.get(sessionId);
    if (session.closed) throw new Error(`PTY session is closed: ${sessionId}`);
    session.process.write(data);
  }

  async output(sessionId: string, offset: number): Promise<PtyOutput> {
    const session = this.get(sessionId);
    return {
      data: session.output.slice(offset),
      nextOffset: session.output.length,
      closed: session.closed,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    };
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.get(sessionId);
    if (session.closed) throw new Error(`PTY session is closed: ${sessionId}`);
    session.process.resize(cols, rows);
  }

  async close(sessionId: string): Promise<void> {
    const session = this.get(sessionId);
    if (!session.closed) this.terminate(session);
    this.sessions.delete(sessionId);
  }

  private get(sessionId: string): RunningSession {
    validateSessionId(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown PTY session: ${sessionId}`);
    return session;
  }

  private terminate(session: RunningSession): void {
    if (session.timer) clearTimeout(session.timer);
    if (!session.closed) {
      try {
        process.kill(-session.process.pid, 'SIGKILL');
      } catch {
        session.process.kill();
      }
    }
    session.closed = true;
    this.sessions.delete(session.id);
  }
}