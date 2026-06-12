import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type {
  RealmConfig,
  RealmSession,
  ActionResult,
  FileRef,
  NetworkMode,
} from '@theaiinc/realm-core';
import { RealmState, EngineType } from '@theaiinc/realm-core';
import type { RealmEngine } from '@theaiinc/realm-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

interface BrowserRealmState {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  config: RealmConfig;
  startedAt?: string;
  downloadDir: string;
}

/**
 * BrowserEngine — RealmEngine implementation backed by Playwright/Chromium.
 *
 * Each realm is an isolated browser context with its own profile,
 * cookies, storage, and session persistence.
 */
export class BrowserEngine implements RealmEngine {
  readonly type = EngineType.Browser;

  private readonly realms = new Map<string, BrowserRealmState>();
  private readonly dataDir: string;

  constructor(options?: { dataDir?: string }) {
    this.dataDir = options?.dataDir ?? path.join(process.cwd(), '.realm-data', 'browser');
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  async create(config: RealmConfig): Promise<string> {
    const realmId = `browser-${config.name}-${Date.now()}`;
    const downloadDir = path.join(this.dataDir, realmId, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });

    this.realms.set(realmId, {
      config,
      downloadDir,
    });

    return realmId;
  }

  async start(realmId: string): Promise<RealmSession> {
    const state = this.realms.get(realmId);
    if (!state) throw new Error(`Browser realm not found: ${realmId}`);

    const userDataDir = path.join(this.dataDir, realmId, 'profile');
    fs.mkdirSync(userDataDir, { recursive: true });

    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      downloadsPath: state.downloadDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    state.browser = browser.browser() ?? undefined;
    state.context = browser;
    state.page = await browser.newPage();
    state.startedAt = new Date().toISOString();

    return {
      id: `session-${realmId}`,
      realmId,
      state: RealmState.Running,
      startedAt: state.startedAt,
      grantedCapabilities: [],
    };
  }

  async stop(realmId: string): Promise<void> {
    const state = this.realms.get(realmId);
    if (!state) return;

    if (state.context) {
      await state.context.close().catch(() => {});
    }
    if (state.browser) {
      await state.browser.close().catch(() => {});
    }
    state.context = undefined;
    state.browser = undefined;
    state.page = undefined;
    state.startedAt = undefined;
  }

  async pause(_realmId: string): Promise<void> {
    // Browser contexts don't have a native pause.
    // We just leave it idle. The page stays open.
  }

  async resume(realmId: string): Promise<RealmSession> {
    const state = this.realms.get(realmId);
    if (!state) throw new Error(`Browser realm not found: ${realmId}`);

    if (state.page) {
      return {
        id: `session-${realmId}`,
        realmId,
        state: RealmState.Running,
        startedAt: state.startedAt ?? new Date().toISOString(),
        grantedCapabilities: [],
      };
    }

    // If page was closed, restart
    return this.start(realmId);
  }

  async destroy(realmId: string): Promise<void> {
    await this.stop(realmId);
    this.realms.delete(realmId);

    // Clean up data directory
    const realmDir = path.join(this.dataDir, realmId);
    fs.rmSync(realmDir, { recursive: true, force: true });
  }

  async capture(realmId: string): Promise<Buffer> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const screenshot = await state.page.screenshot({ type: 'png', fullPage: false });
    return Buffer.from(screenshot);
  }

  async click(realmId: string, x: number, y: number): Promise<ActionResult> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const startTime = Date.now();
    try {
      await state.page.mouse.click(x, y);
      return {
        success: true,
        data: { x, y },
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async typeText(realmId: string, text: string): Promise<ActionResult> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const startTime = Date.now();
    try {
      await state.page.keyboard.type(text);
      return {
        success: true,
        data: { length: text.length },
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async keyPress(realmId: string, key: string): Promise<ActionResult> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const startTime = Date.now();
    try {
      await state.page.keyboard.press(key);
      return { success: true, durationMs: Date.now() - startTime, timestamp: new Date().toISOString() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async scroll(realmId: string, deltaX: number, deltaY: number): Promise<ActionResult> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const startTime = Date.now();
    try {
      await state.page.mouse.wheel(deltaX, deltaY);
      return { success: true, durationMs: Date.now() - startTime, timestamp: new Date().toISOString() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async execute(realmId: string, command: string): Promise<ActionResult> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const startTime = Date.now();
    try {
      const result = await state.page.evaluate(`(function() { return (${command}); })()`);
      return {
        success: true,
        data: result,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async navigate(realmId: string, url: string): Promise<ActionResult> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const startTime = Date.now();
    try {
      await state.page.goto(url, { waitUntil: 'networkidle' });
      return {
        success: true,
        data: { url: state.page.url(), title: await state.page.title() },
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async getDomSnapshot(realmId: string): Promise<ActionResult> {
    const state = this.realms.get(realmId);
    if (!state?.page) throw new Error(`Browser realm not running: ${realmId}`);

    const startTime = Date.now();
    try {
      const html = await state.page.content();
      return {
        success: true,
        data: { html, url: state.page.url() },
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  async importFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    const state = this.realms.get(realmId);
    if (!state) throw new Error(`Browser realm not found: ${realmId}`);

    const downloadDir = state.downloadDir;
    const dest = path.join(downloadDir, path.basename(destPath));
    await fs.promises.copyFile(sourcePath, dest);
    const stat = await fs.promises.stat(dest);

    return {
      path: dest,
      name: path.basename(destPath),
      sizeBytes: stat.size,
    };
  }

  async exportFile(realmId: string, sourcePath: string, destPath: string): Promise<FileRef> {
    const state = this.realms.get(realmId);
    if (!state) throw new Error(`Browser realm not found: ${realmId}`);

    const downloadDir = state.downloadDir;
    const source = path.join(downloadDir, path.basename(sourcePath));
    await fs.promises.copyFile(source, destPath);
    const stat = await fs.promises.stat(destPath);

    return {
      path: destPath,
      name: path.basename(destPath),
      sizeBytes: stat.size,
    };
  }

  async listFiles(realmId: string, dirPath: string): Promise<FileRef[]> {
    const state = this.realms.get(realmId);
    if (!state) throw new Error(`Browser realm not found: ${realmId}`);

    const files: FileRef[] = [];
    const dir = path.join(state.downloadDir, dirPath);
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const stat = await fs.promises.stat(path.join(dir, entry.name));
          files.push({
            path: path.join(dirPath, entry.name),
            name: entry.name,
            sizeBytes: stat.size,
          });
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    return files;
  }

  async setNetworkMode(realmId: string, mode: NetworkMode, allowedDomains?: string[]): Promise<void> {
    const state = this.realms.get(realmId);
    if (!state) throw new Error(`Browser realm not found: ${realmId}`);

    if (state.context && mode === 'restricted' && allowedDomains?.length) {
      // Set up request interception for domain allowlisting
      await state.context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (allowedDomains?.some((d) => url.hostname.endsWith(d))) {
          route.continue();
        } else {
          route.abort('blockedbyclient');
        }
      });
    }
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; uptimeSec: number }> {
    return {
      status: 'healthy',
      uptimeSec: process.uptime(),
    };
  }
}
