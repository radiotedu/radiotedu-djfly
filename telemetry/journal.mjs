import { appendFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

export class EventJournal {
  constructor(directory) { this.directory = directory; this.events = []; this.queue = Promise.resolve(); this.failed = false; }
  record(type, data = {}) {
    const entry = { at: new Date().toISOString(), type, ...structuredClone(data) };
    this.events.push(entry); if (this.events.length > 200) this.events.shift();
    if (this.directory) this.queue = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true });
      await appendFile(resolve(this.directory, `${entry.at.slice(0, 10)}.ndjson`), JSON.stringify(entry) + '\n');
    }).catch(() => { this.failed = true; });
    return entry;
  }
  async flush() { await this.queue; }
}

export class ProgramStore {
  constructor(directory) { this.directory = directory; }
  async load(id, fingerprint) {
    try {
      if (!/^[\w-]{1,80}$/.test(id)) return null;
      const data = JSON.parse(await readFile(resolve(this.directory, `${id}.json`), 'utf8'));
      return data.fingerprint === fingerprint ? data.items : null;
    } catch { return null; }
  }
  async save(id, fingerprint, items) {
    if (!/^[\w-]{1,80}$/.test(id)) throw new TypeError('Invalid program ID.');
    await mkdir(this.directory, { recursive: true });
    const path = resolve(this.directory, `${id}.json`);
    await writeFile(path + '.tmp', JSON.stringify({ schemaVersion: 1, fingerprint, items }));
    await rename(path + '.tmp', path);
  }
}
