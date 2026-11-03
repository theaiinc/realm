import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FolderPtyAdapter } from './folder-pty.js';

const temporaryFolders: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe('FolderPtyAdapter', () => {
  it('persists PTY output in a folder and reads incrementally', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'sh', cols: 100, rows: 40 });

    await adapter.input(session.sessionId, 'echo hello\n');

    const first = await adapter.output(session.sessionId, 0);
    expect(first.data).toContain('$ sh\n');
    expect(first.data).toContain('echo hello\n');
    expect(first.nextOffset).toBe(first.data.length);

    const second = await adapter.output(session.sessionId, first.nextOffset);
    expect(second).toEqual({ data: '', nextOffset: first.nextOffset, closed: false });
  });

  it('tracks resize and close state in the folder-backed session', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open();

    await adapter.resize(session.sessionId, 120, 50);
    await adapter.close(session.sessionId);

    const output = await adapter.output(session.sessionId, 0);
    expect(output.closed).toBe(true);
    expect(output.exitCode).toBe(0);
    await expect(adapter.input(session.sessionId, 'ignored')).rejects.toThrow('PTY session is closed');
  });
});