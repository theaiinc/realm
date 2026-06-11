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
  capture(realmId: string): Promise<Buffer>;

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

  /** Set network mode for the realm */
  setNetworkMode(realmId: string, mode: NetworkMode, allowedDomains?: string[]): Promise<void>;

  /** Health check for the engine instance */
  health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }>;
}
