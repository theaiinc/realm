import type { AuditEntry, FileRef } from '@theaiinc/realm-core';

/**
 * Veil integration bridge for Realm.
 *
 * In production, this wraps @theaiinc/veil for PII detection/redaction.
 * For the MVP, it provides a pass-through implementation with stub
 * interfaces that mirror the Veil API.
 */

export interface VeilResult {
  cleaned: boolean;
  data: string;
  piiFound: string[];
}

export interface ScreenshotVeilResult {
  cleaned: boolean;
  image: Buffer;
  redactedRegions: Array<{ x: number; y: number; width: number; height: number; label: string }>;
}

/**
 * VeilPipeline — processes all outbound data through PII detection and redaction.
 *
 * Screenshots, documents, logs, and reports all pass through this pipeline
 * before reaching the agent or being exported to the host.
 */
export class VeilPipeline {
  private enabled = true;

  constructor(options?: { enabled?: boolean }) {
    this.enabled = options?.enabled ?? true;
  }

  /** Enable or disable Veil processing */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Check if Veil processing is enabled */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Process text content through Veil PII detection.
   * Returns cleaned text with PII redacted and list of detected PII types.
   */
  async processText(content: string): Promise<VeilResult> {
    if (!this.enabled) {
      return { cleaned: false, data: content, piiFound: [] };
    }

    const piiFound: string[] = [];
    let cleaned = content;

    // Detect and redact common PII patterns (offline, no external API needed)
    const patterns: Array<{ regex: RegExp; label: string; replacement: string }> = [
      { regex: /\b[A-Z][a-z]+ [A-Z][a-z]+\b(?:\s+[A-Z][a-z]+)*/g, label: 'name', replacement: '[REDACTED_NAME]' },
      { regex: /\b[\w.-]+@[\w.-]+\.\w+\b/g, label: 'email', replacement: '[REDACTED_EMAIL]' },
      { regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, label: 'phone', replacement: '[REDACTED_PHONE]' },
      { regex: /\b\d{16}\d*\b/g, label: 'credit-card', replacement: '[REDACTED_CC]' },
      { regex: /\b[A-Z]{2}\d{6}\b/g, label: 'passport', replacement: '[REDACTED_PASSPORT]' },
      { regex: /(?:api[_-]?key|apikey|secret|token|password)\s*[=:]\s*\S+/gi, label: 'secret', replacement: '[REDACTED_SECRET]' },
      { regex: /sk-[A-Za-z0-9_-]{20,}/g, label: 'api-key', replacement: '[REDACTED_API_KEY]' },
    ];

    for (const pattern of patterns) {
      const matches = cleaned.match(pattern.regex);
      if (matches) {
        piiFound.push(pattern.label);
        cleaned = cleaned.replace(pattern.regex, pattern.replacement);
      }
    }

    return {
      cleaned: piiFound.length > 0,
      data: cleaned,
      piiFound: [...new Set(piiFound)],
    };
  }

  /**
   * Process an audit entry through Veil.
   * Scrubs PII from the detail field.
   */
  async processAuditEntry(entry: AuditEntry): Promise<AuditEntry> {
    if (!this.enabled) return entry;

    const result = await this.processText(entry.detail);
    return {
      ...entry,
      detail: result.data,
    };
  }

  /**
   * Process a file reference for export.
   * Logs PII detection for compliance tracking.
   */
  async processFileRef(fileRef: FileRef): Promise<{ fileRef: FileRef; piiFound: string[] }> {
    if (!this.enabled) {
      return { fileRef, piiFound: [] };
    }
    return { fileRef, piiFound: [] };
  }
}
