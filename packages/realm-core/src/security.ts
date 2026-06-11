/**
 * Security model — permission management and access control.
 *
 * Principle: Default Deny
 * Nothing is accessible unless explicitly granted.
 */

import { PermissionType } from './types.js';

interface CachedGrant {
  type: PermissionType;
  realmId: string;
  grantedAt: string;
  expiresAt?: string;
}

export interface PermissionRequest {
  id: string;
  type: PermissionType;
  realmId: string;
  detail: string;
  status: 'pending' | 'granted' | 'denied';
  createdAt: string;
  resolvedAt?: string;
}

/**
 * Manages permissions for a realm instance.
 * Implements the "default deny" model.
 */
export class PermissionManager {
  private readonly grants = new Map<string, CachedGrant[]>();

  constructor(private readonly onRequest?: (request: PermissionRequest) => Promise<boolean>) {}

  /** Request a permission. Returns true if granted. */
  async request(type: PermissionType, realmId: string, detail: string): Promise<boolean> {
    const existing = this.grants.get(realmId) ?? [];
    const alreadyGranted = existing.some(
      (g) => g.type === type && (!g.expiresAt || new Date(g.expiresAt) > new Date()),
    );
    if (alreadyGranted) return true;

    if (!this.onRequest) {
      return false;
    }

    const request: PermissionRequest = {
      id: crypto.randomUUID(),
      type,
      realmId,
      detail,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const granted = await this.onRequest(request);
    request.status = granted ? 'granted' : 'denied';
    request.resolvedAt = new Date().toISOString();

    if (granted) {
      const grants = this.grants.get(realmId) ?? [];
      grants.push({ type, realmId, grantedAt: new Date().toISOString() });
      this.grants.set(realmId, grants);
    }

    return granted;
  }

  /** Revoke a specific permission */
  revoke(type: PermissionType, realmId: string): void {
    const grants = this.grants.get(realmId);
    if (!grants) return;
    this.grants.set(
      realmId,
      grants.filter((g) => g.type !== type),
    );
  }

  /** Revoke all permissions for a realm */
  revokeAll(realmId: string): void {
    this.grants.delete(realmId);
  }
}
