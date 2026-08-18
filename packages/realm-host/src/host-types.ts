/**
 * Hardcoded allowlist of host targets HostEngine may launch. This is the
 * actual security boundary — not configuration, deliberately not
 * extensible via RealmConfig. Adding a new target means adding code here
 * and in host-engine.ts, not passing a new string through the API.
 */
export const ALLOWED_TARGETS = ['android-auto'] as const;
export type HostTargetId = (typeof ALLOWED_TARGETS)[number];

export function isAllowedTarget(value: string | undefined): value is HostTargetId {
  return !!value && (ALLOWED_TARGETS as readonly string[]).includes(value);
}

/** Internal bookkeeping for a created-but-maybe-not-started host realm. */
export interface HostRealmRecord {
  target: HostTargetId;
  avdName: string;
  // Launch-time only (see LaunchOptions in targets/android-auto.ts) — the
  // emulator has no known runtime hot-swap for camera backend, unlike
  // location/app-install which are genuinely dynamic.
  cameraBack?: string;
  cameraFront?: string;
  // See LaunchOptions.microphoneHostAudio in targets/android-auto.ts for why
  // this is a launch-time toggle (host mic passthrough) rather than a
  // dynamic file-injection API.
  microphoneHostAudio?: boolean;
  emulatorPid?: number;
  dhuPid?: number;
}
