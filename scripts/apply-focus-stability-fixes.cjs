'use strict';
/* Guarded Focus stability fixes. Uses exact anchors and atomic writes; never replaces
 * an entire source file. Must run from the app root. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.cwd();
const apply = process.argv.includes('--apply');
const rollback = process.argv.includes('--rollback');
const backupRoot = path.join(root, '.focus-stability-backup');
const changes = [];
function edit(rel, transformations) {
  const filename = path.join(root, rel);
  if (!fs.existsSync(filename)) throw Error(`MISSING_FILE: ${rel}. No files changed.`);
  const before = fs.readFileSync(filename, 'utf8');
  let value = before;
  for (const t of transformations) {
    if (value.includes(t.after)) continue; // already patched
    const count = value.split(t.before).length - 1;
    if (count !== 1) throw Error(`ANCHOR_MISMATCH in ${rel}: ${t.label}; found=${count}. No files changed.`);
    value = value.replace(t.before, t.after);
  }
  changes.push({ rel, filename, before, after: value });
}
const modifications = [
  {rel:'server.ts', changes:[{
    label:'scoped R2 signed audio CSP',
    before:'"media-src \'self\' blob:",',
    after:'"media-src \'self\' blob: https://*.r2.cloudflarestorage.com",',
  }]},
  {rel:'src/features/focus/components/FocusAudioPlanningCard.tsx', changes:[{
    label:'shared audio should not be called local-only',
    before:'{hasSelection && (\n            <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">',
    after:'{audio.sourceType === "USER_AUDIO" && (\n            <p className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">',
  },{
    label:'session-only should be for local files only',
    before:'{hasSelection && (\n        <p className="focus-audio-session',
    after:'{audio.sourceType === "USER_AUDIO" && (\n        <p className="focus-audio-session',
  },{
    label:'specific shared audio error message',
    before:'{t("focusHubAudioError")}\n        </p>',
    after:'{audio.sourceType === "AMBIENT" && sharedSounds.some((sound) => sound.id === audio.ambientTrackId)\n            ? (isRtl ? "تعذّر تشغيل الصوت المشترك. تحقق من الوصول إلى الملف في R2 وإعدادات المتصفح، ثم اختر الصوت من جديد." : "Shared sound could not play. Check R2 media access/browser policy, then select the sound again.")\n            : t("focusHubAudioError")}\n        </p>',
  }]},
  {rel:'src/features/focus/components/ActiveFocusScreen.tsx', changes:[{
    label:'resource-open concurrency gate',
    before:'  const [openingResourceId, setOpeningResourceId] = useState<string | null>(null);',
    after:'  const [openingResourceId, setOpeningResourceId] = useState<string | null>(null);\n  const resourceOpenInFlightRef = useRef(false);',
  },{
    label:'sync break canonical state into controller after confirmed read',
    before:'        setBreakSnapshot(snapshot);\n        if (snapshot.breakSession) {',
    after:'        setBreakSnapshot(snapshot);\n        // Break reads include the canonical Focus session. Reconcile the local\n        // controller if another tab, a resource handoff, or the server changed\n        // the state since the most recent current-session read.\n        const controllerState = controller.getState();\n        if (controllerState.sessionAuthority === "CANONICAL" &&\n            controllerState.session?.id === snapshot.session.id &&\n            controllerState.session.status !== snapshot.session.status &&\n            controllerState.runtimeStatus !== "MUTATING") {\n          controller.acceptMutationSession(snapshot.session);\n        }\n        if (snapshot.breakSession) {',
  },{
    label:'handoff phase transition protection',
    before:'  const handlePhaseChange = (nextPhase: FocusDisplayPhase) => {\n    if (nextPhase === "plan") {',
    after:'  const handlePhaseChange = (nextPhase: FocusDisplayPhase) => {\n    // A handoff is a distinct canonical state. Return to ACTIVE first: issuing\n    // a Break transition while the session is RESOURCE_HANDOFF always fails.\n    if (canonicalSession?.status === "RESOURCE_HANDOFF" && nextPhase !== "plan") {\n      if (!controller || !mayChangeSession) return;\n      void perform(\n        () => controller.returnFromResourceHandoff(),\n        () => { setActivePhase("focus"); setResourceError(false); },\n        async () => { await controller.reconcile().catch(() => {}); },\n      );\n      return;\n    }\n    if (nextPhase === "plan") {',
  },{
    label:'PDF single-flight guard',
    before:'  const openPdf = async (material: Material) => {\n    if (!controller || !mayChangeSession) return;',
    after:'  const openPdf = async (material: Material) => {\n    if (!controller || !mayChangeSession || resourceOpenInFlightRef.current) return;',
  },{
    label:'PDF guard lock',
    before:'    setOpeningResourceId(material.id);\n    setResourceError(false);\n    try {\n      await controller.openResourceWithHandoff(\n        { resourceType: "PDF",',
    after:'    resourceOpenInFlightRef.current = true;\n    setOpeningResourceId(material.id);\n    setResourceError(false);\n    try {\n      await controller.openResourceWithHandoff(\n        { resourceType: "PDF",',
  },{
    label:'PDF guard release',
    before:'    } finally {\n      setOpeningResourceId(null);\n    }\n  };\n\n  const openVideo',
    after:'    } finally {\n      resourceOpenInFlightRef.current = false;\n      setOpeningResourceId(null);\n    }\n  };\n\n  const openVideo',
  },{
    label:'VIDEO single-flight guard',
    before:'  const openVideo = async (material: Material) => {\n    if (!controller || !mayChangeSession) return;',
    after:'  const openVideo = async (material: Material) => {\n    if (!controller || !mayChangeSession || resourceOpenInFlightRef.current) return;',
  },{
    label:'VIDEO guard lock',
    before:'    setOpeningResourceId(material.id);\n    setResourceError(false);\n    try {\n      await controller.openResourceWithHandoff(\n        { resourceType: "VIDEO",',
    after:'    resourceOpenInFlightRef.current = true;\n    setOpeningResourceId(material.id);\n    setResourceError(false);\n    try {\n      await controller.openResourceWithHandoff(\n        { resourceType: "VIDEO",',
  },{
    label:'VIDEO guard release',
    before:'    } finally {\n      setOpeningResourceId(null);\n    }\n  };\n\n  const materials = useMemo(',
    after:'    } finally {\n      resourceOpenInFlightRef.current = false;\n      setOpeningResourceId(null);\n    }\n  };\n\n  const materials = useMemo(',
  },{
    label:'disable all materials while a resource is opening',
    before:'disabled={!canOpenResources || isOpening}',
    after:'disabled={!canOpenResources || openingResourceId !== null}',
  }]},
  {rel:'src/features/group-focus/runtime/groupFocusRealtime.ts',changes:[{
    label:'websocket handshake timeout cleanup state',
    before:'      let transportError: GroupFocusRealtimeError | null = null;\n      const fail = (failure: GroupFocusRealtimeRuntimeError) => {',
    after:'      let transportError: GroupFocusRealtimeError | null = null;\n      let handshakeTimer: ReturnType<typeof setTimeout> | null = null;\n      const clearHandshakeTimer = () => {\n        if (handshakeTimer !== null) clearTimeout(handshakeTimer);\n        handshakeTimer = null;\n      };\n      const fail = (failure: GroupFocusRealtimeRuntimeError) => {',
  },{
    label:'clear handshake timeout on failure',
    before:'        settled = true;\n        this.pendingConnectionReject = null;\n        if (this.socket === socket) this.socket = null;',
    after:'        settled = true;\n        clearHandshakeTimer();\n        this.pendingConnectionReject = null;\n        if (this.socket === socket) this.socket = null;',
  },{
    label:'clear handshake timeout after successful websocket open',
    before:'        settled = true;\n        this.pendingConnectionReject = null;\n        this.reconnectAttempts = 0;',
    after:'        settled = true;\n        clearHandshakeTimer();\n        this.pendingConnectionReject = null;\n        this.reconnectAttempts = 0;',
  },{
    label:'abort a stuck handshake instead of indefinitely connecting',
    before:'        this.pendingConnectionReject = fail;\n      });',
    after:'        this.pendingConnectionReject = fail;\n        handshakeTimer = setTimeout(() => {\n          if (generation !== this.generation || settled) return;\n          fail(new GroupFocusRealtimeRuntimeError(\n            "CONNECTION_TIMEOUT",\n            "The Group Focus connection did not respond. Please retry or check the Worker status.",\n          ));\n        }, 12_000);\n      });',
  }]},
  {rel:'src/features/group-focus/GroupFocusFrontend.tsx',changes:[{
    label:'cache confirmed newly created room for immediate bootstrap',
    before:'  const mountedRef = useRef(true);',
    after:'  const mountedRef = useRef(true);\n  // This is the canonical result of our own successful create mutation, not\n  // speculative room state. Avoid blocking the first socket connection on a\n  // redundant GET that may wait on a cold database connection.\n  const justCreatedRoomRef = useRef<GroupFocusRoomDetail | null>(null);',
  },{
    label:'prefill created room after server confirms transaction',
    before:'      createAttempt.current = null;\n      setInviteToken(null);\n      onRouteChange(`room/${encodeURIComponent(result.room.id)}`);',
    after:'      createAttempt.current = null;\n      justCreatedRoomRef.current = {\n        room: result.room,\n        membership: result.membership,\n        effectiveLectureId: result.room.mode === "SHARED_LECTURE"\n          ? result.room.sharedLectureId\n          : result.membership.selectedLectureId,\n      };\n      setInviteToken(null);\n      onRouteChange(`room/${encodeURIComponent(result.room.id)}`);',
  },{
    label:'room details fast-path for newly created rooms',
    before:'    setMemberRemovalPendingUserId(null);\n\n    void getGroupFocusRoom(route.roomId).then((detail) => {',
    after:'    setMemberRemovalPendingUserId(null);\n\n    const freshlyCreated = justCreatedRoomRef.current;\n    const verifiedCreate = freshlyCreated?.room.id === route.roomId &&\n      freshlyCreated.membership?.userId === accountId &&\n      freshlyCreated.membership.status === "ACTIVE";\n    if (verifiedCreate && freshlyCreated) {\n      setRoomDetail(freshlyCreated);\n      setRoomStatus("ready");\n      justCreatedRoomRef.current = null;\n    }\n\n    void getGroupFocusRoom(route.roomId).then((detail) => {',
  },{
    label:'keep canonical create-confirmed room usable if redundant detail GET fails',
    before:'    }).catch((error: unknown) => {\n      if (cancelled || !mountedRef.current) return;\n      setRoomStatus("error");\n      setRoomError(groupFocusErrorMessage(',
    after:'    }).catch((error: unknown) => {\n      if (cancelled || !mountedRef.current) return;\n      // The create response already proved membership. WebSocket capability\n      // issuance will independently revalidate it. Do not turn a temporary\n      // detail-fetch outage into a false "room unavailable" error.\n      if (verifiedCreate) return;\n      setRoomStatus("error");\n      setRoomError(groupFocusErrorMessage(',
  }]},
];
if (rollback) {
  if (!fs.existsSync(backupRoot)) throw Error('No .focus-stability-backup directory found.');
  for (const item of modifications) {
    const backup = path.join(backupRoot, item.rel);
    if (!fs.existsSync(backup)) throw Error(`Missing backup ${item.rel}; abort rollback.`);
  }
  for (const item of modifications) {
    const backup = path.join(backupRoot, item.rel);
    fs.copyFileSync(backup, path.join(root, item.rel));
    console.log('[ROLLBACK]',item.rel);
  }
  process.exit(0);
}
try {
  for (const item of modifications) edit(item.rel, item.changes);
} catch (error) {
  console.error('[FocusPatch] CHECK FAILED:',error.message);
  process.exit(2);
}
const changed = changes.filter((item) => item.before !== item.after);
console.log(`[FocusPatch] ${apply ? 'APPLY' : 'CHECK_ONLY'} compatible=${changes.length}; changed=${changed.length}; already-patched=${changes.length-changed.length}`);
for (const item of changed) console.log(' ',item.rel);
if (!apply) {
  console.log('[FocusPatch] No writes. Run with --apply after backing up your project.');
  process.exit(0);
}
if (fs.existsSync(backupRoot) && changed.length > 0) {
  console.error('[FocusPatch] Backup already exists; do not overwrite original backups. Commit, move, or remove old backup only after verifying it.');
  process.exit(3);
}
const staged = [];
try {
  for (const item of changed) {
    const backup = path.join(backupRoot, item.rel);
    fs.mkdirSync(path.dirname(backup), {recursive:true});
    fs.writeFileSync(backup, item.before, {flag:'wx'});
    const temp = `${item.filename}.focus-${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temp, item.after);
    staged.push({item,temp});
  }
  for (const {item,temp} of staged) {
    fs.renameSync(temp, item.filename);
    console.log('[FocusPatch] PATCHED:',item.rel);
  }
  console.log('[FocusPatch] Done. Source backups: .focus-stability-backup/. Run npm run typecheck && npm run build.');
} catch (error) {
  console.error('[FocusPatch] Write failure. Restoring original files.', error);
  for (const {item,temp} of staged) {
    if (fs.existsSync(temp)) fs.rmSync(temp,{force:true});
    fs.writeFileSync(item.filename,item.before);
  }
  process.exit(4);
}
