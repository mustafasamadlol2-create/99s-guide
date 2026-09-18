import "dotenv/config";
import { getPrisma, disconnectPrisma } from "../server/services/prismaClient.js";
import { backfillMcqMetadata, type McqBackfillRow } from "../server/services/mcqBackfill.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const beforeText = argument("--before");
const apply = process.argv.includes("--apply");

if (!beforeText || !apply) {
  console.error("Usage: npm run backfill:mcq-metadata -- --before <ISO_TIMESTAMP> --apply");
  process.exitCode = 2;
} else {
  const before = new Date(beforeText);
  if (!Number.isFinite(before.getTime())) {
    console.error("--before must be a valid ISO timestamp.");
    process.exitCode = 2;
  } else {
    const prisma = getPrisma();
    const workerBaseUrl = process.env.CONTENT_WORKER_BASE_URL?.trim().replace(/\/+$/, "");
    const syncSecret = process.env.CONTENT_SYNC_SECRET?.trim();
    const outboxPrefix = "__content_sync_pending__:";

    const rowPayload = (row: McqBackfillRow) => ({
      id: row.id,
      question: row.question,
      optionA: row.optionA,
      optionB: row.optionB,
      optionC: row.optionC,
      optionD: row.optionD,
      correctAnswer: row.correctAnswer,
      hint: row.hint ?? null,
      explanation: row.explanation ?? null,
      sourceType: "AI_GENERATED",
      sourceRef: row.sourceRef ?? "",
      difficulty: "Medium",
      lectureId: row.lectureId,
      createdAt: row.createdAt,
    });

    const syncOrQueue = async (row: McqBackfillRow) => {
      const mutation = {
        version: 1 as const,
        entity: "Mcq" as const,
        operation: "upsert" as const,
        id: row.id,
        data: rowPayload(row),
        occurredAt: new Date().toISOString(),
      };
      if (workerBaseUrl && syncSecret) {
        try {
          const response = await fetch(`${workerBaseUrl}/internal/content-sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Content-Sync-Secret": syncSecret,
            },
            body: JSON.stringify(mutation),
          });
          if (response.ok) return;
        } catch {
          // The durable outbox below is the normal fallback for an unavailable worker.
        }
      }
      await prisma.systemSetting.upsert({
        where: { key: `${outboxPrefix}Mcq:${row.id}` },
        update: { value: JSON.stringify(mutation), updatedAt: new Date() },
        create: { key: `${outboxPrefix}Mcq:${row.id}`, value: JSON.stringify(mutation), updatedAt: new Date() },
      });
    };

    try {
      const report = await backfillMcqMetadata(prisma, before, {
        apply: true,
        onChanged: syncOrQueue,
      });
      console.log(JSON.stringify({
        before: before.toISOString(),
        scanned: report.scanned,
        changed: report.changed,
        syncedOrQueued: report.rows.length,
      }, null, 2));
    } finally {
      await disconnectPrisma();
    }
  }
}