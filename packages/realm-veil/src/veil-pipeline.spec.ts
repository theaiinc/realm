import { describe, it, expect, beforeEach } from 'vitest';
import { VeilPipeline } from './veil-pipeline.js';
import type { AuditEntry } from '@theaiinc/realm-core';

describe('VeilPipeline', () => {
  let pipeline: VeilPipeline;

  beforeEach(() => {
    pipeline = new VeilPipeline({ enabled: true });
  });

  it('should pass through when disabled', async () => {
    pipeline.setEnabled(false);
    const result = await pipeline.processText('some text');
    expect(result.cleaned).toBe(false);
    expect(result.data).toBe('some text');
  });

  it('should detect and redact emails', async () => {
    const result = await pipeline.processText('Contact me at john@example.com');
    expect(result.cleaned).toBe(true);
    expect(result.data).not.toContain('john@example.com');
    expect(result.piiFound).toContain('email');
  });

  it('should detect and redact phone numbers', async () => {
    const result = await pipeline.processText('Call me at 555-123-4567');
    expect(result.cleaned).toBe(true);
    expect(result.data).not.toContain('555-123-4567');
    expect(result.piiFound).toContain('phone');
  });

  it('should detect and redact API keys', async () => {
    const result = await pipeline.processText('sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.cleaned).toBe(true);
    expect(result.data).not.toContain('sk-proj-');
    expect(result.piiFound).toContain('api-key');
  });

  it('should detect and redact secrets', async () => {
    const result = await pipeline.processText('API_KEY=super-secret-value');
    expect(result.cleaned).toBe(true);
    expect(result.piiFound).toContain('secret');
  });

  it('should process audit entries', async () => {
    const entry: AuditEntry = {
      id: '1',
      realmId: 'realm-1',
      action: 'realm.export',
      detail: 'Exported report to john@example.com',
      success: true,
      timestamp: new Date().toISOString(),
    };
    const result = await pipeline.processAuditEntry(entry);
    expect(result.detail).not.toContain('john@example.com');
  });

  it('should return multiple PII types in a single text', async () => {
    const result = await pipeline.processText(
      'User: John Doe, Email: john@example.com, Card: 4111111111111111',
    );
    expect(result.piiFound.length).toBeGreaterThanOrEqual(2);
  });

  it('should clean text with no PII unchanged', async () => {
    const result = await pipeline.processText('Hello world, this is a test.');
    expect(result.cleaned).toBe(false);
    expect(result.data).toBe('Hello world, this is a test.');
  });
});
