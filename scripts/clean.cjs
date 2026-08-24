'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const entry of ['dist', 'server.js']) {
  fs.rmSync(path.join(root, entry), { recursive: true, force: true });
}
