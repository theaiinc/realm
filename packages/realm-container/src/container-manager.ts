import Docker from 'dockerode';
import type { NetworkMode } from '@theaiinc/realm-core';

interface CreateContainerOptions {
  name: string;
  image: string;
  networkMode: NetworkMode;
  environment?: Record<string, string>;
}

/**
 * ContainerManager — manages Docker container lifecycle.
 */
export class ContainerManager {
  constructor(private readonly docker: Docker) {}

  async createContainer(opts: CreateContainerOptions): Promise<Docker.Container> {
    // Ensure image exists
    try {
      await this.docker.getImage(opts.image).inspect();
    } catch {
      await this.pullImage(opts.image);
    }

    const container = await this.docker.createContainer({
      name: `realm-${opts.name}-${Date.now()}`,
      Image: opts.image,
      Cmd: ['/bin/bash', '-c', 'tail -f /dev/null'], // Keep container alive
      Env: opts.environment
        ? Object.entries(opts.environment).map(([k, v]) => `${k}=${v}`)
        : undefined,
      HostConfig: {
        NetworkMode: opts.networkMode === 'disabled' ? 'none' : 'bridge',
        Binds: [], // Volumes managed by ContainerFilesystem
        Memory: 512 * 1024 * 1024, // 512MB default
        MemorySwap: 0, // Disable swap
        ReadonlyRootfs: false,
      },
      WorkingDir: '/workspace',
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
      await container.stop({ t: 5 });
    } catch {
      // Container may already be stopped
    }
  }

  async pauseContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.pause();
    } catch {
      // May already be paused
    }
  }

  async resumeContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.unpause();
    } catch {
      // May not be paused
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

  async listContainers(): Promise<Docker.ContainerInfo[]> {
    return this.docker.listContainers({ all: true, filters: { name: ['realm-'] } });
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
