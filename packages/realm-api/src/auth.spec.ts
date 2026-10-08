import { describe, expect, it } from 'vitest';
import { isAuthorized, isLoopbackHost, isPublicPath, resolveApiToken, resolveEngineTypes } from './auth';

const TOKEN = 'a'.repeat(40);

describe('resolveApiToken', () => {
  it('allows no token on loopback', () => {
    expect(resolveApiToken({}, '127.0.0.1')).toBeUndefined();
    expect(resolveApiToken({}, 'localhost')).toBeUndefined();
    expect(resolveApiToken({}, '::1')).toBeUndefined();
  });

  it('refuses to start on a public interface without a token', () => {
    expect(() => resolveApiToken({}, '0.0.0.0')).toThrow(/REALM_API_TOKEN is required/);
    expect(() => resolveApiToken({ REALM_API_TOKEN: '   ' }, '0.0.0.0')).toThrow(/REALM_API_TOKEN is required/);
  });

  it('rejects a short token', () => {
    expect(() => resolveApiToken({ REALM_API_TOKEN: 'short' }, '0.0.0.0')).toThrow(/at least 32/);
  });

  it('returns the trimmed token', () => {
    expect(resolveApiToken({ REALM_API_TOKEN: ` ${TOKEN} ` }, '0.0.0.0')).toBe(TOKEN);
  });
});

describe('isAuthorized', () => {
  it('accepts only the exact bearer token', () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(undefined, TOKEN)).toBe(false);
    expect(isAuthorized('Bearer ', TOKEN)).toBe(false);
    expect(isAuthorized(TOKEN, TOKEN)).toBe(false);
    expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isAuthorized(`Bearer ${'b'.repeat(40)}`, TOKEN)).toBe(false);
  });
});

describe('isPublicPath', () => {
  it('exposes only the health check', () => {
    expect(isPublicPath('/api/v1/health')).toBe(true);
    expect(isPublicPath('/api/v1/health?probe=1')).toBe(true);
    expect(isPublicPath('/api/v1/realms')).toBe(false);
    expect(isPublicPath('/api/v1/health/../realms')).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it('treats only loopback names as local', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('10.0.0.5')).toBe(false);
  });
});

describe('resolveEngineTypes', () => {
  it('defaults to every engine', () => {
    expect(resolveEngineTypes(undefined)).toEqual(['container', 'browser', 'ubuntu']);
    expect(resolveEngineTypes('')).toEqual(['container', 'browser', 'ubuntu']);
  });

  it('narrows to the listed engines', () => {
    expect(resolveEngineTypes('browser')).toEqual(['browser']);
    expect(resolveEngineTypes(' Browser , container,browser')).toEqual(['browser', 'container']);
  });

  it('rejects unknown engines', () => {
    expect(() => resolveEngineTypes('browser,vm')).toThrow(/unknown engine\(s\): vm/);
  });
});
