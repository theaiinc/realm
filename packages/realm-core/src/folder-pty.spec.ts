import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FolderPtyAdapter } from './folder-pty.js';
import { DEFAULT_PTY_TIMEOUT_SEC } from './hosted-sandbox.js';

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

  it('kills a timed-out process and preserves the closed session result', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'printf timed-out; sleep 10', timeoutSec: 0.05 });

    await new Promise((resolve) => setTimeout(resolve, 350));
    const output = await adapter.output(session.sessionId, 0);
    expect(output.closed).toBe(true);
    expect(output.data).toContain('timed-out');
    expect(output.exitCode).toBeDefined();
    await expect(adapter.input(session.sessionId, 'ignored')).rejects.toThrow('PTY session is closed');
  });

  it('closes the process and preserves the closed result', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'printf closed; sleep 10' });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await adapter.close(session.sessionId);
    const output = await adapter.output(session.sessionId, 0);
    expect(output.closed).toBe(true);
    expect(output.data).toContain('closed');
    expect(output.exitCode).toBeDefined();
  });

  it('does not expose host environment variables', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const hostVariable = 'REALM_HOST_SECRET_TEST';
    process.env[hostVariable] = 'should-not-leak';
    try {
      const adapter = new FolderPtyAdapter({ root: folder });
      const session = await adapter.open({ command: `printf %s "${hostVariable}"` });
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const output = await adapter.output(session.sessionId, 0);
        if (output.closed) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const output = await adapter.output(session.sessionId, 0);
      expect(output.closed).toBe(true);
      expect(output.data).not.toContain('should-not-leak');
    } finally {
      delete process.env[hostVariable];
    }
  });

  it('applies the two-hour default timeout when timeoutSec is omitted', async () => {
    expect(DEFAULT_PTY_TIMEOUT_SEC).toBe(2 * 60 * 60);

    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'sleep 1' });

    const output = await adapter.output(session.sessionId, 0);
    expect(output.closed).toBe(false);
    await adapter.close(session.sessionId);
  });

  it('refuses a timeout beyond the two-hour cap', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    await expect(adapter.open({ timeoutSec: 3 * 60 * 60 })).rejects.toThrow();
    await expect(adapter.open({ timeoutSec: DEFAULT_PTY_TIMEOUT_SEC + 1 })).rejects.toThrow();
  });

  it('rejects invalid timeout, resize, and output offset values', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });

    await expect(adapter.open({ timeoutSec: 0 })).rejects.toThrow();
    await expect(adapter.open({ timeoutSec: -1 })).rejects.toThrow();
    const session = await adapter.open();
    await expect(adapter.resize(session.sessionId, 0, 24)).rejects.toThrow();
    await expect(adapter.resize(session.sessionId, 80, -1)).rejects.toThrow();
    await expect(adapter.output(session.sessionId, -1)).rejects.toThrow();
    await adapter.close(session.sessionId);
  });

  it('bounds output and removes the session folder after close', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'yes x' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const output = await adapter.output(session.sessionId, 0);
    expect(output.data.length).toBeLessThanOrEqual(64 * 1024);
    await adapter.close(session.sessionId);
    await expect(adapter.output(session.sessionId, output.nextOffset)).resolves.toMatchObject({ closed: true });
  });

  it('rejects a symlinked cwd outside the session folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    const outside = await mkdtemp(join(tmpdir(), 'realm-pty-outside-'));
    temporaryFolders.push(folder, outside);
    const link = join(folder, 'link');
    const { symlink } = await import('node:fs/promises');
    await symlink(outside, link);
    const adapter = new FolderPtyAdapter({ root: folder });
    await expect(adapter.open({ cwd: link })).rejects.toThrow('cwd escapes session folder');
  });

  it('applies a default PTY timeout when none is provided', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'sleep 9999' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const output = await adapter.output(session.sessionId, 0);
    expect(output).toBeDefined();
    await adapter.close(session.sessionId);
  });

  it('refuses a second concurrent open for the same user', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const first = await adapter.open({ command: 'echo first', timeoutSec: 5 });
    await expect(adapter.open({ command: 'echo second', timeoutSec: 5 })).rejects.toThrow(/terminal concurrency limit exceeded/i);
    await adapter.close(first.sessionId);
    const second = await adapter.open({ command: 'echo second', timeoutSec: 5 });
    expect(second.sessionId).toBeDefined();
    await adapter.close(second.sessionId);
  });

  it('applies ulimit and memory limit in the spawned command', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'ulimit -u', timeoutSec: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const output = await adapter.output(session.sessionId, 0);
    expect(output.closed).toBe(true);
    expect(Number(output.data.trim())).toBeLessThanOrEqual(34);
    await adapter.close(session.sessionId);
  });

  it('preserves natural-exit results and removes the session folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    const session = await adapter.open({ command: 'exit 0' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const output = await adapter.output(session.sessionId, 0);
    expect(output.closed).toBe(true);
    expect(output.exitCode).toBe(0);
    await expect(adapter.input(session.sessionId, 'x')).rejects.toThrow(/closed/i);
  });

  it('kills setsid grandchild processes on close', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder);
    const adapter = new FolderPtyAdapter({ root: folder });
    // Start a shell that creates a setsid grandchild — a process re-parented to init.
    // "set -m" enables job control so the subshell gets its own process group.
    // "set -m; sleep 60 &" stays in the shell's session but is a child of the shell,
    // not of node-pty's direct child. "setsid sleep 60 &" starts a new session.
    // We kill both to show that process-group and descendant discovery work.
    const session = await adapter.open({
      command: 'set -m; sleep 30 & setsid sleep 30 & printf started',
      timeoutSec: 15,
    });
    await waitForOutput(adapter, session.sessionId, 'started');
    // Close kills the session — both children should be terminated.
    await adapter.close(session.sessionId);

    // Verify no background survivors: use a polling loop and defensive parsing.
    const folder2 = await mkdtemp(join(tmpdir(), 'realm-pty-'));
    temporaryFolders.push(folder2);
    const checker = new FolderPtyAdapter({ root: folder2 });
    const checkSesh = await checker.open({ command: "ps aux | awk '/[s]leep 30/ {print $2}' | wc -l | xargs echo", timeoutSec: 8 });
    let count: number | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const o = await checker.output(checkSesh.sessionId, 0);
      if (o.closed) {
        count = parseInt(o.data.trim(), 10);
        break;
      }
    }
    if (count === null) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const o = await checker.output(checkSesh.sessionId, 0);
      if (o.closed) count = parseInt(o.data.trim(), 10);
    }
    expect(count).toBe(0);
    await checker.close(checkSesh.sessionId);
  });
});