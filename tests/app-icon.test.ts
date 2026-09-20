import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { APP_ICON_CATALOG } from "../src/features/personalization/appIcon/appIconCatalog";
import { APP_ICON_IDS } from "../src/features/personalization/appIcon/appIconTypes";

const projectRoot = new URL("../", import.meta.url);
const readProjectFile = (relativePath: string): string =>
  readFileSync(new URL(relativePath, projectRoot), "utf8");

const primaryContents = JSON.parse(
  readProjectFile("ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json"),
) as {
  images: Array<{ filename?: string }>;
};

const alternateSets = [
  "AppIconMidnight",
  "AppIconRose",
  "AppIconMonochrome",
] as const;

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

test("App Icon catalog exposes exactly the closed product IDs", () => {
  assert.deepEqual(APP_ICON_IDS, [
    "primary",
    "midnight",
    "rose",
    "monochrome",
  ]);
  assert.deepEqual(
    APP_ICON_CATALOG.map((item) => item.id),
    [...APP_ICON_IDS],
  );
});

test("primary AppIcon catalog references existing opaque 1024px assets", () => {
  for (const image of primaryContents.images) {
    assert.ok(image.filename);
    const info = pngInfo(
      `ios/App/App/Assets.xcassets/AppIcon.appiconset/${image.filename}`,
    );
    assert.equal(info.width, 1024);
    assert.equal(info.height, 1024);
    assert.equal(info.colorType, 2, "primary icon must be opaque RGB");
    assert.ok(info.byteLength > 0);
  }
});

test("alternate AppIcon sets contain valid opaque 1024px PNGs", () => {
  for (const setName of alternateSets) {
    const contentsPath = `ios/App/App/Assets.xcassets/${setName}.appiconset/Contents.json`;
    const contents = JSON.parse(readProjectFile(contentsPath)) as {
      images: Array<{ filename?: string }>;
    };
    assert.equal(contents.images.length, 1);
    const filename = contents.images[0]?.filename;
    assert.ok(filename);
    assert.ok(
      existsSync(new URL(`ios/App/App/Assets.xcassets/${setName}.appiconset/${filename}`, projectRoot)),
    );
    const info = pngInfo(
      `ios/App/App/Assets.xcassets/${setName}.appiconset/${filename}`,
    );
    assert.equal(info.width, 1024);
    assert.equal(info.height, 1024);
    assert.equal(info.colorType, 2, `${setName} must be opaque RGB`);
    assert.ok(info.byteLength > 0);
  }
});

test("Xcode target keeps primary and alternate icon build settings", () => {
  const project = readProjectFile("ios/App/App.xcodeproj/project.pbxproj");
  assert.equal(
    (project.match(/ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (project.match(
      /ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = \(\s*AppIconMidnight,\s*AppIconRose,\s*AppIconMonochrome,\s*\);/g,
    ) ?? []).length,
    2,
  );
});

test("App Icon uses no manual Info.plist icon dictionary", () => {
  const infoPlist = readProjectFile("ios/App/App/Info.plist");
  assert.doesNotMatch(infoPlist, /CFBundleIcons|CFBundleAlternateIcons/);
});

test("Swift bridge uses public APIs, a closed allowlist, and primary-to-nil mapping", () => {
  const swift = readProjectFile("ios/App/App/AppIcon.swift");
  assert.match(swift, /supportsAlternateIcons/);
  assert.match(swift, /alternateIconName/);
  assert.match(swift, /setAlternateIconName/);
  assert.match(swift, /case primary/);
  assert.match(swift, /return nil/);
  assert.match(swift, /ProductIcon\(rawValue: rawIconId\)/);
  assert.match(swift, /app_icon_invalid_id/);
  assert.match(swift, /DispatchQueue\.main\.async/);
});

test("web fallback is explicit and App Icon state stays outside personalization", () => {
  const client = readProjectFile(
    "src/features/personalization/appIcon/appIconClient.ts",
  );
  const personalizationContract = readProjectFile("shared/personalization.ts");
  const personalizationStorage = readProjectFile(
    "src/features/personalization/personalizationStorage.ts",
  );
  assert.match(client, /Capacitor\.getPlatform\(\) === "ios"/);
  assert.match(client, /supported: false/);
  assert.match(client, /app_icon_unsupported/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB|personalization/i);
  assert.doesNotMatch(personalizationContract, /appIcon|iconId/i);
  assert.doesNotMatch(personalizationStorage, /appIcon|iconId/i);
});

test("My99 places App Icon after Home controls without wiring it to Draft", () => {
  const studio = readProjectFile(
    "src/features/personalization/components/My99Studio.tsx",
  );
  const homeIndex = studio.indexOf("<HomeSubjectOrderEditor");
  const iconIndex = studio.indexOf("<AppIconSelector");
  const stickyIndex = studio.indexOf('className="sticky bottom-0');
  assert.ok(homeIndex >= 0);
  assert.ok(iconIndex > homeIndex);
  assert.ok(stickyIndex > iconIndex);
  assert.match(studio, /<AppIconSelector language=\{language\} \/>/);
  assert.doesNotMatch(
    readProjectFile(
      "src/features/personalization/appIcon/AppIconSelector.tsx",
    ),
    /updateDraft|PersonalizationConfig|localStorage|sessionStorage|IndexedDB/,
  );
});

test("App Icon English and Arabic labels are present", () => {
  const translations = readProjectFile("src/core/i18n/translations.ts");
  for (const key of [
    "my99AppIconTitle",
    "my99AppIconDeviceBadge",
    "my99AppIconDescription",
    "my99AppIconOriginalName",
    "my99AppIconMidnightName",
    "my99AppIconRoseName",
    "my99AppIconMonochromeName",
    "my99AppIconUnsupported",
  ]) {
    assert.equal((translations.match(new RegExp(`${key}:`, "g")) ?? []).length, 2);
  }
  assert.match(translations, /my99AppIconDeviceBadge: "This device"/);
  assert.match(translations, /my99AppIconDeviceBadge: "هذا الجهاز"/);
});