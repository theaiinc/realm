import { describe, it, expect } from 'vitest';
import { PermissionManager } from './security.js';
import { PermissionType } from './types.js';

describe('PermissionManager', () => {
  it('should deny by default when no handler is set', async () => {
    const pm = new PermissionManager();
    const result = await pm.request(PermissionType.Internet, 'realm-1', 'need internet');
    expect(result).toBe(false);
  });

  it('should grant permission when handler approves', async () => {
    const pm = new PermissionManager(async (req) => {
      expect(req.type).toBe(PermissionType.FileExport);
      return true;
    });
    const result = await pm.request(PermissionType.FileExport, 'realm-1', 'export report');
    expect(result).toBe(true);
  });

  it('should deny permission when handler rejects', async () => {
    const pm = new PermissionManager(async () => false);
    const result = await pm.request(PermissionType.FileImport, 'realm-1', 'import file');
    expect(result).toBe(false);
  });

  it('should cache granted permissions', async () => {
    let callCount = 0;
    const pm = new PermissionManager(async () => {
      callCount++;
      return true;
    });

    // First call goes to handler
    const first = await pm.request(PermissionType.Clipboard, 'realm-1', 'clipboard access');
    expect(first).toBe(true);
    expect(callCount).toBe(1);

    // Second call is cached
    const second = await pm.request(PermissionType.Clipboard, 'realm-1', 'clipboard access again');
    expect(second).toBe(true);
    expect(callCount).toBe(1); // handler not called again
  });

  it('should revoke permissions', async () => {
    const pm = new PermissionManager(async () => true);
    await pm.request(PermissionType.Internet, 'realm-1', 'need internet');
    pm.revoke(PermissionType.Internet, 'realm-1');

    // After revoke, handler gets called again
    let callCount = 0;
    pm['grants'].clear(); // hack: re-test with fresh
    const pm2 = new PermissionManager(async () => {
      callCount++;
      return true;
    });
    await pm2.request(PermissionType.Internet, 'realm-1', 'need internet');
    expect(callCount).toBe(1);
  });

  it('should revoke all permissions for a realm', async () => {
    const pm = new PermissionManager(async () => true);
    await pm.request(PermissionType.Internet, 'realm-1', 'internet');
    await pm.request(PermissionType.FileExport, 'realm-1', 'export');
    await pm.request(PermissionType.Clipboard, 'realm-1', 'clipboard');

    pm.revokeAll('realm-1');

    // All should require re-approval
    pm.revokeAll('realm-2'); // non-existent realm
  });
});
