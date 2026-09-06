import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(() => {
  return {
    // Explicit base path — Capacitor serves assets from capacitor://localhost/ (iOS)
    // and http://localhost/ (Android). Keeping base as '/' ensures asset paths are
    // always absolute and never broken by a missing trailing slash.
    base: '/',
    plugins: [react(), tailwindcss(), cloudflare()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
      dedupe: ["react", "react-dom"],
    },
    build: {
      // es2022 is the safe ceiling for Capacitor 8 (iOS 16+ / WKWebView).
      // "esnext" can emit syntax that older-than-targeted devices reject at runtime.
      target: "es2022",
      minify: "esbuild" as const,
      cssMinify: "esbuild" as const,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // Function form ensures Rollup matches resolved file paths, not bare
          // specifiers — the object form misses transitive chunks in Vite 6.
          manualChunks(id) {
            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/scheduler/")
            ) {
              return "vendor";
            }
            if (
              id.includes("/node_modules/lucide-react") ||
              id.includes("/node_modules/motion")
            ) {
              return "ui";
            }
            // socket.io-client is ~200KB minified — keep it out of the main bundle
            // so the initial dashboard load is not blocked by real-time infra code
            if (
              id.includes("/node_modules/socket.io-client") ||
              id.includes("/node_modules/engine.io-client") ||
              id.includes("/node_modules/@socket.io")
            ) {
              return "realtime";
            }
          },
        },
      },
    },
    esbuild: {
      drop: ["console", "debugger"] as ("console" | "debugger")[],
    },
    server: {
      host: true,
      // Keep this literal typed as `true` so Vite accepts proxied preview hosts.
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== "true",
      watch: process.env.DISABLE_HMR === "true" ? null : {},
      // The Express + Vite combined server runs on port 3000 in this project.
      // These proxy entries apply only to standalone `vite dev` (not `npm run dev`),
      // but kept correct so they work if invoked directly.
      proxy: {
        "/api": "http://127.0.0.1:3000",
        "/uploads": "http://127.0.0.1:3000",
        "/socket.io": {
          target: "ws://127.0.0.1:3000",
          ws: true,
        },
      },
    },
  };
});