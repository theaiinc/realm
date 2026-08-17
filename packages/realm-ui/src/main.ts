import Guacamole from 'guacamole-common-js';
import { RealmHttpClient } from '@theaiinc/realm-client';
import { setupControls } from './controls.js';
import { startHostPanel } from './host-panel.js';

const REALM_API_URL = import.meta.env['VITE_REALM_API_URL'] ?? 'http://127.0.0.1:8542';
const STREAM_TOKEN_URL = import.meta.env['VITE_STREAM_TOKEN_URL'] ?? 'http://127.0.0.1:8081';
const STREAM_WS_URL = import.meta.env['VITE_STREAM_WS_URL'] ?? 'ws://127.0.0.1:8080';

const client = new RealmHttpClient(REALM_API_URL);

const guacDisplayEl = document.getElementById('guac-display') as HTMLDivElement;
const hostViewEl = document.getElementById('host-view') as HTMLImageElement;
const controlsEl = document.getElementById('controls') as HTMLDivElement;

let stopHostPanel: (() => void) | undefined;

async function connectDesktop(realmId: string): Promise<void> {
  const tokenResponse = await fetch(`${STREAM_TOKEN_URL}/token?realmId=${encodeURIComponent(realmId)}`);
  if (!tokenResponse.ok) {
    console.error('[realm-ui] Failed to fetch stream token', await tokenResponse.text());
    return;
  }
  const { token } = (await tokenResponse.json()) as { token: string };

  const tunnel = new Guacamole.WebSocketTunnel(STREAM_WS_URL);
  const guacClient = new Guacamole.Client(tunnel);

  guacClient.onerror = (status) => console.error('[realm-ui] Guacamole error', status);

  const display = guacClient.getDisplay();
  guacDisplayEl.replaceChildren(display.getElement());

  // The display renders at the container's native resolution (e.g.
  // 1920x1080) regardless of the panel's on-screen size, so without
  // scaling it just gets clipped by the container's CSS. Fit it to the
  // panel's actual width, both once we learn the real size and on resize.
  const scaleToFit = () => {
    const displayWidth = display.getWidth();
    if (displayWidth > 0) display.scale(guacDisplayEl.clientWidth / displayWidth);
  };
  display.onresize = scaleToFit;
  window.addEventListener('resize', scaleToFit);

  // Real interactive control through the stream — mouse/keyboard passthrough
  // into the container's XFCE desktop, not just a viewer.
  const mouse = new Guacamole.Mouse(display.getElement());
  mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (state) => guacClient.sendMouseState(state);

  const keyboard = new Guacamole.Keyboard(document);
  keyboard.onkeydown = (keysym) => guacClient.sendKeyEvent(1, keysym);
  keyboard.onkeyup = (keysym) => guacClient.sendKeyEvent(0, keysym);

  guacClient.connect(`token=${encodeURIComponent(token)}`);
}

function connectHostPanel(realmId: string): void {
  stopHostPanel?.();
  stopHostPanel = startHostPanel(client, realmId, hostViewEl);
}

setupControls(controlsEl, client, {
  onUbuntuRealmReady: (realmId) => {
    void connectDesktop(realmId);
  },
  onHostRealmReady: (realmId) => {
    connectHostPanel(realmId);
  },
});
