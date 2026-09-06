'use strict';

const fs = require('fs');
const path = require('path');

let apiBaseUrl = process.env.VITE_API_BASE_URL?.trim();

if (!apiBaseUrl) {
  // Fall back to the tracked production override (`.env.production`) so
  // `npm run cap:sync` works out of the box — `vite build` injects the same
  // value into the bundle via the identical file, so the gate always matches
  // what the packaged frontend actually targets.
  try {
    const productionEnv = fs
      .readFileSync(path.join(__dirname, '..', '.env.production'), 'utf8')
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('VITE_API_BASE_URL='));
    if (productionEnv) {
      apiBaseUrl = productionEnv
        .slice('VITE_API_BASE_URL='.length)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  } catch {
    // leave apiBaseUrl undefined; the check below reports the missing value
  }
}

if (!apiBaseUrl) {
  console.error(
    'VITE_API_BASE_URL is required for Capacitor packaging. Set it to the HTTPS origin of the deployed API before running npm run cap:sync.'
  );
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(apiBaseUrl);
} catch {
  console.error('VITE_API_BASE_URL must be a valid absolute URL.');
  process.exit(1);
}

if (parsed.protocol !== 'https:') {
  console.error('VITE_API_BASE_URL must use HTTPS for App Store and Google Play builds.');
  process.exit(1);
}