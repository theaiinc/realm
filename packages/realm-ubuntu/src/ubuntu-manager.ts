import Docker from 'dockerode';
import type { UbuntuOptions, YggdrasilConfig } from './ubuntu-types.js';

const DEFAULT_IMAGE = 'realm-ubuntu';

/**
 * UbuntuManager — manages Docker container lifecycle for Ubuntu Desktop realms.
 *
 * Each realm runs an XFCE4 desktop inside Docker with Xvfb + x11vnc,
 * pre-loaded with browsers, dev tools, and embedded Yggdrasil Ratatoskr.
 */
export class UbuntuManager {
  constructor(private readonly docker: Docker) {}

  async createContainer(
    realmName: string,
    options?: UbuntuOptions & { yggdrasil?: YggdrasilConfig },
  ): Promise<Docker.Container> {
    const image = DEFAULT_IMAGE;
    const resolution = options?.resolution ?? '1920x1080';
    const vncPort = options?.vncPort ?? 5901;
    const memoryMb = options?.memoryMb ?? 2048;
    const cpus = options?.cpus ?? 2;

    // Ensure image exists
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      await this.pullImage(image);
    }

    const containerName = `realm-ubuntu-${realmName}-${Date.now()}`;

    // Build environment variables
    const env: string[] = [
      `DISPLAY=:99`,
      `RESOLUTION=${resolution}`,
      `VNC_PORT=${vncPort}`,
      `DEBIAN_FRONTEND=noninteractive`,
    ];

    // Inject Yggdrasil config if provided
    if (options?.yggdrasil) {
      const y = options.yggdrasil;
      env.push(`YGGDRASIL_URL=${y.url}`);
      if (y.apiKey) env.push(`API_KEY=${y.apiKey}`);
      if (y.runnerName) env.push(`RUNNER_NAME=${y.runnerName}`);
      if (y.capabilities) env.push(`CAPABILITIES=${y.capabilities.join(',')}`);
      if (y.heartbeatInterval !== undefined) env.push(`HEARTBEAT_INTERVAL=${y.heartbeatInterval}`);
      if (y.leaseTtl !== undefined) env.push(`LEASE_TTL=${y.leaseTtl}`);
      if (y.taskPollInterval !== undefined) env.push(`TASK_POLL_INTERVAL=${y.taskPollInterval}`);
      if (y.llmModel) env.push(`LLM_MODEL=${y.llmModel}`);
      if (y.llmBaseUrl) env.push(`LLM_BASE_URL=${y.llmBaseUrl}`);
      if (y.llmApiKey) env.push(`LLM_API_KEY=${y.llmApiKey}`);
      if (y.agentMaxToolIterations !== undefined) env.push(`AGENT_MAX_TOOL_ITERATIONS=${y.agentMaxToolIterations}`);
    }

    const container = await this.docker.createContainer({
      name: containerName,
      Image: image,
      Cmd: ['/bin/bash', '-c', `/usr/bin/start-realm.sh "${resolution}"`],
      Env: env,
      HostConfig: {
        NetworkMode: 'bridge',
        PortBindings: {
          [`${vncPort}/tcp`]: [{ HostPort: String(vncPort) }],
        },
        Memory: memoryMb * 1024 * 1024,
        MemorySwap: 0,
        NanoCpus: cpus * 1_000_000_000,
        ReadonlyRootfs: false,
        Privileged: true,
        ExtraHosts: ['host.docker.internal:host-gateway'],
      },
      WorkingDir: '/workspace',
      ExposedPorts: {
        [`${vncPort}/tcp`]: {},
      },
    });

    return container;
  }

  async startContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.start();
  }

  async stopContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.stop({ t: 10 });
    } catch {
      // Already stopped
    }
  }

  async pauseContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.pause();
    } catch {
      // Already paused
    }
  }

  async resumeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.unpause();
    } catch {
      // Not paused
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.remove({ force: true, v: true });
    } catch {
      // Already removed
    }
  }

  private async pullImage(image: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(image, {}, (err, stream) => {
        if (err) return reject(err);
        if (!stream) return reject(new Error(`No stream for image pull: ${image}`));
        this.docker.modem.followProgress(stream, (pullErr) => {
          if (pullErr) return reject(pullErr);
          resolve();
        });
      });
    });
  }
}
