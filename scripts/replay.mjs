import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createDJFly } from '../index.mjs';
import { fixturePath } from '../connectome/load.mjs';

const args = process.argv.slice(2);
const fixture = args[0] === '--fixture';
if (fixture) args.shift();
const [input, output] = args;
if (!input || !output) throw new Error('Usage: node scripts/replay.mjs [--fixture] request.json result.json');
const data = JSON.parse(await readFile(input, 'utf8'));
const request = data.debug?.request ?? data;
const fly = await createDJFly({ graphPath: fixture ? fixturePath : undefined, allowFixture: fixture, debug: true });
const result = fly.decide(request);
if (data.debug?.artifactSha256 && result.debug?.artifactSha256 !== data.debug.artifactSha256) {
  throw new Error('Replay artifact differs from the recorded SHA-256. Load the original graph file.');
}
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(resolve(output));
