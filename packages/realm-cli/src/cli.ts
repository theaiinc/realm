#!/usr/bin/env node

import { Command } from 'commander';

const API_BASE = process.env.REALM_API_URL ?? 'http://127.0.0.1:8542';

async function api(path: string, options?: { method?: string; body?: unknown }) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

const program = new Command();

program
  .name('realm')
  .description('Realm — isolated AI execution environment platform')
  .version('0.1.0');

program
  .command('create')
  .description('Create a new realm')
  .requiredOption('-n, --name <name>', 'Realm name')
  .option('-e, --engine <engine>', 'Engine type (container, browser)', 'container')
  .option('-t, --template <template>', 'Template (coding, research, data-analysis)')
  .option('--network <mode>', 'Network mode (disabled, restricted, full)', 'disabled')
  .action(async (opts) => {
    try {
      const data = await api('/api/v1/realms', {
        method: 'POST',
        body: {
          name: opts.name,
          engine: opts.engine,
          template: opts.template,
          networkMode: opts.network,
        },
      });
      console.log(`Realm created: ${data.id}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start a realm')
  .argument('<id>', 'Realm ID')
  .action(async (id) => {
    try {
      const data = await api(`/api/v1/realms/${id}/start`, { method: 'POST' });
      console.log(`Realm started: ${data.session?.id ?? id}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop a realm')
  .argument('<id>', 'Realm ID')
  .action(async (id) => {
    try {
      await api(`/api/v1/realms/${id}/stop`, { method: 'POST' });
      console.log('Realm stopped');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all realms')
  .action(async () => {
    try {
      const data = await api('/api/v1/realms');
      if (data.realms.length === 0) {
        console.log('No realms.');
        return;
      }
      for (const r of data.realms) {
        console.log(`${r.id.padEnd(40)} ${r.config.engine.padEnd(10)} ${r.session ? 'running' : 'stopped'}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('destroy')
  .description('Destroy a realm')
  .argument('<id>', 'Realm ID')
  .action(async (id) => {
    try {
      await api(`/api/v1/realms/${id}`, { method: 'DELETE' });
      console.log('Realm destroyed');
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('exec')
  .description('Execute a command in a realm')
  .argument('<id>', 'Realm ID')
  .argument('<command...>', 'Command to execute')
  .action(async (id, command) => {
    try {
      const data = await api(`/api/v1/realms/${id}/exec`, {
        method: 'POST',
        body: { command: command.join(' ') },
      });
      if (data.success) {
        console.log(JSON.stringify(data.data, null, 2));
      } else {
        console.error(data.error);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('capture')
  .description('Capture a screenshot from a realm')
  .argument('<id>', 'Realm ID')
  .action(async (id) => {
    try {
      const data = await api(`/api/v1/realms/${id}/capture`);
      console.log(`Screenshot captured. PII redacted: ${data.piiRedacted}`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('audit')
  .description('Show audit log')
  .option('-r, --realm <id>', 'Filter by realm ID')
  .action(async (opts) => {
    try {
      const path = opts.realm ? `/api/v1/realms/${opts.realm}/audit` : '/api/v1/audit';
      const data = await api(path);
      if (data.entries.length === 0) {
        console.log('No audit entries.');
        return;
      }
      for (const entry of data.entries) {
        console.log(`[${entry.timestamp}] ${entry.action.padEnd(20)} ${entry.detail.slice(0, 80)}`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse(process.argv);
