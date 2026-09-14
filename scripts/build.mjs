import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
await mkdir(resolve(output, 'assets'), { recursive: true });
await build({ entryPoints: [resolve(root, 'public/app.mjs')], outfile: resolve(output, 'assets/app.js'), bundle: true,
  format: 'esm', target: ['es2022'], minify: true, sourcemap: false, metafile: true,
  plugins: [{ name: 'browser-boundary', setup(builder) { builder.onResolve({ filter: /connectome|decision\/engine|node:/ }, args => ({ errors: [{ text: `Server-only module entered the browser: ${args.path}` }] })); } }]
});
await copyFile(resolve(root, 'public/index.html'), resolve(output, 'index.html'));
await copyFile(resolve(root, 'public/style.css'), resolve(output, 'assets/style.css'));
for (const file of await readdir(resolve(root, 'public/assets'))) await copyFile(resolve(root, 'public/assets', file), resolve(output, 'assets', file));
const sizes = {};
for (const file of await readdir(resolve(output, 'assets'))) sizes[file] = (await stat(resolve(output, 'assets', file))).size;
await writeFile(resolve(root, 'generated/phase2-build.json'), JSON.stringify({ sizes, graphBundled: false }, null, 2));
console.log(resolve(output, 'index.html'));
