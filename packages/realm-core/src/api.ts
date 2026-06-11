import type { RealmEngine } from './engine.js';
import type {
  RealmConfig,
  RealmSession,
  ActionResult,
  FileRef,
  EngineType,
  AuditEntry,
} from './types.js';

/**
 * Errors thrown by the Realm system.
 */
export class RealmError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RealmError';
  }
}

export class RealmNotFoundError extends RealmError {
  constructor(realmId: string) {
    super(`Realm not found: ${realmId}`, 'REALM_NOT_FOUND', { realmId });
    this.name = 'RealmNotFoundError';
  }
}

export class RealmNotRunningError extends RealmError {
  constructor(realmId: string) {
    super(`Realm is not running: ${realmId}`, 'REALM_NOT_RUNNING', { realmId });
    this.name = 'RealmNotRunningError';
  }
}

export class RealmAlreadyExistsError extends RealmError {
  constructor(name: string) {
    super(`Realm already exists: ${name}`, 'REALM_ALREADY_EXISTS', { name });
    this.name = 'RealmAlreadyExistsError';
  }
}

export class PermissionDeniedError extends RealmError {
  constructor(detail: string) {
    super(`Permission denied: ${detail}`, 'PERMISSION_DENIED', { detail });
    this.name = 'PermissionDeniedError';
  }
}

export class EngineNotSupportedError extends RealmError {
  constructor(engine: EngineType) {
    super(`Engine not supported: ${engine}`, 'ENGINE_NOT_SUPPORTED', { engine });
    this.name = 'EngineNotSupportedError';
  }
}

/**
 * RealmAPI — the main facade for interacting with Realm.
 *
 * Routes calls to the correct engine based on the realm's configuration.
 * Handles cross-cutting concerns: audit logging, permission checks, Veil integration.
 */
export class RealmAPI {
  private readonly engines = new Map<EngineType, RealmEngine>();
  private readonly realms = new Map<string, { realm: RealmConfig; session?: RealmSession }>();

  constructor(private readonly auditLogger: AuditLogger) {}

  /** Register an engine implementation */
  registerEngine(engine: RealmEngine): void {
    this.engines.set(engine.type, engine);
  }

  /** Get the engine for a given type */
  getEngine(type: EngineType): RealmEngine | undefined {
    return this.engines.get(type);
  }

  /** Get all registered engines */
  getEngines(): RealmEngine[] {
    return Array.from(this.engines.values());
  }

  /** Create a new realm */
  async create(config: RealmConfig): Promise<string> {
    const engine = this.engines.get(config.engine);
    if (!engine) {
      throw new EngineNotSupportedError(config.engine);
    }

    // Check for duplicate name across all stored realms
    const nameExists = Array.from(this.realms.values()).some(
      (entry) => entry.realm.name === config.name,
    );
    if (nameExists) {
      throw new RealmAlreadyExistsError(config.name);
    }

    const realmId = await engine.create(config);
    this.realms.set(realmId, { realm: config });

    await this.auditLogger.log({
      action: 'realm.create',
      detail: `Created ${config.engine} realm: ${config.name}`,
      success: true,
    });

    return realmId;
  }

  /** Start a realm session */
  async start(realmId: string): Promise<RealmSession> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const session = await engine.start(realmId);
    entry.session = session;

    await this.auditLogger.log({
      action: 'realm.start',
      detail: `Started realm: ${realmId}`,
      success: true,
    });

    return session;
  }

  /** Stop a realm session */
  async stop(realmId: string): Promise<void> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    await engine.stop(realmId);
    entry.session = undefined;

    await this.auditLogger.log({
      action: 'realm.stop',
      detail: `Stopped realm: ${realmId}`,
      success: true,
    });
  }

  /** Pause a realm session */
  async pause(realmId: string): Promise<void> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    await engine.pause(realmId);

    await this.auditLogger.log({
      action: 'realm.pause',
      detail: `Paused realm: ${realmId}`,
      success: true,
    });
  }

  /** Resume a paused realm */
  async resume(realmId: string): Promise<RealmSession> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const session = await engine.resume(realmId);
    entry.session = session;

    await this.auditLogger.log({
      action: 'realm.resume',
      detail: `Resumed realm: ${realmId}`,
      success: true,
    });

    return session;
  }

  /** Destroy a realm */
  async destroy(realmId: string): Promise<void> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    await engine.destroy(realmId);
    this.realms.delete(realmId);

    await this.auditLogger.log({
      action: 'realm.destroy',
      detail: `Destroyed realm: ${realmId}`,
      success: true,
    });
  }

  /** Capture screenshot from realm */
  async capture(realmId: string): Promise<Buffer> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const screenshot = await engine.capture(realmId);

    await this.auditLogger.log({
      action: 'realm.capture',
      detail: `Captured screenshot: ${realmId}`,
      success: true,
    });

    return screenshot;
  }

  /** Click at coordinates */
  async click(realmId: string, x: number, y: number): Promise<ActionResult> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const result = await engine.click(realmId, x, y);

    await this.auditLogger.log({
      action: 'realm.click',
      detail: `Click at (${x}, ${y}) in realm: ${realmId}`,
      success: result.success,
    });

    return result;
  }

  /** Navigate to a URL */
  async navigate(realmId: string, url: string): Promise<ActionResult> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const result = await engine.navigate(realmId, url);

    await this.auditLogger.log({
      action: 'realm.navigate',
      detail: `Navigated to ${url.substring(0, 200)} in realm: ${realmId}`,
      success: result.success,
    });

    return result;
  }

  /** Type text */
  async type(realmId: string, text: string): Promise<ActionResult> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const result = await engine.typeText(realmId, text);

    await this.auditLogger.log({
      action: 'realm.type',
      detail: `Typed ${text.length} chars in realm: ${realmId}`,
      success: result.success,
    });

    return result;
  }

  /** Execute a command */
  async execute(realmId: string, command: string): Promise<ActionResult> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const result = await engine.execute(realmId, command);

    await this.auditLogger.log({
      action: 'realm.execute',
      detail: `Executed: ${command.substring(0, 100)} in realm: ${realmId}`,
      success: result.success,
    });

    return result;
  }

  /** Import a file */
  async importFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const fileRef = await engine.importFile(realmId, sourcePath, destPath);

    await this.auditLogger.log({
      action: 'realm.import',
      detail: `Imported ${sourcePath} → ${destPath} in realm: ${realmId}`,
      success: true,
    });

    return fileRef;
  }

  /** Export a file */
  async exportFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    const entry = this.realms.get(realmId);
    if (!entry) throw new RealmNotFoundError(realmId);

    const engine = this.engines.get(entry.realm.engine);
    if (!engine) throw new EngineNotSupportedError(entry.realm.engine);

    const fileRef = await engine.exportFile(realmId, sourcePath, destPath);

    await this.auditLogger.log({
      action: 'realm.export',
      detail: `Exported ${sourcePath} → ${destPath} from realm: ${realmId}`,
      success: true,
    });

    return fileRef;
  }

  /** List realms */
  listRealms(): Array<{ id: string; config: RealmConfig; session?: RealmSession }> {
    return Array.from(this.realms.entries()).map(([id, entry]) => ({
      id,
      config: entry.realm,
      session: entry.session,
    }));
  }

  /** Get a specific realm */
  getRealm(realmId: string): { id: string; config: RealmConfig; session?: RealmSession } | undefined {
    const entry = this.realms.get(realmId);
    if (!entry) return undefined;
    return { id: realmId, config: entry.realm, session: entry.session };
  }

  /** Get the audit trail */
  getAuditLog(): AuditEntry[] {
    return this.auditLogger.getEntries();
  }
}

/**
 * AuditLogger — records every action for compliance and debugging.
 */
export class AuditLogger {
  private entries: AuditEntry[] = [];

  /** Log a new audit entry */
  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const auditEntry: AuditEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.entries.push(auditEntry);
    return auditEntry;
  }

  /** Get all audit entries */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /** Query entries by realm */
  getEntriesByRealm(realmId: string): AuditEntry[] {
    return this.entries.filter((e) => e.realmId === realmId);
  }

  /** Query entries by action */
  getEntriesByAction(action: string): AuditEntry[] {
    return this.entries.filter((e) => e.action === action);
  }

  /** Clear all entries */
  clear(): void {
    this.entries = [];
  }
}
