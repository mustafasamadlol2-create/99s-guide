'use strict';

const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const child = spawn(process.execPath, [tsxCli, 'server.ts'], {
  cwd: root,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
