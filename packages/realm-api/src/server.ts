import Fastify from 'fastify';
import cors from '@fastify/cors';
import { RealmAPI, AuditLogger } from '@theaiinc/realm-core';
import type { RealmConfig } from '@theaiinc/realm-core';
import { ContainerEngine } from '@theaiinc/realm-container';
import { BrowserEngine } from '@theaiinc/realm-browser';
import { UbuntuEngine } from '@theaiinc/realm-ubuntu';
import { VeilPipeline } from '@theaiinc/realm-veil';

interface RealmServerOptions {
  port?: number;
  host?: string;
}

export async function createServer(options?: RealmServerOptions) {
  const port = options?.port ?? parseInt(process.env.REALM_PORT ?? '8542', 10);
  const host = options?.host ?? process.env.REALM_HOST ?? '127.0.0.1';

  const auditLogger = new AuditLogger();
  const api = new RealmAPI(auditLogger);
  const veil = new VeilPipeline({ enabled: process.env.REALM_VEIL_ENABLED !== 'false' });

  // Register engines
  api.registerEngine(new ContainerEngine());
  api.registerEngine(new BrowserEngine());
  api.registerEngine(new UbuntuEngine());

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

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

  // Start realm
  app.post<{ Params: { id: string } }>('/api/v1/realms/:id/start', async (request, reply) => {
    try {
      const session = await api.start(request.params.id);
      return { session };
    } catch (error) {
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

  return { app, api, auditLogger, veil };
}

// Run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  createServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
