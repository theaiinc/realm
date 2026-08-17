import type { RealmHttpClient } from '@theaiinc/realm-client';

/**
 * Polls realm-api's existing /capture endpoint for a host-engine realm
 * (e.g. Android Auto/DHU) and renders it into an <img>. Deliberately reuses
 * the poll-based screenshot mechanism realm-api already has rather than
 * building a second real-time streaming pipeline for this secondary,
 * host-launched view.
 */
export function startHostPanel(client: RealmHttpClient, realmId: string, imgEl: HTMLImageElement, intervalMs = 1000): () => void {
  let stopped = false;

  async function poll() {
    if (stopped) return;
    try {
      const { screenshot } = await client.capture(realmId);
      imgEl.src = `data:image/png;base64,${screenshot}`;
    } catch {
      // Realm may not be running yet — keep polling rather than surfacing errors.
    }
    if (!stopped) setTimeout(poll, intervalMs);
  }

  poll();

  return () => {
    stopped = true;
  };
}
