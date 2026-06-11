# @theaiinc/realm-veil

![Realm](logo.svg)

**Veil PII redaction integration for Realm.**

Automatically detects and redacts sensitive data in agent outputs — screenshots, documents, logs, and reports — before they reach the agent or are exported.

## Features

- **PII detection** — Identifies emails, phone numbers, credit cards, passports, API keys, tokens, and names
- **Automatic redaction** — Seamlessly plugs into the Realm output pipeline
- **Screenshot scanning** — Detects PII in captured screen images
- **Document scanning** — Scans exported documents for sensitive data

## Installation

```bash
pnpm add @theaiinc/realm-veil
```

## Usage

```typescript
import { VeilEngine } from '@theaiinc/realm-veil';

const veil = new VeilEngine();
const result = await veil.redact('My email is user@example.com');
// result.text === 'My email is [REDACTED]'
```

## PII Types Detected

- Email addresses
- Phone numbers
- Credit card numbers
- Passport numbers
- API keys and secrets
- Access tokens
- Names

## Dependencies

- **@theaiinc/veil** — PII detection and redaction engine

## License

MIT
