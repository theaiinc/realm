import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FolderPtyAdapter } from './folder-pty.js';

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function waitForOutput(adapter: FolderPtyAdapter, sessionId: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const output = await adapter.output(sessionId, 0);
    if (output.data.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for output: ${text}`);
}

describe('FolderPtyAdapter', () => {
  it('spawns a shell that echoes input and supports incremental output', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'sh', cols: 100, rows: 40 });

    await adapter.input(session.sessionId, 'echo hello\n');
    await waitForOutput(adapter, session.sessionId, 'hello');

    const first = await adapter.output(session.sessionId, 0);
    expect(first.data).toContain('hello');
    expect(first.nextOffset).toBe(first.data.length);

    const second = await adapter.output(session.sessionId, first.nextOffset);
    expect(second).toEqual({ data: '', nextOffset: first.nextOffset, closed: false });
    await adapter.close(session.sessionId);
  });

  it('rejects path traversal and invalid session IDs', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });

    await expect(adapter.open({ cwd: '../outside' })).rejects.toThrow('cwd escapes session folder');
    await expect(adapter.output('../escape', 0)).rejects.toThrow('invalid sessionId');
  });

  it('kills a timed-out process and removes the session', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'sleep 10', timeoutSec: 0.05 });

    await new Promise((resolve) => setTimeout(resolve, 150));
    await expect(adapter.output(session.sessionId, 0)).rejects.toThrow('unknown PTY session');
    await expect(adapter.input(session.sessionId, 'ignored')).rejects.toThrow('unknown PTY session');
  });

  it('closes the process and leaves no active session', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'sleep 10' });

    await adapter.close(session.sessionId);
    await expect(adapter.output(session.sessionId, 0)).rejects.toThrow('unknown PTY session');
  });
});