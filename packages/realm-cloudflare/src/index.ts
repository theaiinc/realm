import { Container } from '@cloudflare/containers';
import { gateRequest } from './gate';

const REALM_PORT = 8542;
// One realm-api instance holds every realm in memory; routing every request
// to the same named instance keeps a realm created by one call visible to
// the next. More instances would each hold a disjoint set of realms.
const INSTANCE_NAME = 'realm';

export interface Env {
  REALM: DurableObjectNamespace<RealmContainer>;
  REALM_API_TOKEN?: string;
  REALM_ENGINES?: string;
  REALM_SLEEP_AFTER?: string;
}

export class RealmContainer extends Container<Env> {
  defaultPort = REALM_PORT;
  // Realms live in the container's memory, so sleeping discards them. Long
  // enough to survive a working session, short enough not to bill all night.
  sleepAfter = '30m';

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    if (env.REALM_SLEEP_AFTER?.trim()) this.sleepAfter = env.REALM_SLEEP_AFTER.trim();
    this.envVars = {
      REALM_HOST: '0.0.0.0',
      REALM_PORT: String(REALM_PORT),
      // No Docker daemon inside a Cloudflare container: only the browser
      // engine can actually start here.
      REALM_ENGINES: env.REALM_ENGINES?.trim() || 'browser',
      REALM_API_TOKEN: env.REALM_API_TOKEN?.trim() ?? '',
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const denied = gateRequest(request, env.REALM_API_TOKEN);
    if (denied) return denied;
    return env.REALM.getByName(INSTANCE_NAME).fetch(request);
  },
} satisfies ExportedHandler<Env>;
