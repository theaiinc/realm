import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserEngine } from './browser-engine.js';
import type { RealmConfig } from '@theaiinc/realm-core';
import { EngineType } from '@theaiinc/realm-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('playwright', () => {
  const mockPage = {
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    },
    evaluate: vi.fn().mockResolvedValue({ success: true, data: 'eval-result' }),
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue('<html><body>test</body></html>'),
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockContext = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    browser: vi.fn().mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    }),
  };

  return {
    chromium: {
      launchPersistentContext: vi.fn().mockResolvedValue(mockContext),
    },
  };
});

describe('BrowserEngine', () => {
  let engine: BrowserEngine;
  const testDataDir = path.join(process.cwd(), '.test-realm-data');

  beforeEach(() => {
    engine = new BrowserEngine({ dataDir: testDataDir });
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test data
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  it('should have the correct type', () => {
    expect(engine.type).toBe(EngineType.Browser);
  });

  it('should create a realm', async () => {
    const config: RealmConfig = {
      name: 'test-browser',
      engine: EngineType.Browser,
    };
    const id = await engine.create(config);
    expect(id).toContain('browser-test-browser');
  });

  it('should start a browser realm', async () => {
    const config: RealmConfig = { name: 'start-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    const session = await engine.start(id);
    expect(session.state).toBe('running');
  });

  it('should stop a browser realm', async () => {
    const config: RealmConfig = { name: 'stop-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    await expect(engine.stop(id)).resolves.toBeUndefined();
  });

  it('should capture a screenshot', async () => {
    const config: RealmConfig = { name: 'capture-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    const screenshot = await engine.capture(id);
    expect(screenshot.toString()).toBe('fake-screenshot');
  });

  it('should click at coordinates', async () => {
    const config: RealmConfig = { name: 'click-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    const result = await engine.click(id, 100, 200);
    expect(result.success).toBe(true);
  });

  it('should type text', async () => {
    const config: RealmConfig = { name: 'type-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    const result = await engine.typeText(id, 'hello');
    expect(result.success).toBe(true);
  });

  it('should keypress', async () => {
    const config: RealmConfig = { name: 'key-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    const result = await engine.keyPress(id, 'Enter');
    expect(result.success).toBe(true);
  });

  it('should scroll', async () => {
    const config: RealmConfig = { name: 'scroll-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    const result = await engine.scroll(id, 0, 100);
    expect(result.success).toBe(true);
  });

  it('should navigate to a URL', async () => {
    const config: RealmConfig = { name: 'nav-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    const result = await (engine as any).navigate(id, 'https://example.com');
    expect(result.success).toBe(true);
  });

  it('should get DOM snapshot', async () => {
    const config: RealmConfig = { name: 'dom-test', engine: EngineType.Browser };
    const id = await engine.create(config);
    await engine.start(id);
    const result = await (engine as any).getDomSnapshot(id);
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('html');
  });

  it('should return health status', async () => {
    const health = await engine.health();
    expect(health.status).toBe('healthy');
  });

  it('should fail on non-existent realm', async () => {
    await expect(engine.start('fake-id')).rejects.toThrow(/not found/);
  });
});
