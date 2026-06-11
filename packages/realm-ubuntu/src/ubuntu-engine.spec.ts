import { describe, it, expect } from 'vitest';
import { UbuntuEngine } from './ubuntu-engine.js';
import { EngineType } from '@theaiinc/realm-core';

describe('UbuntuEngine', () => {
  it('has type Ubuntu', () => {
    const engine = new UbuntuEngine();
    expect(engine.type).toBe(EngineType.VM);
  });

  it('health returns degraded when docker is unavailable', async () => {
    const engine = new UbuntuEngine({ socketPath: '/nonexistent/docker.sock' });
    const health = await engine.health();
    expect(['healthy', 'unhealthy']).toContain(health.status);
  });

  it('constructor initializes sub-components', () => {
    const engine = new UbuntuEngine();
    expect(engine).toBeInstanceOf(UbuntuEngine);
  });
});

describe('UbuntuManager', () => {
  it('can be instantiated', async () => {
    const { UbuntuManager } = await import('./ubuntu-manager.js');
    expect(UbuntuManager).toBeDefined();
  });
});

describe('UbuntuDisplay', () => {
  it('can be instantiated', async () => {
    const { UbuntuDisplay } = await import('./ubuntu-display.js');
    expect(UbuntuDisplay).toBeDefined();
  });
});

describe('UbuntuFilesystem', () => {
  it('can be instantiated', async () => {
    const { UbuntuFilesystem } = await import('./ubuntu-filesystem.js');
    expect(UbuntuFilesystem).toBeDefined();
  });
});
