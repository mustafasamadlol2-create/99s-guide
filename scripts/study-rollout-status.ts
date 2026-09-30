import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildRolloutStatus,
  summarizePrompt51Manifest,
} from "../server/release/rolloutGuard.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--json")) {
    console.error("Supported option: --json");
    process.exitCode = 1;
    return;
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(
      await readFile(resolve("docs/study-engine-platform-certification.json"), "utf8"),
    ) as unknown;
  } catch {
    manifest = null;
  }

  const prompt51 = summarizePrompt51Manifest(manifest);
  // This read-only command does not run Prompt50's release check. The operator
  // must provide a separately reviewed result before any external activation.
  const status = buildRolloutStatus({
    prompt51,
    releaseGateStatus: "NOT_RUN",
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    console.log(`Mode: ${status.mode}`);
    console.log(`Status: ${status.status}`);
    console.log(`Prompt 51 results: ${JSON.stringify(prompt51.counts)}`);
    console.log(`Prompt 50 release gate: ${status.releaseGateStatus} (not run by this command)`);
    console.log("Blockers:");
    for (const blocker of status.blockers) console.log(`- ${blocker}`);
    console.log(`Stages: ${status.stages.length}; production execution supported: no; writes: 0`);
    console.log("Declared flags without an effective runtime guard are labeled per stage.");
  }
  process.exitCode = status.status === "READY_FOR_OPERATOR_REVIEW" ? 0 : 2;
}

void main().catch(() => {
  console.error("Could not produce the local read-only rollout status.");
  process.exitCode = 1;
});