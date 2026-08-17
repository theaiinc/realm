import { EngineType } from '@theaiinc/realm-core';
import type { RealmHttpClient } from '@theaiinc/realm-client';

export interface ControlsCallbacks {
  onUbuntuRealmReady: (realmId: string) => void;
  onHostRealmReady: (realmId: string) => void;
}

/** Small control panel: create/start the two realms this demo needs. */
export function setupControls(container: HTMLElement, client: RealmHttpClient, callbacks: ControlsCallbacks): void {
  const startDesktopBtn = document.createElement('button');
  startDesktopBtn.textContent = 'Create + start XFCE desktop';
  startDesktopBtn.addEventListener('click', async () => {
    startDesktopBtn.disabled = true;
    try {
      const { id } = await client.createRealm({ name: `ui-desktop-${Date.now()}`, engine: EngineType.Ubuntu });
      await client.startRealm(id, ['observe', 'mouse', 'keyboard']);
      callbacks.onUbuntuRealmReady(id);
    } catch (err) {
      alert(`Failed to start desktop realm: ${err instanceof Error ? err.message : err}`);
    } finally {
      startDesktopBtn.disabled = false;
    }
  });

  const startAndroidAutoBtn = document.createElement('button');
  startAndroidAutoBtn.textContent = 'Create + start Android Auto (host)';
  startAndroidAutoBtn.addEventListener('click', async () => {
    startAndroidAutoBtn.disabled = true;
    try {
      const { id } = await client.createRealm({
        name: `ui-android-auto-${Date.now()}`,
        engine: EngineType.Host,
        environment: { HOST_TARGET: 'android-auto' },
      });
      await client.startRealm(id, ['observe']);
      callbacks.onHostRealmReady(id);
    } catch (err) {
      alert(`Failed to start Android Auto realm: ${err instanceof Error ? err.message : err}`);
    } finally {
      startAndroidAutoBtn.disabled = false;
    }
  });

  container.append(startDesktopBtn, startAndroidAutoBtn);
}
