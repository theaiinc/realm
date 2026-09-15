import { timingSafeEqual } from 'node:crypto';

/**
 * Access control for realm-api.
 *
 * The API can run shell commands (`/exec`), read and write files
 * (`/import`, `/export`) and drive browsers, so reaching it is the same as
 * holding a shell on the machine. Bound to loopback (the default) that is
 * fine: only the local user can reach it. Bound anywhere else, a bearer
 * token is required and the server refuses to start without one.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const PUBLIC_PATHS = new Set(['/api/v1/health']);
const MIN_TOKEN_LENGTH = 32;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export class ApiTokenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiTokenConfigError';
  }
}

/** The configured token, or undefined when running loopback-only without one. */
export function resolveApiToken(env: Record<string, string | undefined>, host: string): string | undefined {
  const token = env['REALM_API_TOKEN']?.trim();
  if (token) {
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new ApiTokenConfigError(`REALM_API_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    }
    return token;
  }
  if (!isLoopbackHost(host)) {
    throw new ApiTokenConfigError(
      `REALM_API_TOKEN is required when REALM_HOST is ${host}; without it anyone who can reach the port can run commands`,
    );
  }
  return undefined;
}

export function isPublicPath(url: string): boolean {
  const queryStart = url.indexOf('?');
  return PUBLIC_PATHS.has(queryStart === -1 ? url : url.slice(0, queryStart));
}

export function isAuthorized(authorization: string | undefined, token: string): boolean {
  if (!authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match?.[1]) return false;
  const actual = Buffer.from(match[1].trim());
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type ServedEngine = 'container' | 'browser' | 'ubuntu';
const SERVED_ENGINES: readonly ServedEngine[] = ['container', 'browser', 'ubuntu'];

/**
 * Which engines this instance registers. Defaults to all three; a host with
 * no Docker daemon (e.g. Cloudflare Containers) sets REALM_ENGINES=browser so
 * it never advertises engines that cannot start.
 */
export function resolveEngineTypes(value: string | undefined): ServedEngine[] {
  if (!value?.trim()) return [...SERVED_ENGINES];
  const requested = value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const unknown = requested.filter((entry) => !SERVED_ENGINES.includes(entry as ServedEngine));
  if (unknown.length > 0) {
    throw new Error(`REALM_ENGINES has unknown engine(s): ${unknown.join(', ')} (expected ${SERVED_ENGINES.join(', ')})`);
  }
  return [...new Set(requested)] as ServedEngine[];
}
