import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DecisionService } from '../decision/service.mjs';
import { FileEventRepository, FilePoolRepository, MemoryEventRepository } from '../events/repository.mjs';
import { ProgramCoordinator } from '../events/coordinator.mjs';
import { EventJournal, ProgramStore } from '../telemetry/journal.mjs';
import { createPublicServer } from './app.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const development = process.argv.includes('--development');
if (process.argv.includes('--demo') && !development) throw new Error('Original test audio requires explicit --development --demo.');
const events = process.argv.includes('--demo') ? new MemoryEventRepository([{
  id: 'local-flight', title: 'Gece Uçuşu', description: 'Özgün test kayıtlarıyla yerel DJ Fly ses denemesi.',
  startAt: new Date(Date.now() - 65000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(),
  timezone: 'Europe/Istanbul', enabled: true, poolId: 'lab', startingTrackId: 'lab-01', visualizerPreset: 'orbit',
  settings: { repeatCooldownMinutes: .5, artistCooldownTracks: 0 }
}]) : new FileEventRepository(process.env.DJFLY_EVENTS_PATH ?? resolve(root, 'config/events.json'));
const pools = new FilePoolRepository(process.env.DJFLY_POOLS_DIR ?? resolve(root, 'local/pools'));
const decisions = new DecisionService();
const journal = new EventJournal(resolve(root, 'local/logs'));
const store = development ? null : new ProgramStore(resolve(root, 'local/programs'));
const coordinator = new ProgramCoordinator({ events, pools, decisions, journal, store, development });
const server = await createPublicServer({ coordinator, journal, development,
  publicOrigin: process.env.DJFLY_PUBLIC_ORIGIN ?? 'https://radiotedu.com',
  mediaDirectory: process.env.DJFLY_MEDIA_DIR ?? resolve(root, 'local/media') });
const port = Number(process.env.DJFLY_PORT ?? 5190);
server.listen(port, '127.0.0.1', () => console.log(`DJ Fly: http://127.0.0.1:${port}/djfly/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  server.endStreams(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await decisions.close(); await journal.flush(); process.exit(0);
});
