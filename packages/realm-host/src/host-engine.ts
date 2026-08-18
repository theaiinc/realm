import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RealmEngine } from '@theaiinc/realm-core';
import { EngineType, RealmError, RealmNotFoundError, RealmState } from '@theaiinc/realm-core';
import type { ActionResult, FileRef, RealmConfig, RealmSession } from '@theaiinc/realm-core';
import { ALLOWED_TARGETS, isAllowedTarget, type HostRealmRecord } from './host-types.js';
import {
  captureAndroidAuto,
  emulatorSerial,
  installApp as installAndroidAutoApp,
  launchAndroidAuto,
  pullFile,
  pushFile,
  setLocation as setAndroidAutoLocation,
  stopAndroidAuto,
  type LaunchResult,
} from './targets/android-auto.js';

const execFileAsync = promisify(execFile);

function notSupported(operation: string): RealmError {
  return new RealmError(
    `${operation} is not supported by realm-host — it is a narrow allowlisted launcher (targets: ${ALLOWED_TARGETS.join(', ')}), not a general host-access engine.`,
    'HOST_OPERATION_NOT_SUPPORTED',
    { operation },
  );
}

/**
 * Homebrew's bin directory isn't on PATH for every process that might run
 * realm-api (a clean login shell on this same machine, e.g., doesn't have
 * it) — resolving `cliclick` by bare name would silently fail depending on
 * how the process was launched. Checks the standard Homebrew locations for
 * both CPU architectures before falling back to bare-name PATH resolution.
 */
function cliclickPath(): string {
  for (const candidate of ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick']) {
    if (existsSync(candidate)) return candidate;
  }
  return 'cliclick';
}

/**
 * HostEngine — a deliberate, narrow exception to this project's
 * "agent never works directly on the host machine" principle
 * (docs/product-design.prd). It can only start/stop/inspect a hardcoded
 * allowlist of host binaries (see host-types.ts); there is no arbitrary
 * execute() and no general host filesystem/clipboard access. See README.md.
 */
export class HostEngine implements RealmEngine {
  readonly type = EngineType.Host;

  private readonly realms = new Map<string, HostRealmRecord>();
  private readonly running = new Map<string, LaunchResult>();

  async create(config: RealmConfig): Promise<string> {
    const target = config.environment?.['HOST_TARGET'];
    if (!isAllowedTarget(target)) {
      throw new RealmError(
        `HOST_TARGET "${target}" is not allowlisted (allowed: ${ALLOWED_TARGETS.join(', ')})`,
        'HOST_TARGET_NOT_ALLOWED',
        { target },
      );
    }

    const realmId = crypto.randomUUID();
    this.realms.set(realmId, {
      target,
      avdName: config.environment?.['AVD_NAME'] ?? 'Pixel_9_Pro',
      cameraBack: config.environment?.['CAMERA_BACK'],
      cameraFront: config.environment?.['CAMERA_FRONT'],
      microphoneHostAudio: config.environment?.['MICROPHONE_HOST_AUDIO'] === 'true',
    });
    return realmId;
  }

  async start(realmId: string): Promise<RealmSession> {
    const record = this.realms.get(realmId);
    if (!record) throw new RealmNotFoundError(realmId);

    // Only one target exists today; this switch is here so adding a second
    // one is additive rather than a rewrite.
    switch (record.target) {
      case 'android-auto': {
        const result = await launchAndroidAuto(record.avdName, {
          cameraBack: record.cameraBack,
          cameraFront: record.cameraFront,
          microphoneHostAudio: record.microphoneHostAudio,
        });
        this.running.set(realmId, result);
        record.emulatorPid = result.emulator.pid;
        record.dhuPid = result.dhu.pid;
        break;
      }
    }

    return {
      id: `session-host-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: new Date().toISOString(),
      grantedCapabilities: [],
    };
  }

  async stop(realmId: string): Promise<void> {
    const result = this.running.get(realmId);
    if (result) {
      stopAndroidAuto(result);
      this.running.delete(realmId);
    }
  }

  async pause(): Promise<void> {
    throw notSupported('pause');
  }

  async resume(): Promise<RealmSession> {
    throw notSupported('resume');
  }

  async destroy(realmId: string): Promise<void> {
    await this.stop(realmId);
    this.realms.delete(realmId);
  }

  async capture(realmId: string): Promise<Buffer> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    return captureAndroidAuto();
  }

  async click(realmId: string, x: number, y: number): Promise<ActionResult> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    // Uses cliclick (MIT, https://github.com/BlueM/cliclick — `brew install
    // cliclick`), not AppleScript's `System Events click at {x,y}`. That
    // command consistently failed with "not allowed assistive access" even
    // after granting Accessibility/Input Monitoring/Screen Recording and a
    // full reboot, while keystroke-based actions (below) worked fine with
    // the same grants — meaning it wasn't a permission problem at all.
    // cliclick posts real CGEvents directly and was verified to land the
    // pointer at the exact requested coordinate and click successfully
    // under the identical permission state where `click at` kept failing.
    return this.runCommand(cliclickPath(), [`c:${Math.round(x)},${Math.round(y)}`]);
  }

  async typeText(realmId: string, text: string): Promise<ActionResult> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return this.runOsascript(`tell application "System Events" to keystroke "${escaped}"`);
  }

  async keyPress(realmId: string, key: string): Promise<ActionResult> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    // Best-effort: single characters go through as a keystroke. Named keys
    // (Return, Tab, Escape, ...) aren't mapped to AppleScript key codes —
    // this is explicitly a stretch goal per the plan, not required to
    // prove the core use case, unlike the container engine's full
    // xdotool-based keyPress.
    const escaped = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return this.runOsascript(`tell application "System Events" to keystroke "${escaped}"`);
  }

  async scroll(): Promise<ActionResult> {
    throw notSupported('scroll');
  }

  async navigate(): Promise<ActionResult> {
    throw notSupported('navigate');
  }

  async execute(): Promise<ActionResult> {
    // The actual security boundary, stated in code: no arbitrary host
    // command execution, ever — not gated behind a flag, not overridable.
    throw notSupported('execute');
  }

  async importFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    await pushFile(emulatorSerial(), sourcePath, destPath);
    const { size } = await stat(sourcePath);
    return { path: destPath, name: path.basename(destPath), sizeBytes: size };
  }

  async exportFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    await pullFile(emulatorSerial(), sourcePath, destPath);
    const { size } = await stat(destPath);
    return { path: destPath, name: path.basename(destPath), sizeBytes: size };
  }

  async listFiles(): Promise<FileRef[]> {
    throw notSupported('listFiles');
  }

  async setLocation(realmId: string, latitude: number, longitude: number): Promise<ActionResult> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    return this.runAction(() => setAndroidAutoLocation(emulatorSerial(), latitude, longitude));
  }

  async installApp(realmId: string, apkPath: string): Promise<ActionResult> {
    if (!this.realms.has(realmId)) throw new RealmNotFoundError(realmId);
    return this.runAction(() => installAndroidAutoApp(emulatorSerial(), apkPath));
  }

  async setNetworkMode(): Promise<void> {
    throw notSupported('setNetworkMode');
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }> {
    return { status: 'healthy', uptimeSec: 0 };
  }

  private async runOsascript(script: string): Promise<ActionResult> {
    return this.runCommand('osascript', ['-e', script]);
  }

  private async runCommand(command: string, args: string[]): Promise<ActionResult> {
    return this.runAction(() => execFileAsync(command, args));
  }

  private async runAction(action: () => Promise<unknown>): Promise<ActionResult> {
    const startTime = Date.now();
    try {
      await action();
      return { success: true, durationMs: Date.now() - startTime, timestamp: new Date().toISOString() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
