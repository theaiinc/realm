import Docker from 'dockerode';
import type {
  RealmConfig,
  RealmSession,
  ActionResult,
  FileRef,
} from '@theaiinc/realm-core';
import { RealmState, EngineType, NetworkMode } from '@theaiinc/realm-core';
import type { RealmEngine } from '@theaiinc/realm-core';
import { UbuntuManager } from './ubuntu-manager.js';
import { UbuntuDisplay } from './ubuntu-display.js';
import { UbuntuFilesystem } from './ubuntu-filesystem.js';
import type { UbuntuOptions, YggdrasilConfig } from './ubuntu-types.js';

/**
 * UbuntuEngine — RealmEngine implementation backed by Ubuntu Desktop Docker containers.
 *
 * Each realm runs a full XFCE desktop in Docker with embedded Yggdrasil Ratatoskr.
 * Pass YGGDRASIL_URL in config.environment to enable the Ratatoskr daemon.
 */
export class UbuntuEngine implements RealmEngine {
  readonly type = EngineType.VM;

  private readonly docker: Docker;
  private readonly manager: UbuntuManager;
  private readonly display: UbuntuDisplay;
  private readonly filesystem: UbuntuFilesystem;

  private readonly realmOptions = new Map<string, UbuntuOptions>();

  constructor(options?: { socketPath?: string }) {
    this.docker = new Docker(options?.socketPath ? { socketPath: options.socketPath } : undefined);
    this.manager = new UbuntuManager(this.docker);
    this.display = new UbuntuDisplay(this.docker);
    this.filesystem = new UbuntuFilesystem(this.docker);
  }

  async create(config: RealmConfig): Promise<string> {
    const ubuntuOpts: UbuntuOptions & { yggdrasil?: YggdrasilConfig } = {
      resolution: config.environment?.['RESOLUTION'] ?? '1920x1080',
      vncPort: config.environment?.['VNC_PORT'] ? parseInt(config.environment['VNC_PORT'], 10) : 5901,
      memoryMb: config.storageLimitMb ?? 2048,
    };

    // Build Yggdrasil config from environment variables
    if (config.environment?.['YGGDRASIL_URL']) {
      ubuntuOpts.yggdrasil = {
        url: config.environment['YGGDRASIL_URL'],
        apiKey: config.environment['API_KEY'],
        runnerName: config.environment['RUNNER_NAME'] ?? `realm-ubuntu-${config.name}`,
        capabilities: config.environment['CAPABILITIES']?.split(',').map((s) => s.trim()) ?? ['agent', 'code'],
        heartbeatInterval: config.environment['HEARTBEAT_INTERVAL'] ? parseInt(config.environment['HEARTBEAT_INTERVAL'], 10) : undefined,
        leaseTtl: config.environment['LEASE_TTL'] ? parseInt(config.environment['LEASE_TTL'], 10) : undefined,
        taskPollInterval: config.environment['TASK_POLL_INTERVAL'] ? parseInt(config.environment['TASK_POLL_INTERVAL'], 10) : undefined,
        llmModel: config.environment['LLM_MODEL'],
        llmBaseUrl: config.environment['LLM_BASE_URL'],
        llmApiKey: config.environment['LLM_API_KEY'],
        agentMaxToolIterations: config.environment['AGENT_MAX_TOOL_ITERATIONS'] ? parseInt(config.environment['AGENT_MAX_TOOL_ITERATIONS'], 10) : undefined,
      };
    }

    const container = await this.manager.createContainer(config.name, ubuntuOpts);
    this.realmOptions.set(container.id, ubuntuOpts);
    return container.id;
  }

  async start(realmId: string): Promise<RealmSession> {
    const container = this.docker.getContainer(realmId);
    await container.start();
    const info = await container.inspect();

    return {
      id: `session-ubuntu-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: info.State.StartedAt ?? new Date().toISOString(),
    };
  }

  async stop(realmId: string): Promise<void> {
    await this.manager.stopContainer(realmId);
  }

  async pause(realmId: string): Promise<void> {
    await this.manager.pauseContainer(realmId);
  }

  async resume(realmId: string): Promise<RealmSession> {
    await this.manager.resumeContainer(realmId);
    return {
      id: `session-ubuntu-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: new Date().toISOString(),
    };
  }

  async destroy(realmId: string): Promise<void> {
    this.realmOptions.delete(realmId);
    await this.manager.removeContainer(realmId);
  }

  async capture(realmId: string): Promise<Buffer> {
    return this.display.capture(realmId);
  }

  async click(
    realmId: string,
    x: number,
    y: number,
    button?: 'left' | 'right' | 'middle',
  ): Promise<ActionResult> {
    return this.display.click(realmId, x, y, button);
  }

  async typeText(realmId: string, text: string): Promise<ActionResult> {
    return this.display.typeText(realmId, text);
  }

  async keyPress(realmId: string, key: string): Promise<ActionResult> {
    return this.display.keyPress(realmId, key);
  }

  async scroll(
    realmId: string,
    deltaX: number,
    deltaY: number,
  ): Promise<ActionResult> {
    return this.display.scroll(realmId, deltaX, deltaY);
  }

  async navigate(realmId: string, url: string): Promise<ActionResult> {
    return this.execute(
      realmId,
      `xdg-open '${url.replace(/'/g, "'\\''")}'`,
    );
  }

  async execute(
    realmId: string,
    command: string,
    args?: string[],
  ): Promise<ActionResult> {
    const container = this.docker.getContainer(realmId);
    const startTime = Date.now();
    try {
      const exec = await container.exec({
        Cmd: args ? [command, ...args] : ['bash', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false, Tty: false });
      const { stdout, stderr } = await this.streamToResult(
        stream as NodeJS.ReadableStream,
      );

      return {
        success: true,
        data: { stdout, stderr, exitCode: 0 },
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async importFile(
    realmId: string,
    sourcePath: string,
    destPath: string,
  ): Promise<FileRef> {
    return this.filesystem.importFile(realmId, sourcePath, destPath);
  }

  async exportFile(
    realmId: string,
    sourcePath: string,
    destPath: string,
  ): Promise<FileRef> {
    return this.filesystem.exportFile(realmId, sourcePath, destPath);
  }

  async listFiles(realmId: string, path: string): Promise<FileRef[]> {
    return this.filesystem.listFiles(realmId, path);
  }

  async setNetworkMode(
    realmId: string,
    mode: NetworkMode,
    _allowedDomains?: string[],
  ): Promise<void> {
    const container = this.docker.getContainer(realmId);
    const info = await container.inspect();
    const currentMode = info.HostConfig?.NetworkMode ?? 'bridge';
    const desiredMode = mode === 'disabled' ? 'none' : 'bridge';
    if (currentMode !== desiredMode) {
      console.warn(
        `[UbuntuEngine] Network mode change from ${currentMode} to ${desiredMode} ` +
          'requires container recreation.',
      );
    }
  }

  async health(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptimeSec: number;
  }> {
    try {
      await this.docker.info();
      return {
        status: 'healthy',
        uptimeSec: 0,
      };
    } catch {
      return { status: 'unhealthy', uptimeSec: 0 };
    }
  }

  private streamToResult(
    stream: NodeJS.ReadableStream,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const stdoutBuf: Buffer[] = [];
      const stderrBuf: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; ) {
          const streamType = chunk[i];
          if (streamType === undefined) break;
          const payloadLen =
            ((chunk[i + 4] ?? 0) << 24) |
            ((chunk[i + 5] ?? 0) << 16) |
            ((chunk[i + 6] ?? 0) << 8) |
            (chunk[i + 7] ?? 0);
          const payload = chunk.subarray(i + 8, i + 8 + payloadLen);
          if (streamType === 1) stdoutBuf.push(payload);
          else if (streamType === 2) stderrBuf.push(payload);
          i += 8 + payloadLen;
        }
      });

      stream.on('end', () =>
        resolve({
          stdout: Buffer.concat(stdoutBuf).toString(),
          stderr: Buffer.concat(stderrBuf).toString(),
        }),
      );
      stream.on('error', reject);
    });
  }
}
