/**
 * The Worker's own check, in front of the container. realm-api checks the
 * same token itself; checking here as well means an unauthenticated request
 * never wakes (and bills) the container, and a missing secret fails closed
 * instead of starting a server that would refuse to boot anyway.
 */

const encoder = new TextEncoder();

function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!;
  return diff === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** A response to return instead of forwarding, or null when the request may reach realm-api. */
export function gateRequest(request: Request, configuredToken: string | undefined): Response | null {
  const token = configuredToken?.trim();
  if (!token || token.length < 32) {
    return json(503, { error: 'REALM_API_TOKEN is not configured on this Worker' });
  }
  const presented = bearerToken(request.headers.get('authorization'));
  if (!presented || !constantTimeEqual(presented, token)) {
    return json(401, { error: 'Authentication required' });
  }
  return null;
}
