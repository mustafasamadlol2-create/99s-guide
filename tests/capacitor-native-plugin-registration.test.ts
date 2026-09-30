import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readProjectFile = (relativePath: string): string =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("custom iOS Capacitor plugins are declared, compiled, and registered with the bridge", () => {
  const bridgeController = readProjectFile("ios/App/App/BridgeViewController.swift");
  const externalOpener = readProjectFile("ios/App/App/CapExternalOpener.swift");
  const appIcon = readProjectFile("ios/App/App/AppIcon.swift");
  const project = readProjectFile("ios/App/App.xcodeproj/project.pbxproj");
  const sceneDelegate = readProjectFile("ios/App/App/SceneDelegate.swift");
  const sourcesSection = project.match(
    /\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//,
  )?.[1];

  assert.match(project, /BridgeViewController\.swift in Sources/);
  assert.match(project, /path = BridgeViewController\.swift/);
  assert.ok(sourcesSection);
  assert.match(sourcesSection, /BridgeViewController\.swift in Sources/);
  assert.match(bridgeController, /registerPluginInstance\(AppIconPlugin\(\)\)/);
  assert.match(bridgeController, /registerPluginInstance\(CapExternalOpener\(\)\)/);
  assert.match(externalOpener, /public let jsName = "CapExternalOpener"/);
  assert.match(externalOpener, /public let identifier = "CapExternalOpener"/);
  assert.match(appIcon, /public let jsName = "AppIcon"/);
  assert.match(project, /CapExternalOpener\.swift in Sources/);
  assert.match(project, /AppIcon\.swift in Sources/);
  assert.match(sceneDelegate, /BridgeViewController\(\)/);
});