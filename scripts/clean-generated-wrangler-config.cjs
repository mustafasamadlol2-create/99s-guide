const fs = require('node:fs');
const path = require('node:path');

const deployDir = path.join(process.cwd(), '.wrangler', 'deploy');
try {
  fs.rmSync(deployDir, { recursive: true, force: true });
  console.log('[Wrangler] Cleared stale generated deploy configuration.');
} catch (error) {
  console.error('[Wrangler] Failed to clear stale generated deploy configuration:', error?.message || error);
  process.exitCode = 1;
}
