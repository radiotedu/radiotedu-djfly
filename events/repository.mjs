import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { validateEvents } from './domain.mjs';
import { validatePool } from '../music/manifest.mjs';

export class FileEventRepository {
  constructor(path) { this.path = path; }
  async list() {
    const data = JSON.parse(await readFile(this.path, 'utf8'));
    if (data.schemaVersion !== 1) throw new TypeError('Unsupported event repository schema.');
    return validateEvents(data.events);
  }
}

export class FilePoolRepository {
  constructor(directory) { this.directory = resolve(directory); }
  async get(id) {
    if (!/^[\w-]{1,80}$/.test(id)) throw new TypeError('Invalid pool ID.');
    const path = resolve(this.directory, `${id}.json`);
    if (!path.startsWith(this.directory + sep)) throw new Error('Pool path outside repository.');
    return validatePool(JSON.parse(await readFile(path, 'utf8')));
  }
}

export class MemoryEventRepository {
  constructor(events) { this.events = validateEvents(structuredClone(events)); }
  async list() { return structuredClone(this.events); }
}

export class MemoryPoolRepository {
  constructor(pools) { this.pools = new Map(pools.map(pool => [pool.id, validatePool(pool)])); }
  async get(id) { const pool = this.pools.get(id); if (!pool) throw new Error('Pool unavailable.'); return structuredClone(pool); }
}
