import { Worker } from 'node:worker_threads';

export class DecisionService {
  constructor() {
    this.worker = new Worker(new URL('./worker.mjs', import.meta.url));
    this.sequence = 0; this.pending = new Map(); this.available = false;
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    this.worker.on('message', message => {
      if (message.type === 'ready') { this.available = message.available; this.identity = message; this.resolveReady(message.available); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    });
    this.worker.on('error', () => this.fail());
    this.worker.on('exit', () => this.fail());
  }
  fail() {
    this.available = false; this.resolveReady(false);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Decision worker unavailable.')); }
    this.pending.clear();
  }
  async decide(request) {
    await this.ready;
    if (!this.available) throw new Error('Real graph unavailable.');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Decision deadline exceeded.')); }, 3000);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, request });
    });
  }
  async close() { await this.worker.terminate(); }
}
