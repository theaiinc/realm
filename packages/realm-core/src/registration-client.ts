/**
 * RealmRegistrationClient — announces this Realm instance to Yggdrasil
 * via Ratatoskr, and maintains a periodic heartbeat.
 *
 * Architecture:
 *   Realm ──→ Ratatoskr (relays) ──→ Yggdrasil
 *
 * Ratatoskr is the transport. It never inspects or stores realm state.
 * Yggdrasil is the authority on realm lifecycle.
 *
 * Usage:
 *   const client = new RealmRegistrationClient({ realmId, runnerId, ... });
 *   await client.start();       // registers + begins heartbeats
 *   await client.stop();        // deregisters + stops heartbeats
 */

export interface RealmRegistrationClientConfig {
  /** Unique ID for this realm instance. */
  realmId: string;
  /** Runner ID that hosts this realm. */
  runnerId: string;
  /** Ratatoskr HTTP base URL (the relay). */
  ratatoskrUrl: string;
  /** The template type this realm was spawned from (e.g. "ubuntu", "android"). */
  template: string;
  /** Realm software version. */
  version?: string;
  /** Capabilities this realm provides. */
  capabilities?: string[];
  /** Base URL where this realm's API is reachable (used to build endpoints). */
  realmBaseUrl: string;
  /** Future: Veil-issued registration token. */
  registrationToken?: string;
  /** Heartbeat interval in milliseconds (default 30_000). */
  heartbeatIntervalMs?: number;
}

export class RealmRegistrationClient {
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private startedAt: string;
  private readonly config: RealmRegistrationClientConfig & {
    version: string;
    capabilities: string[];
    heartbeatIntervalMs: number;
  };
  private readonly defaults = {
    version: '0.1.0',
    capabilities: ['observe', 'mouse', 'keyboard', 'scroll', 'drag', 'clipboard'] as string[],
    heartbeatIntervalMs: 30_000,
  };

  constructor(config: RealmRegistrationClientConfig) {
    this.config = {
      ...config,
      capabilities: config.capabilities ?? this.defaults.capabilities,
      version: config.version ?? this.defaults.version,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? this.defaults.heartbeatIntervalMs,
    };
    this.startedAt = new Date().toISOString();
  }

  /**
   * Register the realm with Yggdrasil (via Ratatoskr) and start heartbeats.
   */
  async start(): Promise<void> {
    await this.register();
    this.startHeartbeat();
  }

  /**
   * Send a deregistration and stop heartbeats.
   */
  async stop(): Promise<void> {
    this.stopHeartbeat();
    await this.deregister();
  }

  /**
   * Send the initial registration payload.
   */
  private async register(): Promise<void> {
    const { realmId, runnerId, template, version, capabilities, realmBaseUrl, registrationToken } = this.config;

    const body = {
      realmId,
      runnerId,
      template,
      version,
      capabilities,
      endpoints: {
        observation: `${realmBaseUrl.replace(/\/+$/, '')}/api/v1/realms/${realmId}/capture`,
        input: `${realmBaseUrl.replace(/\/+$/, '')}/api/v1/realms/${realmId}`,
      },
      ...(registrationToken !== undefined ? { registrationToken } : {}),
      startedAt: this.startedAt,
    };

    try {
      const response = await fetch(`${this.config.ratatoskrUrl.replace(/\/+$/, '')}/api/v1/realms/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        console.error(`[RealmRegistration] Registration failed: ${response.status} ${response.statusText}`);
      } else {
        console.log(`[RealmRegistration] Registered realm ${realmId} with Yggdrasil`);
      }
    } catch (error) {
      console.error('[RealmRegistration] Registration error:', error);
    }
  }

  /**
   * Send a heartbeat.
   */
  private async sendHeartbeat(): Promise<void> {
    const { realmId } = this.config;
    const uptime = Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1000);

    const body = {
      realmId,
      uptime,
      healthy: true,
      activeSessions: 0,
    };

    try {
      const response = await fetch(`${this.config.ratatoskrUrl.replace(/\/+$/, '')}/api/v1/realms/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        console.warn(`[RealmRegistration] Heartbeat failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.warn('[RealmRegistration] Heartbeat error:', error);
    }
  }

  /**
   * Send the deregistration payload.
   */
  private async deregister(): Promise<void> {
    const { realmId } = this.config;

    const body = {
      realmId,
      reason: 'shutdown' as const,
    };

    try {
      const response = await fetch(`${this.config.ratatoskrUrl.replace(/\/+$/, '')}/api/v1/realms/deregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        console.error(`[RealmRegistration] Deregistration failed: ${response.status} ${response.statusText}`);
      } else {
        console.log(`[RealmRegistration] Deregistered realm ${realmId}`);
      }
    } catch (error) {
      console.error('[RealmRegistration] Deregistration error:', error);
    }
  }

  /**
   * Start the heartbeat interval.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch((err) => console.error('[RealmRegistration] Heartbeat error:', err));
    }, this.config.heartbeatIntervalMs);
  }

  /**
   * Stop the heartbeat interval.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
