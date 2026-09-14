import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [credentialFile, command = 'probe', ...args] = process.argv.slice(2);
if (!credentialFile || !['probe', 'explore'].includes(command)) {
  throw new Error('Usage: node scripts/preprocess-session.mjs credential-document.md [probe|explore]');
}
const document = await readFile(credentialFile, 'utf8');
const assignment = document.match(/\bNEUPRINT_TOKEN\s*=\s*([^\s`"'<>]+)/);
if (!assignment) throw new Error('No NEUPRINT_TOKEN assignment found in the supplied session document.');
const token = assignment[1];
const root = fileURLToPath(new URL('../', import.meta.url));
const interpreter = fileURLToPath(new URL('../.venv/Scripts/python.exe', import.meta.url));
const script = command === 'probe' ? 'connectome/preprocessing/probe.py' : 'connectome/preprocessing/build.py';
const child = spawn(interpreter, [script, ...(command === 'explore' ? ['explore'] : []), ...args], {
  cwd: root, env: { ...process.env, NEUPRINT_TOKEN: token, PYTHONUNBUFFERED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
});
let output = '';
const capture = chunk => { output = (output + chunk).slice(-1024 * 1024); };
child.stdout.on('data', capture); child.stderr.on('data', capture);
child.on('error', () => { console.error('Could not start the preprocessing interpreter.'); process.exitCode = 2; });
child.on('close', code => {
  // Third-party errors must not disclose the supplied process credential.
  const sanitized = output.replaceAll(token, '[REDACTED]');
  process.stdout.write(sanitized.slice(-8000));
  process.exitCode = code ?? 2;
});
