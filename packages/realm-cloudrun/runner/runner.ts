import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promises as fs, createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = '/work';
const bucketRoot = process.env.BUCKET_DIR ?? '/bucket';
const realmId = required('REALM_ID');
const jobId = required('JOB_ID');
const command = Buffer.from(required('JOB_COMMAND_B64'), 'base64').toString();
const cwd = safeWorkPath(process.env.JOB_CWD || '/work');
const timeoutSeconds = Math.min(Number(process.env.JOB_TIMEOUT_SECONDS || 21600), 21600);
const filesPrefix = path.join(bucketRoot, 'realms', realmId, 'files');
const jobPrefix = path.join(bucketRoot, 'realms', realmId, 'jobs', jobId);
const logPrefix = path.join(jobPrefix, 'log');
const startedAt = Date.now();
let cancelled = false;
let timedOut = false;
let logBuffer = '';
let chunkNumber = 0;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}
function safeWorkPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(normalized) && normalized !== '/work' && !normalized.startsWith('/work/')) throw new Error('JOB_CWD escapes /work');
  const relative = normalized.replace(/^\/work\/?/, '');
  if (relative.split('/').some(part => part === '..')) throw new Error('JOB_CWD escapes /work');
  return path.join(root, relative);
}
async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}
async function uploadLog(force = false): Promise<void> {
  if (!force && logBuffer.length === 0) return;
  await fs.mkdir(logPrefix, { recursive: true });
  const file = path.join(logPrefix, String(++chunkNumber).padStart(6, '0'));
  await fs.writeFile(file, logBuffer);
  logBuffer = '';
}
function log(message: string): void {
  logBuffer += `[runner] ${message}\n`;
}
async function downloadFiles(): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const files = await walk(filesPrefix).catch(() => []);
  for (const source of files) {
    const relative = path.relative(filesPrefix, source);
    const destination = path.join(root, relative);
    if (relative.split(path.sep).some(part => part === '..')) throw new Error('unsafe file path');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  const archive = path.join(root, 'src.tgz');
  if (await exists(archive)) {
    await execFileAsync('tar', ['-xzf', archive, '-C', root, '--no-absolute-names', '--warning=no-unknown-keyword']);
    await fs.unlink(archive);
  }
}
async function installDependencies(): Promise<void> {
  const files = await walk(root);
  for (const lock of files.filter(file => /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file))) {
    const dir = path.dirname(lock);
    const bytes = await fs.readFile(lock);
    const hash = createHash('sha256').update('runner-v1').update(path.basename(lock)).update(bytes).digest('hex');
    const cache = path.join(bucketRoot, 'cache', `${hash}.tgz`);
    try {
      await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
      await execFileAsync('tar', ['-xzf', cache, '-C', dir]);
      log(`restored dependency cache for ${path.relative(root, dir)}`);
      continue;
    } catch {}
    try {
      const [tool, ...args] = lock.endsWith('package-lock.json') || lock.endsWith('npm-shrinkwrap.json')
        ? ['npm', 'ci', '--no-audit', '--no-fund', '--prefer-offline']
        : lock.endsWith('pnpm-lock.yaml') ? ['pnpm', 'install', '--frozen-lockfile'] : ['yarn', 'install', '--frozen-lockfile'];
      await execFileAsync(tool, args, { cwd: dir, env: { ...process.env, CI: '1' } });
      await fs.mkdir(path.dirname(cache), { recursive: true });
      await execFileAsync('tar', ['-czf', cache, '-C', dir, 'node_modules']);
    } catch (error) {
      log(`dependency install failed in ${path.relative(root, dir)}: ${String(error)}`);
    }
  }
}
async function main(): Promise<void> {
  await downloadFiles();
  await installDependencies();
  const before = new Map((await walk(root)).map(file => [file, 0]));
  const env = { ...process.env, CI: '1' };
  for (const key of ['REALM_ID', 'JOB_ID', 'BUCKET', 'JOB_COMMAND_B64', 'JOB_CWD', 'JOB_TIMEOUT_SECONDS']) delete env[key];
  const child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (data: Buffer) => { logBuffer += data.toString(); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 10000); }, timeoutSeconds * 1000);
  const interval = setInterval(() => { void uploadLog(); }, 5000);
  const term = () => { cancelled = true; try { process.kill(-child.pid!, 'SIGTERM'); } catch {} };
  process.once('SIGTERM', term);
  const exitCode = await new Promise<number>(resolve => child.once('close', code => resolve(code ?? 1)));
  clearTimeout(timer); clearInterval(interval); await uploadLog(true);
  const after = await walk(root);
  const changed = after.filter(file => !file.includes('/node_modules/') && !file.includes('/.git/') && (!before.has(file) || true));
  const out = path.join(root, 'out.tgz');
  let outBytes = 0; let outSkipped = false;
  if (changed.length) {
    await execFileAsync('tar', ['-czf', out, '-C', root, ...changed.map(file => path.relative(root, file))]);
    outBytes = (await fs.stat(out)).size;
    if (outBytes <= 200 * 1024 * 1024) {
      await fs.mkdir(path.join(bucketRoot, 'realms', realmId, 'files'), { recursive: true });
      await fs.copyFile(out, path.join(bucketRoot, 'realms', realmId, 'files', 'out.tgz'));
    } else { outSkipped = true; log('changed output exceeded 200 MB; skipped'); await uploadLog(true); }
  }
  await fs.mkdir(jobPrefix, { recursive: true });
  await fs.writeFile(path.join(jobPrefix, 'result.json'), JSON.stringify({ exit_code: exitCode, cancelled, timed_out: timedOut, changed_files: changed.length, out_bytes: outBytes, out_skipped: outSkipped, runtime_seconds: Math.floor((Date.now() - startedAt) / 1000) }));
}
void main().catch(async error => {
  await fs.mkdir(jobPrefix, { recursive: true });
  await fs.writeFile(path.join(jobPrefix, 'result.json'), JSON.stringify({ exit_code: 1, cancelled, timed_out: timedOut, changed_files: 0, out_bytes: 0, out_skipped: false, runtime_seconds: Math.floor((Date.now() - startedAt) / 1000), error: String(error) }));
});
function exists(file: string): Promise<boolean> { return fs.access(file).then(() => true, () => false); }