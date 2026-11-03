export type {
  PermissionGrant,
  PermissionEvent,
  RealmConfig,
  RealmSession,
  ActionResult,
  FileRef,
  Realm,
  AuditEntry,
  RealmSnapshot,
  RealmInfo,
  HealthResponse,
  SessionCapability,
  Operation,
  PermissionResult,
} from './types.js';
export {
  EngineType,
  NetworkMode,
  SharedFolderMode,
  RealmState,
  PermissionType,
  TemplateType,
  OPERATION_CAPABILITIES,
} from './types.js';

export type {
  RealmEngine,
  RealmJobSpec,
  RealmJobState,
  RealmJobStartResult,
  RealmJobResult,
} from './engine.js';

export {
  RealmAPI,
  AuditLogger,
  RealmError,
  RealmNotFoundError,
  RealmNotRunningError,
  RealmAlreadyExistsError,
  PermissionDeniedError,
  EngineNotSupportedError,
} from './api.js';

export type { PermissionRequest } from './security.js';
export { PermissionManager } from './security.js';

export { checkCapability } from './enforcer.js';

export { RealmRegistrationClient } from './registration-client.js';
export type { RealmRegistrationClientConfig } from './registration-client.js';

export type { RealmFilesystem, PermissionChecker } from './filesystem.js';

export type {
  PlanId, PlanLimits, PlanLimitsMap, PtyOpenRequest, PtySession, PtyOutput, PtyAdapter,
  ExecRequest, ExecState, ExecAdapter, HostedAuditAction, HostedAuditEvent, AuditSink,
  EgressAuthorizeRequest, EgressDecision, Broker, EgressRule, EgressPolicy,
  EgressCheckRequest, EgressCheckResult, ResourceLimits,
} from './hosted-sandbox.js';
export {
  FREE_PLAN_LIMITS, limitsForPlan, DEFAULT_RESOURCE_LIMITS, assertExecAllowed, checkEgress, validateExecEnv,
} from './hosted-sandbox.js';
export {
  defaultPermissionChecker,
  strictPermissionChecker,
} from './filesystem.js';
