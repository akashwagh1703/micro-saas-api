/**
 * PM2 entry — always starts the compiled NestJS app from the correct dist path.
 * Prefers dist/main.js (standard nest build). Falls back to dist/src/main.js (legacy layout).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const candidates = ['dist/main.js', 'dist/src/main.js'];

const entry = candidates.find((rel) => fs.existsSync(path.join(root, rel)));

if (!entry) {
  // eslint-disable-next-line no-console
  console.error(
    `[api-entry] No build found. Expected one of:\n` +
      candidates.map((c) => `  - ${path.join(root, c)}`).join('\n') +
      '\nRun: rm -rf dist && npm run build',
  );
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(`[api-entry] Starting ${entry}`);

const child = spawn(process.execPath, [path.join(root, entry)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[api-entry] Failed to start API:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
