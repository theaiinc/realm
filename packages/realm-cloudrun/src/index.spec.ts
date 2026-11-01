import { describe, expect, it } from 'vitest';
import { CloudRunEngine } from './index.js';

class MemoryStore {
  values = new Map<string, Buffer>();
  async save(name: string, data: Buffer | NodeJS.ReadableStream) {
    if (Buffer.isBuffer(data)) this.values.set(name, data);
    else {
      const chunks: Buffer[] = [];
      for await (const chunk of data as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      this.values.set(name, Buffer.concat(chunks));
    }
  }
  async load(name: string) {
    const value = this.values.get(name);
    if (!value) throw new Error('missing');
    return value;
  }
  async list(prefix: string) {
    return [...this.values.keys()].filter(name => name.startsWith(prefix));
  }
  async remove(prefix: string) {
    for (const name of [...this.values.keys()]) if (name.startsWith(prefix)) this.values.delete(name);
  }
}

describe('CloudRunEngine', () => {
  it('sends tenant-scoped environment through containerOverrides', async () => {
    const store = new MemoryStore();
    let request: any;
    const engine = new CloudRunEngine({
      project: 'project',
      region: 'region',
      job: 'runner',
      bucket: 'bucket',
      store,
      run: {
        async runJob(value) { request = value; return { name: 'execution-1' }; },
        async getExecution() { return {}; },
        async cancelExecution() {},
      },
    });
    const result = await engine.startJob('realm-a', { command: 'printf test', timeoutSec: 30 });
    expect(result.jobId).toBeTruthy();
    expect(request.overrides.containerOverrides[0].env).toEqual(expect.arrayContaining([
      { name: 'REALM_ID', value: 'realm-a' },
      { name: 'REALM_PREFIX', value: 'realms/realm-a/' },
      { name: 'JOB_TIMEOUT_SECONDS', value: '30' },
    ]));
    expect(request.overrides.containerOverrides[0].env).not.toEqual(expect.arrayContaining([
      { name: 'REALM_ID', value: 'bucket' },
    ]));
  });

  it('rejects a second concurrent job and enforces the daily quota', async () => {
    const store = new MemoryStore();
    const engine = new CloudRunEngine({
      project: 'project',
      region: 'region',
      job: 'runner',
      bucket: 'bucket',
      store,
      run: {
        async runJob() { return { name: 'execution-1' }; },
        async getExecution() { return {}; },
        async cancelExecution() {},
      },
    });
    await engine.startJob('realm-a', { command: 'true', timeoutSec: 21600 });
    await expect(engine.startJob('realm-a', { command: 'true', timeoutSec: 1 })).rejects.toThrow('realm already has an active job');
  });
});