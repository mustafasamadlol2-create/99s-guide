import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const plugin = read("ios/App/App/FocusLiveActivityPlugin.swift");
const attributes = read("ios/App/Shared/FocusActivityAttributes.swift");
const widget = read("ios/App/FocusLiveActivity/FocusLiveActivityWidget.swift");
const widgetInfo = read("ios/App/FocusLiveActivity/Info.plist");
const appInfo = read("ios/App/App/Info.plist");
const bridge = read("ios/App/App/BridgeViewController.swift");
const project = read("ios/App/App.xcodeproj/project.pbxproj");
const client = read("src/features/focus/liveActivity/focusLiveActivityClient.ts");
const hook = read("src/features/focus/liveActivity/useFocusLiveActivitySync.ts");
const hub = read("src/features/focus/components/FocusHub.tsx");

test("Phase 12 enables Live Activities only through the native iOS bridge", () => {
  assert.match(client, /Capacitor\.isNativePlatform\(\)/);
  assert.match(client, /Capacitor\.getPlatform\(\) === "ios"/);
  assert.match(client, /registerPlugin<FocusLiveActivityPlugin>\(\s*"FocusLiveActivity"/s);
  assert.match(bridge, /registerPluginInstance\(FocusLiveActivityPlugin\(\)\)/);
  assert.match(appInfo, /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/s);
});

test("Phase 12 native plugin is canonical-session keyed and cleans duplicate/stale activities", () => {
  assert.match(attributes, /public var sessionId: String/);
  assert.match(attributes, /public var lectureTitle: String/);
  assert.match(attributes, /public var phase: String/);
  assert.match(plugin, /ActivityAuthorizationInfo\(\)\.areActivitiesEnabled/);
  assert.match(plugin, /Activity<FocusActivityAttributes>\.activities/);
  assert.match(plugin, /endOtherSessions\(keeping: payload\.sessionId\)/);
  assert.match(plugin, /attributes\.sessionId == payload\.sessionId/);
  assert.match(plugin, /Activity\.request/);
  assert.match(plugin, /await activity\.update/);
  assert.match(plugin, /dismissalPolicy: \.immediate/);
});

test("Phase 12 supports Focus, Pause, Break and paused Break states", () => {
  for (const phase of ["FOCUSING", "PAUSED", "BREAK", "BREAK_PAUSED"]) {
    assert.ok(plugin.includes(`\"${phase}\"`), `native payload should accept ${phase}`);
    assert.ok(client.includes(`\"${phase}\"`), `client type should expose ${phase}`);
  }
  assert.match(hook, /activeBreak\.isPaused \? "BREAK_PAUSED" : "BREAK"/);
  assert.match(hook, /session\.status === "ACTIVE" \? "FOCUSING" : "PAUSED"/);
});

test("Phase 12 lets ActivityKit render the countdown without per-second native writes", () => {
  assert.match(widget, /Text\(timerInterval:/);
  assert.match(hook, /Deliberately excludes displayRemainingSeconds/);
  const keySection = hook.slice(hook.indexOf("const canonicalSyncKey"), hook.indexOf("useEffect(() =>", hook.indexOf("const canonicalSyncKey")));
  assert.doesNotMatch(keySection, /displayRemainingSeconds/);
  assert.match(hook, /serverNow \+ Math\.max\(0, session\.remainingSeconds\) \* 1_000/);
});

test("Phase 12 recovers on foreground/reconnect and ends when canonical current session disappears", () => {
  assert.match(hook, /runtimeController\.reconcile\(\)/);
  assert.match(hook, /FOCUS_SOCKET_RECONNECTED_EVENT/);
  assert.match(hook, /FOCUS_STATE_INVALIDATED_EVENT/);
  assert.match(hook, /CapacitorApp\.addListener\("appStateChange"/);
  assert.match(hook, /await endAllFocusLiveActivities\(\)/);
  assert.match(hook, /await endFocusLiveActivity\(session\.id\)/);
  assert.match(hook, /lastBreakRef/);
});

test("Phase 12 FocusHub owns the Live Activity sync for the authenticated app lifetime", () => {
  assert.match(hub, /import \{ useFocusLiveActivitySync \}/);
  assert.match(hub, /useFocusLiveActivitySync\(\{[\s\S]*accountId,[\s\S]*runtimeController,[\s\S]*runtimeState,[\s\S]*lectures,[\s\S]*language,/);
});

test("Phase 12 widget extension is embedded and configured for ActivityKit", () => {
  assert.match(widgetInfo, /com\.apple\.widgetkit-extension/);
  assert.match(project, /FocusLiveActivity\.appex in Embed App Extensions/);
  assert.match(project, /productType = "com\.apple\.product-type\.app-extension"/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.nine9sguide\.app\.FocusLiveActivity/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 16\.1/);
  assert.match(project, /FocusActivityAttributes\.swift in Sources/);
});

test("Phase 12 Live Activity presents a native Lock Screen and Dynamic Island UI", () => {
  assert.match(widget, /ActivityConfiguration\(for: FocusActivityAttributes\.self\)/);
  assert.match(widget, /DynamicIsland \{/);
  assert.match(widget, /DynamicIslandExpandedRegion\(\.leading\)/);
  assert.match(widget, /compactLeading:/);
  assert.match(widget, /compactTrailing:/);
  assert.match(widget, /minimal:/);
  assert.match(widget, /lectureTitle/);
  assert.match(widget, /sessionNumber/);
  assert.match(widget, /locale == "ar"/);
});
