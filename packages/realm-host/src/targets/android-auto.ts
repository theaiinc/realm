import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Resolves the Android SDK root the same way `sdkmanager`/`emulator` do:
 * $ANDROID_SDK_ROOT, then $ANDROID_HOME, then the standard macOS default.
 * realm-host never installs or manages the SDK itself — it only launches
 * binaries from whatever SDK is already configured on the host, validated
 * manually during development (see the plan's Phase 0 notes).
 */
function androidSdkRoot(): string {
  return process.env['ANDROID_SDK_ROOT'] ?? process.env['ANDROID_HOME'] ?? path.join(os.homedir(), 'Library/Android/sdk');
}

const HEAD_UNIT_SERVER_PORT = 5277;
const BOOT_POLL_INTERVAL_MS = 3000;
const BOOT_TIMEOUT_MS = 180_000;
// Fixed emulator console port so the adb serial (`emulator-<port>`) is
// deterministic and we can target it explicitly with `-s`. Without this,
// `adb wait-for-device`/`shell` fail outright with "more than one
// device/emulator" whenever anything else is attached — a real physical
// phone connected over USB/wireless debugging, in particular, which is a
// completely ordinary thing for an Android developer to have plugged in.
const EMULATOR_CONSOLE_PORT = 5554;

function adbPath(): string {
  return path.join(androidSdkRoot(), 'platform-tools/adb');
}

async function waitForBootCompleted(serial: string, deadlineMs: number): Promise<void> {
  const adb = adbPath();
  await execFileAsync(adb, ['-s', serial, 'wait-for-device']);
  const start = Date.now();
  for (;;) {
    const { stdout } = await execFileAsync(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).catch(() => ({ stdout: '' }));
    if (stdout.trim() === '1') return;
    if (Date.now() - start > deadlineMs) {
      throw new Error(`Android emulator did not report boot_completed within ${deadlineMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, BOOT_POLL_INTERVAL_MS));
  }
}

const GEARHEAD_PACKAGE = 'com.google.android.projection.gearhead';
const GEARHEAD_NOTIFICATION_LISTENER = `${GEARHEAD_PACKAGE}/com.google.android.gearhead.notifications.SharedNotificationListenerManager$ListenerService`;

/**
 * Android Auto blocks on an in-app "Android Auto needs you to turn on
 * notification access from your phone" screen until this device-level
 * NotificationListenerService grant is present — confirmed by hand, then
 * automated here since it's a device settings grant (like the emulator
 * itself), not account credentials, which is the actual line this
 * codebase won't cross (see the class doc on launchAndroidAuto).
 *
 * `adb shell` joins its args and re-parses them through the *device's*
 * shell, so the literal `$` in the inner-class name must be escaped for
 * that remote shell specifically — not just whatever invokes this process
 * locally.
 */
async function grantNotificationAccess(serial: string): Promise<void> {
  const adb = adbPath();
  const { stdout: currentRaw } = await execFileAsync(adb, [
    '-s',
    serial,
    'shell',
    'settings',
    'get',
    'secure',
    'enabled_notification_listeners',
  ]).catch(() => ({ stdout: '' }));
  const current = currentRaw.trim();
  if (current.includes(GEARHEAD_NOTIFICATION_LISTENER)) return;

  const updated = current && current !== 'null' ? `${current}:${GEARHEAD_NOTIFICATION_LISTENER}` : GEARHEAD_NOTIFICATION_LISTENER;
  const escapedForDeviceShell = updated.replace(/\$/g, () => '\\$');
  await execFileAsync(adb, ['-s', serial, 'shell', 'settings', 'put', 'secure', 'enabled_notification_listeners', escapedForDeviceShell]);

  // The app only picks up a new listener grant on its next (re)start —
  // this also resets the "Start head unit server" toggle, which is why
  // this runs before, not after, the head-unit-server/DHU sequence below.
  await execFileAsync(adb, ['-s', serial, 'shell', 'am', 'force-stop', GEARHEAD_PACKAGE]);
}

interface ElementBounds {
  x: number;
  y: number;
}

/** Dumps the current UI hierarchy via uiautomator and returns it as a string. */
async function dumpUi(serial: string): Promise<string> {
  const adb = adbPath();
  await execFileAsync(adb, ['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/realm-host-ui.xml']);
  const localPath = path.join(os.tmpdir(), `realm-host-ui-${Date.now()}.xml`);
  await execFileAsync(adb, ['-s', serial, 'pull', '/sdcard/realm-host-ui.xml', localPath]);
  const xml = await fs.readFile(localPath, 'utf8');
  await fs.unlink(localPath).catch(() => undefined);
  return xml;
}

/**
 * Finds the center point of the first UI element whose given attribute
 * matches the given value exactly (e.g. `text="Start head unit server"` or
 * `content-desc="More options"`). Resolution-independent by design — reads
 * real element bounds from the live UI tree rather than hardcoded pixel
 * coordinates, since those would only be valid for one specific AVD's
 * configured screen size.
 */
function findElementCenter(xml: string, attribute: string, value: string): ElementBounds | undefined {
  const nodeTags = xml.match(/<node[^>]*>/g) ?? [];
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attrPattern = new RegExp(`${attribute}="${escapedValue}"`);
  for (const tag of nodeTags) {
    if (!attrPattern.test(tag)) continue;
    const boundsMatch = tag.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsMatch) continue;
    const [, x1, y1, x2, y2] = boundsMatch.map(Number);
    return { x: Math.round((x1! + x2!) / 2), y: Math.round((y1! + y2!) / 2) };
  }
  return undefined;
}

async function tap(serial: string, point: ElementBounds): Promise<void> {
  await execFileAsync(adbPath(), ['-s', serial, 'shell', 'input', 'tap', String(point.x), String(point.y)]);
}

const UI_POLL_INTERVAL_MS = 500;
const UI_POLL_TIMEOUT_MS = 8000;

/**
 * Repeatedly dumps the UI (uiautomator, not free — each dump is a real
 * round trip) until an element matching the given attribute/value appears,
 * or the timeout elapses. A fixed sleep-then-dump-once was flaky in
 * practice: how long a menu/activity takes to actually render varies with
 * host system load, so a single dump can race it and see stale content —
 * confirmed empirically (an identical sequence succeeded on a slower,
 * polled retry immediately after a fixed 1s wait had already failed).
 */
async function waitForElement(serial: string, attribute: string, value: string, timeoutMs = UI_POLL_TIMEOUT_MS): Promise<ElementBounds | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = findElementCenter(await dumpUi(serial), attribute, value);
    if (found) return found;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, UI_POLL_INTERVAL_MS));
  }
}

/**
 * Toggles Android Auto's "Start head unit server" developer setting on, if
 * it isn't already — the one remaining manual step short of full
 * agent-driven E2E control. It lives in the app's own overflow menu
 * ("More options"), reached via its settings activity, not gated behind
 * anything credential-related, so — like grantNotificationAccess — this is
 * a UI action within the codebase's existing automation boundary, not a
 * new exception to it.
 *
 * Idempotent: if the menu already reads "Stop head unit server" (i.e. it's
 * already running), this is a no-op.
 */
async function startHeadUnitServer(serial: string): Promise<void> {
  const adb = adbPath();
  await execFileAsync(adb, [
    '-s',
    serial,
    'shell',
    'am',
    'start',
    '-n',
    `${GEARHEAD_PACKAGE}/.companion.settings.DefaultSettingsActivity`,
  ]);

  const overflowMenu = await waitForElement(serial, 'content-desc', 'More options');
  if (!overflowMenu) {
    throw new Error('Could not find the Android Auto settings "More options" overflow menu — the app UI may have changed.');
  }
  await tap(serial, overflowMenu);

  const stopOption = await waitForElement(serial, 'text', 'Stop head unit server', 3000);
  if (stopOption) return; // already running

  const startOption = await waitForElement(serial, 'text', 'Start head unit server');
  if (!startOption) {
    throw new Error('Could not find "Start head unit server" in the Android Auto app\'s overflow menu — the app UI may have changed.');
  }
  await tap(serial, startOption);
}

export interface LaunchResult {
  emulator: ChildProcess;
  dhu: ChildProcess;
}

const DHU_CONNECT_RETRY_INTERVAL_MS = 3000;
const DHU_CONNECT_RETRIES = 15; // ~45s of slack

/**
 * Android Auto's "Start head unit server" toggle is a runtime service
 * start, not a persisted setting — it does not survive an emulator
 * restart, so startHeadUnitServer() re-does it on every boot. DHU itself
 * doesn't retry connecting: if the server isn't listening yet, it prints
 * "Failed to start Google Automotive Link" and exits within ~1-2s, so
 * there's still a real timing race between that toggle taking effect and
 * DHU's connection attempt. This retries a bounded number of times to
 * absorb that race, rather than relying on perfect timing.
 */
async function spawnDhuWithRetry(dhuBin: string): Promise<ChildProcess> {
  for (let attempt = 1; attempt <= DHU_CONNECT_RETRIES; attempt++) {
    // stdio: 'pipe' with stdin never written/ended keeps DHU's interactive
    // prompt from seeing EOF (which otherwise makes it exit immediately
    // regardless of connection outcome).
    const dhu = spawn(dhuBin, ['-a'], { stdio: 'pipe' });

    const exitedEarly = await new Promise<boolean>((resolve) => {
      const onExit = () => resolve(true);
      dhu.once('exit', onExit);
      setTimeout(() => {
        dhu.removeListener('exit', onExit);
        resolve(false);
      }, DHU_CONNECT_RETRY_INTERVAL_MS);
    });

    if (!exitedEarly) return dhu;
    if (attempt < DHU_CONNECT_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, DHU_CONNECT_RETRY_INTERVAL_MS));
    }
  }
  throw new Error(
    `Desktop Head Unit failed to stay connected after ${DHU_CONNECT_RETRIES} attempts, even after startHeadUnitServer() ran. ` +
      'The Android Auto app\'s UI may have changed (menu wording/layout), breaking that automation — check manually via ' +
      'Settings > overflow menu > "Start head unit server" before assuming this is a code regression.',
  );
}

/** The fixed adb serial this module always targets (see EMULATOR_CONSOLE_PORT). */
export function emulatorSerial(): string {
  return `emulator-${EMULATOR_CONSOLE_PORT}`;
}

export interface LaunchOptions {
  /**
   * Camera backend for the emulator's back/front cameras, passed straight
   * through as `-camera-back`/`-camera-front` (confirmed via `emulator
   * -help` — see the plan's Phase 4 notes). Known values: `emulated`
   * (synthetic test pattern), `webcam<N>` (a real Mac webcam — see
   * `emulator -webcam-list`), `virtualscene`, `none`. Unlike setLocation/
   * installApp, this can't be dynamic — the emulator only reads camera
   * backend at process launch, there's no known adb-level hot-swap.
   */
  cameraBack?: string;
  cameraFront?: string;
  /**
   * Passes `-allow-host-audio`, which routes the Mac's actual selected
   * input device into the guest's virtual microphone. Without this flag
   * the emulator's default behavior is to zero out mic input entirely
   * (per `emulator -help`), so this is required for the mic to carry any
   * signal at all.
   *
   * This is the only mic-related mechanism this module implements. The
   * emulator also ships a documented gRPC `injectAudio` RPC
   * (emulator_controller.proto) that looks like it should allow injecting
   * a specific prerecorded file/PCM stream on demand — that was spiked
   * and rejected: it reproducibly crashed the emulator process itself
   * (Mach exception, not a clean RPC error) on two separate attempts with
   * materially different request encodings, on this host's build
   * (macOS/Apple Silicon, HVF acceleration, emulator 35.4.9-13025442,
   * API 36). Shipping that path would trade "mic input isn't automatable
   * yet" for "the realm can crash outright when an agent tries to use
   * it," which is a worse failure mode. If a future emulator release
   * fixes it, this is the place to revisit.
   *
   * Like camera, this can't be dynamic — it's a process-launch flag, no
   * known adb-level hot-swap.
   */
  microphoneHostAudio?: boolean;
}

/**
 * Boots the given AVD with real hardware acceleration (Apple Silicon
 * Hypervisor.framework — validated to boot in ~30s, vs. never booting under
 * Docker Desktop's emulated x86_64 path; see the plan's Phase 0 findings),
 * then connects Desktop Head Unit to it once the emulator's ADB head-unit
 * server is reachable.
 *
 * Grants the notification-listener access Android Auto blocks on (see
 * grantNotificationAccess) and toggles "Start head unit server" (see
 * startHeadUnitServer) — both device-settings/UI actions, not credentials.
 *
 * Does NOT sign into a Google account — that one-time setup (the actual
 * AVD needs to already have the real Android Auto app installed and
 * signed in) is done by hand ahead of using this engine, since it
 * requires credential entry this codebase deliberately never automates.
 * Everything else needed for a realm to come up fully ready — no human
 * in the loop — is automated here, so an agent can drive the whole
 * create → start → test → debug cycle for an Android Auto app itself.
 */
export async function launchAndroidAuto(avdName: string, options: LaunchOptions = {}): Promise<LaunchResult> {
  const sdkRoot = androidSdkRoot();
  const emulatorBin = path.join(sdkRoot, 'emulator/emulator');
  const dhuBin = path.join(sdkRoot, 'extras/google/auto/desktop-head-unit');
  const serial = emulatorSerial();

  const emulatorArgs = ['-avd', avdName, '-no-snapshot', '-port', String(EMULATOR_CONSOLE_PORT)];
  if (options.cameraBack) emulatorArgs.push('-camera-back', options.cameraBack);
  if (options.cameraFront) emulatorArgs.push('-camera-front', options.cameraFront);
  if (options.microphoneHostAudio) emulatorArgs.push('-allow-host-audio');
  const emulator = spawn(emulatorBin, emulatorArgs, { stdio: 'ignore' });

  await waitForBootCompleted(serial, BOOT_TIMEOUT_MS);
  await grantNotificationAccess(serial);
  await startHeadUnitServer(serial);
  await execFileAsync(adbPath(), ['-s', serial, 'forward', `tcp:${HEAD_UNIT_SERVER_PORT}`, `tcp:${HEAD_UNIT_SERVER_PORT}`]);

  const dhu = await spawnDhuWithRetry(dhuBin);

  return { emulator, dhu };
}

export function stopAndroidAuto(result: Partial<LaunchResult>): void {
  result.dhu?.kill();
  result.emulator?.kill();
}

/** Sets mock GPS location via the emulator console (`adb emu geo fix`, longitude before latitude). */
export async function setLocation(serial: string, latitude: number, longitude: number): Promise<void> {
  await execFileAsync(adbPath(), ['-s', serial, 'emu', 'geo', 'fix', String(longitude), String(latitude)]);
}

/** Installs an APK from a host-local path (`adb install -r`, replacing any existing install). */
export async function installApp(serial: string, apkPath: string): Promise<void> {
  await execFileAsync(adbPath(), ['-s', serial, 'install', '-r', apkPath]);
}

/** Pushes a host-local file into the device (`adb push`). */
export async function pushFile(serial: string, sourcePath: string, destPath: string): Promise<void> {
  await execFileAsync(adbPath(), ['-s', serial, 'push', sourcePath, destPath]);
}

/** Pulls a file from the device to a host-local path (`adb pull`). */
export async function pullFile(serial: string, sourcePath: string, destPath: string): Promise<void> {
  await execFileAsync(adbPath(), ['-s', serial, 'pull', sourcePath, destPath]);
}

/**
 * Full-screen capture (not window-specific — macOS window-ID resolution via
 * AppleScript/System Events proved unreliable during manual validation).
 * Good enough for a secondary, host-launched view; realm-ui's primary panel
 * is the real-time Guacamole stream.
 */
export async function captureAndroidAuto(): Promise<Buffer> {
  const tmpFile = path.join(os.tmpdir(), `realm-host-capture-${Date.now()}.png`);
  await execFileAsync('screencapture', ['-x', tmpFile]);
  const buffer = await fs.readFile(tmpFile);
  await fs.unlink(tmpFile).catch(() => undefined);
  return buffer;
}
