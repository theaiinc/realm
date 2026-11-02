import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface RealmStore {
  load(realmId: string): Promise<Buffer | undefined>;
  save(realmId: string, value: Buffer): Promise<void>;
  remove(realmId: string): Promise<void>;
}

export class MemoryRealmStore implements RealmStore {
  private readonly values = new Map<string, Buffer>();
  async load(realmId: string) { return this.values.get(realmId); }
  async save(realmId: string, value: Buffer) { this.values.set(realmId, Buffer.from(value)); }
  async remove(realmId: string) { this.values.delete(realmId); }
}

export class FileRealmStore implements RealmStore {
  constructor(private readonly directory: string) {}
  private file(realmId: string) { return path.join(this.directory, `${encodeURIComponent(realmId)}.json`); }
  async load(realmId: string) {
    try { return Buffer.from(JSON.parse(await fs.readFile(this.file(realmId), 'utf8')).value, 'base64'); }
    catch { return undefined; }
  }
  async save(realmId: string, value: Buffer) {
    await fs.mkdir(this.directory, { recursive: true });
    const target = this.file(realmId);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ value: Buffer.from(value).toString('base64') }));
    await fs.rename(temporary, target);
  }
  async remove(realmId: string) { await fs.rm(this.file(realmId), { force: true }); }
}

export function createRealmStore(directory = process.env.REALM_STATE_DIR): RealmStore {
  return directory ? new FileRealmStore(directory) : new MemoryRealmStore();
}