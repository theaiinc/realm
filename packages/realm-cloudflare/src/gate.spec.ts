import { describe, expect, it } from 'vitest';
import { gateRequest } from './gate';

const TOKEN = 't'.repeat(48);

function request(authorization?: string, path = '/api/v1/realms'): Request {
  return new Request(`https://realm-api.example${path}`, {
    headers: authorization ? { authorization } : {},
  });
}

describe('gateRequest', () => {
  it('fails closed when the Worker has no token', async () => {
    const denied = gateRequest(request(`Bearer ${TOKEN}`), undefined);
    expect(denied?.status).toBe(503);
    expect(gateRequest(request(`Bearer ${TOKEN}`), '   ')?.status).toBe(503);
    expect(gateRequest(request('Bearer short'), 'short')?.status).toBe(503);
  });

  it('rejects missing, malformed and wrong tokens', () => {
    expect(gateRequest(request(), TOKEN)?.status).toBe(401);
    expect(gateRequest(request(TOKEN), TOKEN)?.status).toBe(401);
    expect(gateRequest(request('Bearer '), TOKEN)?.status).toBe(401);
    expect(gateRequest(request(`Bearer ${TOKEN}x`), TOKEN)?.status).toBe(401);
    expect(gateRequest(request(`Bearer ${'u'.repeat(48)}`), TOKEN)?.status).toBe(401);
  });

  it('guards the health check too, so anonymous probes never wake the container', () => {
    expect(gateRequest(request(undefined, '/api/v1/health'), TOKEN)?.status).toBe(401);
  });

  it('lets the exact token through', () => {
    expect(gateRequest(request(`Bearer ${TOKEN}`), TOKEN)).toBeNull();
    expect(gateRequest(request(`bearer ${TOKEN}`), TOKEN)).toBeNull();
  });
});
