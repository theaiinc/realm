import type {
  RealmConfig,
  RealmSession,
  ActionResult,
  FileRef,
  EngineType,
  NetworkMode,
} from './types.js';

/**
 * RealmEngine — pluggable interface that each execution engine implements.
 *
 * Engines are stateless wrappers around a backing technology (Docker, Playwright, etc.)
 * Realm API layer manages engine selection and lifecycle.
 */
export interface RealmJobSpec {
  command: string;
  cwd?: string;
  timeoutSec?: number;
  env?: Record<string, string>;
}

export type RealmJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface RealmJobStartResult {
  jobId: string;
}

export interface RealmJobResult {
  state: RealmJobState;
  exitCode?: number;
  log: string;
  nextOffset: number;
  startedAt?: string;
  endedAt?: string;
  runtimeSec?: number;
  filesChanged?: number;
}

export interface RealmEngine {
  /** Unique engine type identifier */
  readonly type: EngineType;

  /** Create a new realm environment */
  create(config: RealmConfig): Promise<string>;

  /** Start a realm session */
  start(realmId: string): Promise<RealmSession>;

  /** Stop a running session */
  stop(realmId: string): Promise<void>;

  /** Pause a running session */
  pause(realmId: string): Promise<void>;

  /** Resume a paused session */
  resume(realmId: string): Promise<RealmSession>;

  /** Destroy the realm and clean up resources */
  destroy(realmId: string): Promise<void>;

  /** Capture the current display state (screenshot bytes) */
  capture(realmId: string): Promise<Uint8Array>;

  /** Click at screen coordinates */
  click(realmId: string, x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<ActionResult>;

  /** Type text at the current focus */
  typeText(realmId: string, text: string): Promise<ActionResult>;

  /** Press a keyboard key */
  keyPress(realmId: string, key: string): Promise<ActionResult>;

  /** Scroll the viewport */
  scroll(realmId: string, deltaX: number, deltaY: number): Promise<ActionResult>;

  /** Navigate to a URL (browser engine) */
  navigate(realmId: string, url: string): Promise<ActionResult>;

  /** Execute a command/action in the realm */
  execute(realmId: string, command: string, args?: string[]): Promise<ActionResult>;

  /** Import a file from the host into the realm */
  importFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef>;

  /** Export a file from the realm to the host */
  exportFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef>;

  /** List files in a realm directory */
  listFiles(realmId: string, path: string): Promise<FileRef[]>;

  /** Write a file into the realm workspace, if supported by this engine. */
  putFile(realmId: string, path: string, data: Uint8Array | NodeJS.ReadableStream): Promise<{ path: string; size: number }>;

  /** Read a file from the realm workspace, if supported by this engine. */
  getFile(realmId: string, path: string): Promise<Uint8Array>;

  /** Set network mode for the realm */
  setNetworkMode(realmId: string, mode: NetworkMode, allowedDomains?: string[]): Promise<void>;

  /** Health check for the engine instance */
  health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }>;

  /** Start a long-running job, if supported by this engine. */
  startJob?(realmId: string, spec: RealmJobSpec): Promise<RealmJobStartResult>;

  /** Retrieve a long-running job's status and incremental logs. */
  getJob?(realmId: string, jobId: string, options?: { logOffset?: number }): Promise<RealmJobResult>;

  /** Cancel a long-running job, if supported by this engine. */
  cancelJob?(realmId: string, jobId: string): Promise<void>;

  /**
   * Set mock geolocation for the realm, if the engine supports it (e.g.
   * realm-host's Android Auto target via `adb emu geo fix`). Optional so
   * engines without a device-location concept (container, browser) need no
   * changes — RealmAPI checks for presence before delegating.
   */
  setLocation?(realmId: string, latitude: number, longitude: number): Promise<ActionResult>;

  /**
   * Install an application into the realm from a host-local path, if the
   * engine supports it (e.g. realm-host via `adb install`). Optional for
   * the same reason as setLocation.
   */
  installApp?(realmId: string, apkPath: string): Promise<ActionResult>;
}
