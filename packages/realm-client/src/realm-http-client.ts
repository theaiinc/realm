import type { ActionResult, RealmConfig, RealmSession } from '@theaiinc/realm-core';

/**
 * Shape realm-api's REST routes actually send for a realm — matches
 * RealmAPI.getRealm()/listRealms() in realm-core (`{id, config, session}`),
 * which is narrower than the aspirational `Realm` type in realm-core's
 * types.ts (that type isn't what the API returns today).
 */
export interface RealmSummary {
  id: string;
  config: RealmConfig;
  session?: RealmSession;
}

/** Thin fetch wrapper around realm-api's REST surface, mirroring realm-cli's api() helper. */
export class RealmHttpClient {
  constructor(private readonly baseUrl: string = 'http://127.0.0.1:8542') {}

  private async request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : undefined;
      throw new Error(message ?? `HTTP ${response.status}`);
    }
    return data as T;
  }

  listRealms(): Promise<{ realms: RealmSummary[] }> {
    return this.request('/api/v1/realms');
  }

  getRealm(id: string): Promise<{ realm: RealmSummary }> {
    return this.request(`/api/v1/realms/${id}`);
  }

  createRealm(config: RealmConfig): Promise<{ id: string }> {
    return this.request('/api/v1/realms', { method: 'POST', body: config });
  }

  startRealm(id: string, capabilities?: string[]): Promise<{ session: RealmSession }> {
    return this.request(`/api/v1/realms/${id}/start`, { method: 'POST', body: { capabilities } });
  }

  stopRealm(id: string): Promise<void> {
    return this.request(`/api/v1/realms/${id}/stop`, { method: 'POST' });
  }

  destroyRealm(id: string): Promise<void> {
    return this.request(`/api/v1/realms/${id}`, { method: 'DELETE' });
  }

  exec(id: string, command: string): Promise<ActionResult> {
    return this.request(`/api/v1/realms/${id}/exec`, { method: 'POST', body: { command } });
  }

  capture(id: string): Promise<{ screenshot: string; piiRedacted: boolean }> {
    return this.request(`/api/v1/realms/${id}/capture`);
  }
}
