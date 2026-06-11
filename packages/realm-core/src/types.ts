/**
 * Core types for the Realm abstraction layer.
 * These types are engine-agnostic — they work the same
 * whether the backing engine is a Container, Browser, or VM.
 */

/** Supported execution engine types */
export enum EngineType {
  Container = 'container',
  Browser = 'browser',
  VM = 'vm',
}

/** Network access levels */
export enum NetworkMode {
  Disabled = 'disabled',
  Restricted = 'restricted',
  Full = 'full',
}

/** Shared folder permission levels */
export enum SharedFolderMode {
  Disabled = 'disabled',
  ReadOnly = 'read-only',
  ReadWrite = 'read-write',
}

/** Realm lifecycle states */
export enum RealmState {
  Stopped = 'stopped',
  Running = 'running',
  Paused = 'paused',
  Error = 'error',
  Destroyed = 'destroyed',
}

/** Permission types that require user approval */
export enum PermissionType {
  Internet = 'internet',
  FileImport = 'file_import',
  FileExport = 'file_export',
  Clipboard = 'clipboard',
  SharedFolder = 'shared_folder',
}

/** Template identifiers */
export enum TemplateType {
  Coding = 'coding',
  Research = 'research',
  DataAnalysis = 'data-analysis',
  Marketing = 'marketing',
  CustomerSupport = 'customer-support',
}

/** A single permission grant */
export interface PermissionGrant {
  type: PermissionType;
  realmId: string;
  detail: string;
  granted: boolean;
  grantedAt?: string;
}

/** Configuration for creating a new Realm */
export interface RealmConfig {
  name: string;
  engine: EngineType;
  template?: TemplateType;
  networkMode?: NetworkMode;
  sharedFolderMode?: SharedFolderMode;
  storageLimitMb?: number;
  environment?: Record<string, string>;
}

/** A file reference within a Realm */
export interface FileRef {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType?: string;
}

/** Result of an action executed in a Realm */
export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
  timestamp: string;
}

/** A Realm's session — the runtime instance */
export interface RealmSession {
  id: string;
  realmId: string;
  state: RealmState;
  startedAt: string;
  stoppedAt?: string;
  metadata?: Record<string, string>;
}

/** A Realm model — the persistent configuration */
export interface Realm {
  id: string;
  name: string;
  engine: EngineType;
  template?: TemplateType;
  config: RealmConfig;
  state: RealmState;
  createdAt: string;
  updatedAt: string;
  currentSession?: RealmSession;
}

/** Audit log entry */
export interface AuditEntry {
  id: string;
  realmId?: string;
  sessionId?: string;
  action: string;
  detail: string;
  success: boolean;
  timestamp: string;
  durationMs?: number;
}

/** Snapshot of realm state */
export interface RealmSnapshot {
  id: string;
  realmId: string;
  name: string;
  createdAt: string;
  sizeBytes?: number;
}

/** Information about a running realm */
export interface RealmInfo {
  id: string;
  name: string;
  engine: EngineType;
  state: RealmState;
  template?: TemplateType;
  uptimeSec?: number;
  activeSession: boolean;
  createdAt: string;
}

/** Health check response from a realm instance */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSec: number;
  activeSessions: number;
  engine: EngineType;
  resources: {
    cpu: number;
    memoryMb: number;
    diskMb: number;
  };
}
