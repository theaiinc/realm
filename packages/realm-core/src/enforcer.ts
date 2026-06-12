/**
 * CapabilityEnforcer — centralized permission enforcement for Realm operations.
 *
 * This is the SINGLE enforcement point in the entire Realm codebase.
 * Engines are capability-naive — they never know permissions exist.
 *
 * Session owns granted capabilities (set at session creation).
 * PermissionManager checks operations against granted capabilities.
 *
 * If a new operation needs enforcement:
 *   1. Add the operation to the Operation type in types.ts
 *   2. Add the mapping in OPERATION_CAPABILITIES
 *   3. The enforcer handles the rest
 *
 * No engine modification required. Ever.
 */

import type { RealmSession, Operation, PermissionResult } from './types.js';
import { OPERATION_CAPABILITIES } from './types.js';

export function checkCapability(
  session: RealmSession | undefined,
  operation: Operation,
): PermissionResult {
  if (!session) {
    return { allowed: false, reason: 'no_active_session' };
  }

  const required = OPERATION_CAPABILITIES[operation];

  if (session.grantedCapabilities.includes(required)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `missing_capability:${required}`,
  };
}
