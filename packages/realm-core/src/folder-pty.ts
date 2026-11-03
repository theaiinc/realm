import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { PtyAdapter, PtyOpenRequest, PtyOutput, PtySession } from './hosted-sandbox.js';

interface StoredSession {
  sessionId: string;
  cols: number;
  rows: number;
  output: string;
  closed: boolean;
  exitCode?: number;
}

export interface FolderPtyOptions {
  root: string;
}

export class FolderPtyAdapter implements PtyAdapter {
  private readonly root: string;

  constructor(options: FolderPtyOptions) {
    this.root = options.root;
  }

  private async sessionPath(sessionId: string): Promise<string> {
    await mkdir(this.root, { recursive: true });
    return join(this.root, `${sessionId}.json`);
  }

  private async load(sessionId: string): Promise<StoredSession> {
    const path = await this.sessionPath(sessionId);
    return JSON.parse(await readFile(path, 'utf8')) as StoredSession;
  }

  private async save(session: StoredSession): Promise<void> {
    await writeFile(await this.sessionPath(session.sessionId), JSON.stringify(session), 'utf8');
  }

  async open(request: PtyOpenRequest = {}): Promise<PtySession> {
    const session: StoredSession = {
      sessionId: randomUUID(),
      cols: request.cols ?? 80,
      rows: request.rows ?? 24,
      output: request.command ? `$ ${request.command}\n` : '',
      closed: false,
    };
    await this.save(session);
    return { sessionId: session.sessionId, cols: session.cols, rows: session.rows };
  }

  async input(sessionId: string, data: string): Promise<void> {
    const session = await this.load(sessionId);
    if (session.closed) throw new Error(`PTY session is closed: ${sessionId}`);
    session.output += data;
    await this.save(session);
  }

  async output(sessionId: string, offset: number): Promise<PtyOutput> {
    const session = await this.load(sessionId);
    return {
      data: session.output.slice(offset),
      nextOffset: session.output.length,
      closed: session.closed,
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
    };
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = await this.load(sessionId);
    if (session.closed) throw new Error(`PTY session is closed: ${sessionId}`);
    session.cols = cols;
    session.rows = rows;
    await this.save(session);
  }

  async close(sessionId: string): Promise<void> {
    const session = await this.load(sessionId);
    session.closed = true;
    session.exitCode ??= 0;
    await this.save(session);
  }
}