'use strict';

const apiBaseUrl = process.env.VITE_API_BASE_URL?.trim();

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