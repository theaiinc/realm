import Fastify from 'fastify';
import cors from '@fastify/cors';
import { RealmAPI, AuditLogger, PermissionDeniedError, RealmRegistrationClient } from '@theaiinc/realm-core';
import type { RealmConfig, SessionCapability, RealmRegistrationClientConfig } from '@theaiinc/realm-core';
import { ContainerEngine } from '@theaiinc/realm-container';
import { BrowserEngine } from '@theaiinc/realm-browser';
import { UbuntuEngine } from '@theaiinc/realm-ubuntu';
import { HostEngine } from '@theaiinc/realm-host';
import { DockerSandboxEngine } from '@theaiinc/realm-sandbox';
import { VeilPipeline } from '@theaiinc/realm-veil';
import { isAuthorized, isPublicPath, resolveApiToken, resolveEngineTypes } from './auth.js';

interface RealmServerOptions {
  port?: number;
  host?: string;
  /** Registration config for announcing this realm to Yggdrasil via Ratatoskr. */
  registration?: RealmRegistrationClientConfig;
}

export async function createServer(options?: RealmServerOptions) {
  const port = options?.port ?? parseInt(process.env.REALM_PORT ?? '8542', 10);
  const host = options?.host ?? process.env.REALM_HOST ?? '127.0.0.1';

  const auditLogger = new AuditLogger();
  const api = new RealmAPI(auditLogger);
  const veil = new VeilPipeline({ enabled: process.env.REALM_VEIL_ENABLED !== 'false' });

  // Fail closed before anything is registered: a non-loopback bind without a
  // token would hand /exec to anyone who can reach the port. See auth.ts.
  const apiToken = resolveApiToken(process.env, host);

  // Register engines (REALM_ENGINES narrows this on hosts without Docker)
  const engineTypes = resolveEngineTypes(process.env.REALM_ENGINES);
  if (engineTypes.includes('container')) api.registerEngine(new ContainerEngine());
  if (engineTypes.includes('browser')) api.registerEngine(new BrowserEngine());
  if (engineTypes.includes('ubuntu')) api.registerEngine(new UbuntuEngine());

  // HostEngine is a deliberate, narrow exception to "agent never works
  // directly on the host machine" (docs/product-design.prd) — see
  // packages/realm-host/README.md. Gated behind an explicit opt-in so the
  // capability isn't silently available on every realm-api instance.
  if (process.env.ENABLE_HOST_ENGINE === 'true') {
    api.registerEngine(new HostEngine());
    console.warn('[realm-api] ENABLE_HOST_ENGINE=true — HostEngine registered (host process access, see packages/realm-host/README.md)');
  }

  // DockerSandboxEngine needs the sbx CLI signed in to Docker on this host,
  // and cloud sandboxes bill per second: opt in explicitly.
  if (process.env.ENABLE_DOCKER_SANDBOX_ENGINE === 'true') {
    api.registerEngine(new DockerSandboxEngine());
    console.warn('[realm-api] ENABLE_DOCKER_SANDBOX_ENGINE=true — DockerSandboxEngine registered (sbx CLI; cloud sandboxes bill per second)');
  }

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  if (apiToken) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.method === 'OPTIONS' || isPublicPath(request.url)) return;
      if (!isAuthorized(request.headers.authorization, apiToken)) {
        return reply.status(401).send({ error: 'Authentication required' });
      }
    });
  }

  // Health check
  app.get('/api/v1/health', async () => ({
    status: 'healthy',
    version: '0.1.0',
    uptime: process.uptime(),
    engines: api.getEngines().map((e) => e.type),
    veilEnabled: veil.isEnabled(),
  }));

  // List realms
  app.get('/api/v1/realms', async () => {
    return { realms: api.listRealms() };
  });

  // Get realm
  app.get<{ Params: { id: string } }>('/api/v1/realms/:id', async (request, reply) => {
    const realm = api.getRealm(request.params.id);
    if (!realm) {
      return reply.status(404).send({ error: 'Realm not found' });
    }
    return { realm };
  });

  // Create realm
  app.post<{ Body: RealmConfig }>('/api/v1/realms', async (request, reply) => {
    try {
      const id = await api.create(request.body);
      return reply.status(201).send({ id });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Start realm (accepts optional capabilities)
  app.post<{
    Params: { id: string };
    Body: { capabilities?: SessionCapability[] };
  }>('/api/v1/realms/:id/start', async (request, reply) => {
    try {
      const session = await api.start(request.params.id, request.body.capabilities);
      return { session };
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return reply.status(403).send({
          error: error.message,
          code: error.code,
        });
      }
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Stop realm
  app.post<{ Params: { id: string } }>('/api/v1/realms/:id/stop', async (request, reply) => {
    try {
      await api.stop(request.params.id);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Destroy realm
  app.delete<{ Params: { id: string } }>('/api/v1/realms/:id', async (request, reply) => {
    try {
      await api.destroy(request.params.id);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Capture screenshot
  app.get<{ Params: { id: string } }>('/api/v1/realms/:id/capture', async (request, reply) => {
    try {
      const buffer = await api.capture(request.params.id);
      const redacted = await veil.processText(buffer.toString('base64'));
      return reply.type('application/json').send({
        screenshot: redacted.data,
        piiRedacted: redacted.cleaned,
      });
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return reply.status(403).send({
          error: error.message,
          code: error.code,
        });
      }
      return reply.status(400).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Click
  app.post<{ Params: { id: string }; Body: { x: number; y: number } }>(
    '/api/v1/realms/:id/click',
    async (request, reply) => {
      try {
        const result = await api.click(request.params.id, request.body.x, request.body.y);
        return result;
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          return reply.status(403).send({
            error: error.message,
            code: error.code,
          });
        }
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Navigate
  app.post<{ Params: { id: string }; Body: { url: string } }>(
    '/api/v1/realms/:id/navigate',
    async (request, reply) => {
      try {
        const result = await api.navigate(request.params.id, request.body.url);
        return result;
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          return reply.status(403).send({
            error: error.message,
            code: error.code,
          });
        }
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Type
  app.post<{ Params: { id: string }; Body: { text: string } }>(
    '/api/v1/realms/:id/type',
    async (request, reply) => {
      try {
        const result = await api.type(request.params.id, request.body.text);
        return result;
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          return reply.status(403).send({
            error: error.message,
            code: error.code,
          });
        }
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Key press
  app.post<{ Params: { id: string }; Body: { key: string } }>(
    '/api/v1/realms/:id/keyPress',
    async (request, reply) => {
      try {
        const result = await api.keyPress(request.params.id, request.body.key);
        return result;
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          return reply.status(403).send({
            error: error.message,
            code: error.code,
          });
        }
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Scroll
  app.post<{ Params: { id: string }; Body: { deltaX: number; deltaY: number } }>(
    '/api/v1/realms/:id/scroll',
    async (request, reply) => {
      try {
        const result = await api.scroll(request.params.id, request.body.deltaX, request.body.deltaY);
        return result;
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          return reply.status(403).send({
            error: error.message,
            code: error.code,
          });
        }
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Execute
  app.post<{ Params: { id: string }; Body: { command: string } }>(
    '/api/v1/realms/:id/exec',
    async (request, reply) => {
      try {
        const result = await api.execute(request.params.id, request.body.command);
        return result;
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Set location (only realms whose engine supports RealmEngine.setLocation, e.g. realm-host)
  app.post<{ Params: { id: string }; Body: { latitude: number; longitude: number } }>(
    '/api/v1/realms/:id/location',
    async (request, reply) => {
      try {
        const result = await api.setLocation(request.params.id, request.body.latitude, request.body.longitude);
        return result;
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Install an app (only realms whose engine supports RealmEngine.installApp, e.g. realm-host)
  app.post<{ Params: { id: string }; Body: { apkPath: string } }>(
    '/api/v1/realms/:id/install',
    async (request, reply) => {
      try {
        const result = await api.installApp(request.params.id, request.body.apkPath);
        return result;
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Import file
  app.post<{ Params: { id: string }; Body: { sourcePath: string; destPath: string } }>(
    '/api/v1/realms/:id/import',
    async (request, reply) => {
      try {
        const result = await api.importFile(request.params.id, request.body.sourcePath, request.body.destPath);
        return result;
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Export file
  app.post<{ Params: { id: string }; Body: { sourcePath: string; destPath: string } }>(
    '/api/v1/realms/:id/export',
    async (request, reply) => {
      try {
        const result = await api.exportFile(request.params.id, request.body.sourcePath, request.body.destPath);
        return result;
      } catch (error) {
        return reply.status(400).send({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  // Get audit log
  app.get('/api/v1/audit', async () => {
    return { entries: api.getAuditLog() };
  });

  // Get audit log for a specific realm
  app.get<{ Params: { id: string } }>('/api/v1/realms/:id/audit', async (request) => {
    const entries = auditLogger.getEntries().filter((e) => e.realmId === request.params.id);
    return { entries };
  });

  // Start server
  const address = await app.listen({ port, host });
  app.log.info(`Realm API server listening on ${address}`);

  // ── Registration with Yggdrasil (via Ratatoskr) ──────────────────
  let registrationClient: RealmRegistrationClient | undefined;

  if (options?.registration) {
    registrationClient = new RealmRegistrationClient(options.registration);
    await registrationClient.start();
    app.log.info(
      `Realm registered with Yggdrasil via Ratatoskr at ${options.registration.ratatoskrUrl}`,
    );
  } else {
    // Fallback: try environment variables
    const ratatoskrUrl = process.env['RATATOSKR_URL'];
    const realmId = process.env['REALM_ID'];
    const runnerId = process.env['RUNNER_ID'];
    const realmBaseUrl = process.env['REALM_BASE_URL'];

    if (ratatoskrUrl && realmId && runnerId && realmBaseUrl) {
      registrationClient = new RealmRegistrationClient({
        realmId,
        runnerId,
        ratatoskrUrl,
        template: process.env['REALM_TEMPLATE'] ?? 'ubuntu',
        realmBaseUrl,
        version: process.env['REALM_VERSION'] ?? '0.1.0',
        capabilities: (process.env['REALM_CAPABILITIES'] ?? '').split(',').filter(Boolean),
        registrationToken: process.env['REALM_REGISTRATION_TOKEN'],
        heartbeatIntervalMs: parseInt(process.env['REALM_HEARTBEAT_INTERVAL_MS'] ?? '30000', 10),
      });
      await registrationClient.start();
      app.log.info(`Realm registered with Yggdrasil via Ratatoskr at ${ratatoskrUrl}`);
    } else {
      app.log.warn('No registration config provided — realm will not announce itself to Yggdrasil');
    }
  }

  // ── Graceful shutdown ─────────────────────────────────────────────
  const shutdown = async () => {
    app.log.info('Shutting down...');
    if (registrationClient) {
      await registrationClient.stop();
    }
    await app.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, api, auditLogger, veil, registrationClient };
}

// Run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  createServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
