import Docker from 'dockerode';
import type {
  RealmConfig,
  RealmSession,
  ActionResult,
  FileRef,
} from '@theaiinc/realm-core';
import { RealmState, EngineType, NetworkMode } from '@theaiinc/realm-core';
import type { RealmEngine } from '@theaiinc/realm-core';
import { ContainerManager } from './container-manager.js';
import { ContainerFilesystem } from './container-filesystem.js';
import { ContainerNetwork } from './container-network.js';

/**
 * ContainerEngine — RealmEngine implementation backed by Docker containers.
 *
 * Each realm is a Docker container with mounted volumes for
 * /workspace, /input, /output, and /tmp.
 */
export class ContainerEngine implements RealmEngine {
  readonly type = EngineType.Container;

  private readonly docker: Docker;
  private readonly manager: ContainerManager;
  private readonly filesystem: ContainerFilesystem;
  private readonly network: ContainerNetwork;

  constructor(options?: { socketPath?: string }) {
    this.docker = new Docker(options?.socketPath ? { socketPath: options.socketPath } : undefined);
    this.manager = new ContainerManager(this.docker);
    this.filesystem = new ContainerFilesystem(this.docker);
    this.network = new ContainerNetwork(this.docker);
  }

  async create(config: RealmConfig): Promise<string> {
    const container = await this.manager.createContainer({
      name: config.name,
      image: config.template ? `realm-${config.template}` : 'realm-base',
      networkMode: config.networkMode ?? NetworkMode.Disabled,
      environment: config.environment,
    });
    return container.id;
  }

  async start(realmId: string): Promise<RealmSession> {
    const container = this.docker.getContainer(realmId);
    await container.start();
    const info = await container.inspect();

    return {
      id: `session-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: info.State.StartedAt ?? new Date().toISOString(),
      grantedCapabilities: [],
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
      id: `session-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: new Date().toISOString(),
      grantedCapabilities: [],
    };
  }

  async destroy(realmId: string): Promise<void> {
    await this.manager.removeContainer(realmId);
  }

  async capture(realmId: string): Promise<Buffer> {
    try {
      const exec = await this.docker.getContainer(realmId).exec({
        Cmd: ['bash', '-c', 'cat /tmp/screenshot.png 2>/dev/null || echo "no-display"'],
        AttachStdout: true,
        AttachStderr: true,
      });
      const start = await exec.start({ Detach: false, Tty: false });
      return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        (start as NodeJS.ReadableStream).on('data', (chunk: Buffer) => chunks.push(chunk));
        (start as NodeJS.ReadableStream).on('end', () => resolve(Buffer.concat(chunks)));
        (start as NodeJS.ReadableStream).on('error', reject);
      });
    } catch {
      return Buffer.from('screenshot-unavailable');
    }
  }

  async click(realmId: string, x: number, y: number): Promise<ActionResult> {
    return this.execute(realmId, `python3 -c "import pyautogui; pyautogui.click(${x}, ${y})"`);
  }

  async typeText(realmId: string, text: string): Promise<ActionResult> {
    const escaped = text.replace(/'/g, "'\\''");
    return this.execute(realmId, `python3 -c "import pyautogui; pyautogui.typewrite('${escaped}')"`);
  }

  async keyPress(realmId: string, key: string): Promise<ActionResult> {
    return this.execute(realmId, `python3 -c "import pyautogui; pyautogui.press('${key}')"`);
  }

  async scroll(realmId: string, _deltaX: number, deltaY: number): Promise<ActionResult> {
    return this.execute(
      realmId,
      `python3 -c "import pyautogui; pyautogui.scroll(${deltaY})"`,
    );
  }

  async navigate(realmId: string, url: string): Promise<ActionResult> {
    return this.execute(realmId, `python3 -c "import webbrowser; webbrowser.open('${url.replace(/'/g, "\\'")}')"`);
  }

  async execute(realmId: string, command: string, args?: string[]): Promise<ActionResult> {
    const startTime = Date.now();
    try {
      const exec = await this.docker.getContainer(realmId).exec({
        Cmd: args ? [command, ...args] : ['bash', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false, Tty: false });
      const { stdout, stderr } = await this.streamToResult(stream as NodeJS.ReadableStream);

      return {
        success: true,
        data: { stdout, stderr },
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

  async importFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    return this.filesystem.importFile(realmId, sourcePath, destPath);
  }

  async exportFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    return this.filesystem.exportFile(realmId, sourcePath, destPath);
  }

  async listFiles(realmId: string, path: string): Promise<FileRef[]> {
    return this.filesystem.listFiles(realmId, path);
  }

  async setNetworkMode(realmId: string, mode: NetworkMode, allowedDomains?: string[]): Promise<void> {
    await this.network.setNetworkMode(realmId, mode, allowedDomains);
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }> {
    try {
      const info = await this.docker.info();
      return {
        status: 'healthy',
        uptimeSec: info.SystemStatus ? 0 : 0,
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
