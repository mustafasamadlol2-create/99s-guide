import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { APP_ICON_CATALOG } from "../src/features/personalization/appIcon/appIconCatalog";

const projectRoot = new URL("../", import.meta.url);

const readProjectFile = (relativePath: string): string =>
  readFileSync(new URL(relativePath, projectRoot), "utf8");

function pngInfo(relativePath: string): {
  width: number;
  height: number;
  colorType: number;
  byteLength: number;
} {
  const bytes = readFileSync(new URL(relativePath, projectRoot));
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${relativePath} must be a PNG`,
  );
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
    byteLength: bytes.length,
  };
}

function projectPathFromUrl(url: string): string {
  assert.match(url, /^\/[A-Za-z0-9_./-]+$/);
  return url.slice(1);
}

test("effective PWA manifest is valid and every declared icon resolves", () => {
  const manifestText = readProjectFile("public/manifest.json");
  const manifest = JSON.parse(manifestText) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    display_override?: string[];
    theme_color?: string;
    background_color?: string;
    icons?: Array<{
      src: string;
      sizes: string;
      type: string;
      purpose?: string;
    }>;
  };

  assert.equal(manifest.name, "99's Guide");
  assert.equal(manifest.short_name, "99's Guide");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.display_override, ["standalone", "minimal-ui"]);
  assert.equal(manifest.theme_color, "#0B0F17");
  assert.equal(manifest.background_color, "#000000");
  assert.ok(manifest.icons);
  assert.equal(manifest.icons.length, 3);

  for (const icon of manifest.icons) {
    const relativePath = projectPathFromUrl(icon.src);
    assert.equal(icon.type, "image/png");
    assert.ok(icon.purpose === "any" || icon.purpose === "maskable");
    const info = pngInfo(`public/${relativePath}`);
    assert.ok(info.byteLength > 0);
    assert.equal(icon.sizes, `${info.width}x${info.height}`);
  }
});

test("PWA install icons, Apple touch icon, and favicon use the primary identity", () => {
  const index = readProjectFile("index.html");
  assert.match(index, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(index, /rel="icon" type="image\/png" href="\/favicon-32x32\.png"/);

  const appleTouch = pngInfo("public/apple-touch-icon.png");
  assert.deepEqual(
    [appleTouch.width, appleTouch.height, appleTouch.colorType],
    [180, 180, 2],
  );

  for (const favicon of ["favicon-16x16.png", "favicon-32x32.png"]) {
    const info = pngInfo(`public/${favicon}`);
    assert.equal(info.width, info.height);
    assert.equal(info.colorType, 2);
  }

  const favicon = readFileSync(new URL("public/favicon.ico", projectRoot));
  assert.equal(favicon.readUInt16LE(0), 0);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.equal(favicon.readUInt16LE(4), 2);
});

test("native alternate choices never enter PWA install metadata", () => {
  const manifest = readProjectFile("public/manifest.json");
  const index = readProjectFile("index.html");
  const serviceWorker = readProjectFile("public/sw.js");
  for (const source of [manifest, index, serviceWorker]) {
    assert.doesNotMatch(
      source,
      /AppIconMidnight|AppIconRose|AppIconMonochrome|\/app-icons\//,
    );
  }
});

test("service worker precaches all required PWA shell icon assets", () => {
  const serviceWorker = readProjectFile("public/sw.js");
  for (const path of [
    "/manifest.json",
    "/favicon.ico",
    "/favicon-32x32.png",
    "/favicon-16x16.png",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-512-maskable.png",
    "/apple-touch-icon.png",
  ]) {
    assert.match(serviceWorker, new RegExp(`['"]${path.replaceAll(".", "\\.")}['"]`));
    assert.ok(existsSync(new URL(`public${path}`, projectRoot)));
  }
});

test("App Icon selector preview URLs resolve in source and production output", () => {
  for (const item of APP_ICON_CATALOG) {
    const sourcePath = `public${item.previewSrc}`;
    assert.ok(existsSync(new URL(sourcePath, projectRoot)));
    assert.ok(statSync(new URL(sourcePath, projectRoot)).size > 0);

    const builtPath = `dist${item.previewSrc}`;
    assert.ok(
      existsSync(new URL(builtPath, projectRoot)),
      `${builtPath} must exist after npm run build`,
    );
    assert.ok(statSync(new URL(builtPath, projectRoot)).size > 0);
  }
});

test("PWA source and build contain no temporary icon-generation artifacts", () => {
  for (const relativePath of [
    "public",
    "dist",
  ]) {
    const content = readProjectFile(
      `${relativePath}/manifest.json`,
    );
    assert.doesNotMatch(content, /temporary|scratch|generator/i);
  }
});