import Docker from 'dockerode';
import type { NetworkMode } from '@theaiinc/realm-core';

/**
 * ContainerNetwork — manages network policies for container realms.
 */
export class ContainerNetwork {
  constructor(private readonly docker: Docker) {}

  async setNetworkMode(
    containerId: string,
    mode: NetworkMode,
    allowedDomains?: string[],
  ): Promise<void> {
    // Docker doesn't support domain-level filtering natively.
    // For Restricted mode, we'd need a proxy sidecar or iptables rules.
    // For MVP:
    //   - Disabled: no network
    //   - Restricted: attached to bridge (can be enhanced with proxy)
    //   - Full: attached to bridge

    // Note: Full network mode change requires recreating the container.
    // For MVP, network mode is set at creation time.
    // This method logs the desired mode for future proxy implementation.
    const container = this.docker.getContainer(containerId);
    const info = await container.inspect();

    const currentMode = info.HostConfig?.NetworkMode ?? 'bridge';
    const desiredMode = mode === 'disabled' ? 'none' : 'bridge';

    if (currentMode !== desiredMode) {
      console.warn(
        `[ContainerNetwork] Network mode change from ${currentMode} to ${desiredMode} ` +
          `requires container recreation. Set network at creation time for now.`,
      );
    }

    if (mode === 'restricted' && allowedDomains?.length) {
      console.info(
        `[ContainerNetwork] Restricted mode: domains ${allowedDomains.join(', ')} ` +
          `— requires proxy sidecar for enforcement.`,
      );
    }
  }
}
