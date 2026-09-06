'use strict';

const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

// Vite loads `.env` during `vite build` and honors its NODE_ENV value. The local
// `.env` sets NODE_ENV=development, which silently turns every production build
// into a development bundle (react.development, jsxDEV, import.meta.env.DEV=true,
// and no production API base URL). Pre-setting NODE_ENV=production makes Vite's
// `isNodeEnvSet` true, so Vite ignores the `.env` NODE_ENV entirely.
process.env.NODE_ENV = 'production';

const child = spawn(process.execPath, [viteCli, 'build'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
