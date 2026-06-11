/**
 * Filesystem model for Realm.
 *
 * Every realm gets the following structure:
 *   /workspace  — persistent storage (survives restarts)
 *   /input      — files imported from the host (read-only inside realm)
 *   /output     — files ready to export to the host
 *   /tmp        — temporary scratch space
 *
 * Files are copied into the realm (not mounted directly) by default.
 * An optional shared folder can be mounted with explicit permission.
 */

import { PermissionDeniedError } from './api.js';
import { PermissionType } from './types.js';
import type { FileRef } from './types.js';

export interface RealmFilesystem {
  /** The workspace root path inside the realm */
  readonly workspaceRoot: string;

  /** The input directory path */
  readonly inputDir: string;

  /** The output directory path */
  readonly outputDir: string;

  /** List files in a directory */
  listFiles(path: string): Promise<FileRef[]>;

  /** Read file contents */
  readFile(path: string): Promise<Buffer>;

  /** Write file contents */
  writeFile(path: string, content: Buffer): Promise<FileRef>;

  /** Delete a file */
  deleteFile(path: string): Promise<void>;

  /** Check if a path exists */
  exists(path: string): Promise<boolean>;

  /** Get file stats */
  stat(path: string): Promise<{ size: number; isDirectory: boolean; modifiedAt: string }>;
}

export type PermissionChecker = (type: PermissionType, detail: string) => Promise<boolean>;

/**
 * Default permission checker that accepts all (for development).
 * Production should implement a real prompt/approval flow.
 */
export async function defaultPermissionChecker(
  _type: PermissionType,
  _detail: string,
): Promise<boolean> {
  return true;
}

/**
 * Stripped-down permission checker that denies everything.
 */
export async function strictPermissionChecker(
  type: PermissionType,
  detail: string,
): Promise<boolean> {
  throw new PermissionDeniedError(`${type}: ${detail}`);
}
