import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type {
  ActionResult,
  FileRef,
  RealmConfig,
  RealmEngine,
  RealmJobResult,
  RealmJobSpec,
  RealmSession,
} from '@theaiinc/realm-core';
import { EngineType, NetworkMode, RealmState } from '@theaiinc/realm-core';
import { Storage } from '@google-cloud/storage';
import { GoogleAuth } from 'google-auth-library';

type ObjectStore = {
    save(name: string, data: Buffer | NodeJS.ReadableStream): Promise<void>;
    load(name: string): Promise<Buffer>;
    list(prefix: string): Promise<string[]>;
    remove(prefix: string): Promise<void>;
  };

  type RunClient = {
    runJob(request: unknown): Promise<unknown>;
    getExecution(name: string): Promise<any>;
    cancelExecution(name: string): Promise<void>;
  };

  class GcsStore implements ObjectStore {
    constructor(private readonly bucket: any) {}
    async save(name: string, data: Buffer | NodeJS.ReadableStream) {
      const file = this.bucket.file(name);
      if (Buffer.isBuffer(data)) await file.save(data);
      else await new Promise<void>((resolve, reject) => {
        const stream = file.createWriteStream();
        data.pipe(stream);
        stream.once('finish', resolve);
        stream.once('error', reject);
      });
    }
    async load(name: string) {
      const [data] = await this.bucket.file(name).download();
      return data;
    }
    async list(prefix: string) {
      const [files] = await this.bucket.getFiles({ prefix });
      return files.map((file: any) => file.name);
    }
    async remove(prefix: string) {
      await this.bucket.deleteFiles({ prefix });
    }
  }

  export interface CloudRunEngineOptions {
    project?: string;
    region?: string;
    job?: string;
    bucket?: string;
    store?: ObjectStore;
    run?: RunClient;
  }

  export class CloudRunEngine implements RealmEngine {
    readonly type = EngineType.CloudRunJob;
    private readonly store: ObjectStore;
    private readonly run: RunClient;
    private readonly executions = new Map<string, string>();
    private readonly started = Date.now();

    constructor(options: CloudRunEngineOptions = {}) {
      const project = options.project ?? process.env.REALM_CLOUDRUN_PROJECT;
      const region = options.region ?? process.env.REALM_CLOUDRUN_REGION;
      const job = options.job ?? process.env.REALM_CLOUDRUN_JOB;
      const bucketName = options.bucket ?? process.env.REALM_CLOUDRUN_BUCKET;
      if (!project || !region || !job || !bucketName) {
        throw new Error('REALM_CLOUDRUN_PROJECT, REGION, JOB and BUCKET are required');
      }
      this.store = options.store ?? new GcsStore(new Storage({ projectId: project }).bucket(bucketName));
      this.run = options.run ?? this.createRunClient(project, region, job);
    }

    async create(_config: RealmConfig) { return randomUUID(); }
    async start(realmId: string): Promise<RealmSession> {
      return { id: `session-${realmId}`, realmId, state: RealmState.Running, startedAt: new Date().toISOString(), grantedCapabilities: [] };
    }
    async stop(_realmId: string) {}
    async pause(_realmId: string) {}
    async resume(realmId: string) { return this.start(realmId); }
    async destroy(realmId: string) { await this.store.remove(`realms/${realmId}/`); }
    async health() { return { status: 'healthy' as const, uptimeSec: Math.floor((Date.now() - this.started) / 1000) }; }
    async capture(_realmId: string) { return Buffer.from('unsupported'); }
    async click(_realmId: string, _x: number, _y: number): Promise<ActionResult> { return this.unsupported(); }
    async typeText(_realmId: string, _text: string): Promise<ActionResult> { return this.unsupported(); }
    async keyPress(_realmId: string, _key: string): Promise<ActionResult> { return this.unsupported(); }
    async scroll(_realmId: string, _x: number, _y: number): Promise<ActionResult> { return this.unsupported(); }
    async navigate(_realmId: string, _url: string): Promise<ActionResult> { return this.unsupported(); }
    async execute(_realmId: string, _command: string): Promise<ActionResult> { return this.unsupported(); }
    async importFile(realmId: string, source: string, dest: string): Promise<FileRef> {
      const data = await import('node:fs/promises').then(fs => fs.readFile(source));
      await this.putFile(realmId, dest, data);
      return { path: dest, name: dest.split('/').pop() ?? dest, sizeBytes: data.length };
    }
    async exportFile(realmId: string, source: string, dest: string): Promise<FileRef> {
      const data = await this.getFile(realmId, source);
      await import('node:fs/promises').then(fs => fs.writeFile(dest, data));
      return { path: source, name: source.split('/').pop() ?? source, sizeBytes: data.length };
    }
    async listFiles(realmId: string, path: string): Promise<FileRef[]> {
      const names = await this.store.list(`realms/${realmId}/files/${path.replace(/^\/+/, '')}`);
      return Promise.all(names.map(async name => {
        const data = await this.store.load(name);
        const value = name.split('/').pop() ?? name;
        return { path: name.replace(`realms/${realmId}/files/`, ''), name: value, sizeBytes: data.length };
      }));
    }
    async setNetworkMode(_realmId: string, _mode: NetworkMode) {}
    async putFile(realmId: string, path: string, data: Buffer | NodeJS.ReadableStream) {
      const safe = this.safePath(path);
      await this.store.save(`realms/${realmId}/files/${safe}`, data);
      const stored = await this.store.load(`realms/${realmId}/files/${safe}`);
      return { path: safe, size: stored.length };
    }
    async getFile(realmId: string, path: string) {
      return await this.store.load(`realms/${realmId}/files/${this.safePath(path)}`);
    }
    async startJob(realmId: string, spec: RealmJobSpec) {
      const jobId = randomUUID();
      const execution = await this.run.runJob({
        realmId,
        jobId,
        command: Buffer.from(spec.command).toString('base64'),
        cwd: spec.cwd ?? '/work',
        timeoutSeconds: Math.min(spec.timeoutSec ?? 21600, 21600),
        env: spec.env ?? {}
      });
      const name = (execution as any).name ?? String(execution);
      await this.store.save(`realms/${realmId}/jobs/${jobId}/execution`, Buffer.from(name));
      this.executions.set(`${realmId}/${jobId}`, name);
      return { jobId };
    }
    async getJob(realmId: string, jobId: string, options: { logOffset?: number } = {}): Promise<RealmJobResult> {
      const offset = Math.max(0, options.logOffset ?? 0);
      const prefix = `realms/${realmId}/jobs/${jobId}/log/`;
      const logs = (await this.store.list(prefix)).sort((a, b) => a.localeCompare(b));
      const all = Buffer.concat(await Promise.all(logs.map(name => this.store.load(name))));
      let state: RealmJobResult['state'] = 'queued';
      let result: any;
      try {
        result = JSON.parse((await this.store.load(`realms/${realmId}/jobs/${jobId}/result.json`)).toString());
        state = result.timed_out ? 'timed_out' : result.cancelled ? 'cancelled' : result.exit_code === 0 ? 'succeeded' : 'failed';
      } catch {
        try {
          const executionName = (await this.store.load(`realms/${realmId}/jobs/${jobId}/execution`)).toString();
          const execution = await this.run.getExecution(executionName);
          const condition = execution?.status?.conditions?.find((entry: any) => entry.type === 'Completed' || entry.type === 'Succeeded');
          const ended = Boolean(execution?.completionTime || execution?.status?.completionTime || condition?.status === 'False');
          state = ended ? 'failed' : execution?.runningCount || execution?.status?.runningCount ? 'running' : 'queued';
          if (ended && condition?.message) all.write(`[runner] ${condition.message}\n`);
        } catch {}
      }
      const nextOffset = all.length;
      return { state, exitCode: result?.exit_code, log: all.subarray(Math.min(offset, all.length)).toString(), nextOffset, runtimeSec: result?.runtime_seconds, filesChanged: result?.changed_files };
    }
    async cancelJob(realmId: string, jobId: string) {
      const name = this.executions.get(`${realmId}/${jobId}`) ?? (await this.store.load(`realms/${realmId}/jobs/${jobId}/execution`)).toString();
      await this.run.cancelExecution(name);
    }
    private safePath(path: string) {
      const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!normalized || normalized.split('/').some(part => part === '..' || part === '.')) throw new Error('invalid relative path');
      return normalized;
    }
    private unsupported(): ActionResult { return { success: false, error: 'NOT_SUPPORTED', durationMs: 0, timestamp: new Date().toISOString() }; }
    private createRunClient(project: string, region: string, job: string): RunClient {
      const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
      return {
        async runJob(request) {
          const client: any = await auth.getClient();
          const url = `https://${region}-run.googleapis.com/apis/run.googleapis.com/v1/projects/${project}/locations/${region}/jobs/${job}:run`;
          const response = await client.request({ url, method: 'POST', data: request });
          return response.data;
        },
        async getExecution(name) { const client: any = await auth.getClient(); return (await client.request({ url: `https://run.googleapis.com/v2/${name}` })).data; },
        async cancelExecution(name) { const client: any = await auth.getClient(); await client.request({ url: `https://run.googleapis.com/v2/${name}:cancel`, method: 'POST' }); }
      };
    }
  }

  export { GcsStore };