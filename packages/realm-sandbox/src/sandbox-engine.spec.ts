import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EngineType, NetworkMode, RealmError, RealmNotFoundError } from '@theaiinc/realm-core';
import { DockerSandboxEngine, parseKitArgs, sandboxNameFor, type SbxResult } from './sandbox-engine.js';

/** A fake sbx: records calls, answers from a script. */
function fakeSbx(answer: (args: string[]) => Partial<SbxResult> = () => ({})) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return { code: 0, stdout: '', stderr: '', ...answer(args) };
  };
  return { calls, run };
}

const KIT = {
  SANDBOX_KIT: './kits/simasis-device',
  SANDBOX_KIT_ARGS: 'repos=https://github.com/acme/app; simasis_url=https://app.example.com',
  SANDBOX_CPUS: '1',
  SANDBOX_MEMORY: '2g',
  SANDBOX_TTL: '45m',
  SANDBOX_ALLOW_NETWORK: 'registry.npmjs.org',
  APP_MODE: 'test',
};

describe('DockerSandboxEngine', () => {
  it('is the docker-sandbox engine and needs a kit', async () => {
    const engine = new DockerSandboxEngine(fakeSbx().run);
    expect(engine.type).toBe(EngineType.DockerSandbox);
    await expect(engine.create({ name: 'x', engine: EngineType.DockerSandbox })).rejects.toThrow('SANDBOX_KIT is required');
  });

  it('creates a cloud sandbox on first start: kit, size, time limit, kit args, env and extra hosts', async () => {
    const sbx = fakeSbx();
    const engine = new DockerSandboxEngine(sbx.run);
    const id = await engine.create({ name: 'Simasis Device', engine: EngineType.DockerSandbox, environment: KIT });
    const session = await engine.start(id);
    const name = sandboxNameFor('Simasis Device', id);
    expect(name).toMatch(/^simasis-device-[0-9a-f]{8}$/);
    expect(sbx.calls[0]).toEqual([
      '--cloud', 'run', './kits/simasis-device', '--detached', '--name', name, '--new',
      '--cpus', '1', '--memory', '2g', '--ttl', '45m', '--on-timeout', 'stop',
      '--kit-arg', 'repos=https://github.com/acme/app', '--kit-arg', 'simasis_url=https://app.example.com',
      '--env', 'APP_MODE=test',
      '--allow-network', 'registry.npmjs.org',
    ]);
    expect(session.metadata).toMatchObject({ sandbox: name, cloud: 'true' });
  });

  it('restarts the same sandbox after a stop (pause keeps state), and removes it on destroy', async () => {
    const sbx = fakeSbx();
    const engine = new DockerSandboxEngine(sbx.run);
    const id = await engine.create({ name: 'r', engine: EngineType.DockerSandbox, environment: { SANDBOX_KIT: 'shell' } });
    await engine.start(id);
    await engine.pause(id);
    await engine.resume(id);
    await engine.destroy(id);
    const name = sandboxNameFor('r', id);
    expect(sbx.calls.slice(1)).toEqual([
      ['--cloud', 'stop', name],
      ['--cloud', 'run', '--name', name, '--detached'],
      ['--cloud', 'rm', '--force', name],
    ]);
    await expect(engine.start(id)).rejects.toBeInstanceOf(RealmNotFoundError);
  });

  it('runs commands with exec and reports exit code and output', async () => {
    const sbx = fakeSbx((args) => (args.includes('false') ? { code: 3, stderr: 'boom' } : { stdout: 'hello\n' }));
    const engine = new DockerSandboxEngine(sbx.run);
    const id = await engine.create({ name: 'r', engine: EngineType.DockerSandbox, environment: { SANDBOX_KIT: 'shell', SANDBOX_CLOUD: 'false' } });
    await expect(engine.execute(id, 'echo', ['hello'])).rejects.toThrow('Start the realm');
    await engine.start(id);
    const ok = await engine.execute(id, 'echo', ['hello']);
    expect(ok).toMatchObject({ success: true, data: { stdout: 'hello\n', exitCode: 0 } });
    expect(sbx.calls.at(-1)).toEqual(['exec', sandboxNameFor('r', id), 'echo', 'hello']); // local: no --cloud
    const bad = await engine.execute(id, 'false');
    expect(bad).toMatchObject({ success: false, error: 'boom', data: { exitCode: 3 } });
  });

  it('copies files in and out with cp, and lists a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'realm-sandbox-'));
    const local = join(dir, 'in.txt');
    writeFileSync(local, 'abc');
    const sbx = fakeSbx((args) => (args[0] === '--cloud' && args[1] === 'cp' && String(args[3]).startsWith(dir) ? (writeFileSync(String(args[3]), 'xyz12'), {}) : args.includes('find') ? { stdout: '12\t/w/a.txt\n4096\t/w/src\n' } : {}));
    const engine = new DockerSandboxEngine(sbx.run);
    const id = await engine.create({ name: 'r', engine: EngineType.DockerSandbox, environment: { SANDBOX_KIT: 'shell' } });
    await engine.start(id);
    const name = sandboxNameFor('r', id);
    expect(await engine.importFile(id, local, '/w/in.txt')).toEqual({ path: '/w/in.txt', name: 'in.txt', sizeBytes: 3 });
    expect(sbx.calls.at(-1)).toEqual(['--cloud', 'cp', local, `${name}:/w/in.txt`]);
    const out = join(dir, 'out.txt');
    expect(await engine.exportFile(id, '/w/out.txt', out)).toMatchObject({ name: 'out.txt', sizeBytes: 5 });
    expect(await engine.listFiles(id, '/w')).toEqual([
      { path: '/w/a.txt', name: 'a.txt', sizeBytes: 12 },
      { path: '/w/src', name: 'src', sizeBytes: 4096 },
    ]);
  });

  it('refuses display operations and disabled networking instead of faking them', async () => {
    const engine = new DockerSandboxEngine(fakeSbx().run);
    await expect(engine.capture()).rejects.toThrow('headless');
    await expect(engine.click()).rejects.toBeInstanceOf(RealmError);
    await expect(engine.create({ name: 'r', engine: EngineType.DockerSandbox, networkMode: NetworkMode.Disabled, environment: { SANDBOX_KIT: 'shell' } }))
      .rejects.toThrow('networking disabled');
  });

  it('allows extra hosts on a running sandbox through its network policy', async () => {
    const sbx = fakeSbx();
    const engine = new DockerSandboxEngine(sbx.run);
    const id = await engine.create({ name: 'r', engine: EngineType.DockerSandbox, environment: { SANDBOX_KIT: 'shell' } });
    await engine.start(id);
    await engine.setNetworkMode(id, NetworkMode.Restricted, ['pypi.org', 'files.pythonhosted.org']);
    expect(sbx.calls.at(-1)).toEqual(['--cloud', 'policy', 'allow', 'network', '--sandbox', sandboxNameFor('r', id), 'pypi.org,files.pythonhosted.org']);
  });

  it('turns a failed sbx call into a RealmError with its message', async () => {
    const engine = new DockerSandboxEngine(fakeSbx(() => ({ code: 1, stderr: 'error: not signed in to Docker\n  try: sbx login' })).run);
    const id = await engine.create({ name: 'r', engine: EngineType.DockerSandbox, environment: { SANDBOX_KIT: 'shell' } });
    await expect(engine.start(id)).rejects.toThrow('not signed in to Docker');
    expect((await engine.health()).status).toBe('unhealthy');
  });

  it('parses kit args and rejects malformed ones', () => {
    expect(parseKitArgs('a=1;b=x=y\nc=')).toEqual(['a=1', 'b=x=y', 'c=']);
    expect(() => parseKitArgs('novalue')).toThrow('name=value');
  });
});

describe('credentials from Arcana', () => {
  it('pipes each SANDBOX_SECRETS reference from Arcana into sbx before the sandbox is created', async () => {
    const order: string[] = [];
    const sbx = fakeSbx((args) => { order.push(`sbx ${args[1]}`); return {}; });
    const arcanaCalls: string[][] = [];
    const arcana = async (args: string[]) => { arcanaCalls.push(args); order.push('arcana'); return { code: 0, stdout: 'Saved secret', stderr: '' }; };
    const engine = new DockerSandboxEngine(sbx.run, arcana);
    const id = await engine.create({
      name: 'dev', engine: EngineType.DockerSandbox,
      environment: { SANDBOX_KIT: 'claude', SANDBOX_SECRETS: 'anthropic=arcana://anthropic/api-key, github=arcana://github/me/token' },
    });
    await engine.start(id);
    expect(arcanaCalls).toEqual([
      ['run', '--secret', 'arcana://anthropic/api-key', '--stdin-secret', '--', 'sbx', '--cloud', 'secret', 'set', 'anthropic', '--force'],
      ['run', '--secret', 'arcana://github/me/token', '--stdin-secret', '--', 'sbx', '--cloud', 'secret', 'set', 'github', '--force'],
    ]);
    expect(order).toEqual(['arcana', 'arcana', 'sbx run']);
    // Not passed into the sandbox as an env var, and not pushed again on restart.
    expect((sbx.calls[0] ?? []).join(' ')).not.toContain('arcana://');
    await engine.stop(id);
    await engine.start(id);
    expect(arcanaCalls).toHaveLength(2);
  });

  it('accepts only Arcana references, never a value', async () => {
    const engine = new DockerSandboxEngine(fakeSbx().run, async () => ({ code: 0, stdout: '', stderr: '' }));
    await expect(engine.create({ name: 'x', engine: EngineType.DockerSandbox, environment: { SANDBOX_KIT: 'claude', SANDBOX_SECRETS: 'anthropic=sk-ant-api03-abc' } }))
      .rejects.toThrow('values are never accepted');
  });

  it('a denied or timed-out phone approval stops the start with Arcana\'s reason', async () => {
    const engine = new DockerSandboxEngine(fakeSbx().run, async () => ({ code: 1, stdout: '', stderr: 'arcana: denied on your phone' }));
    const id = await engine.create({ name: 'x', engine: EngineType.DockerSandbox, environment: { SANDBOX_KIT: 'claude', SANDBOX_SECRETS: 'anthropic=arcana://anthropic/api-key' } });
    await expect(engine.start(id)).rejects.toThrow('denied on your phone');
  });
});
