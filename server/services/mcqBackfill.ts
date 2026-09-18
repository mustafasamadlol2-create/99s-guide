export type McqBackfillRow = {
  id: string;
  sourceType: string | null;
  difficulty: string | null;
  createdAt?: Date | string | null;
  [key: string]: unknown;
};

export type McqBackfillPrisma = {
  mcq: {
    findMany(args: unknown): Promise<McqBackfillRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

export async function backfillMcqMetadata(
  prisma: McqBackfillPrisma,
  before: Date,
  options: {
    apply: boolean;
    onChanged?: (row: McqBackfillRow) => Promise<void>;
  },
): Promise<{ scanned: number; changed: number; rows: McqBackfillRow[] }> {
  const rows = await prisma.mcq.findMany({
    where: { createdAt: { lt: before } },
    select: {
      id: true,
      sourceType: true,
      difficulty: true,
      question: true,
      optionA: true,
      optionB: true,
      optionC: true,
      optionD: true,
      correctAnswer: true,
      hint: true,
      explanation: true,
      sourceRef: true,
      lectureId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const changedRows = rows.filter(
    (row) => row.sourceType !== "AI_GENERATED" || row.difficulty !== "Medium",
  );

  if (!options.apply || changedRows.length === 0) {
    return { scanned: rows.length, changed: changedRows.length, rows: changedRows };
  }

  const result = await prisma.mcq.updateMany({
    where: {
      id: { in: changedRows.map((row) => row.id) },
      createdAt: { lt: before },
    },
    data: { sourceType: "AI_GENERATED", difficulty: "Medium" },
  });

  if (options.onChanged) {
    for (const row of changedRows) {
      await options.onChanged({
        ...row,
        sourceType: "AI_GENERATED",
        difficulty: "Medium",
      });
    }
  }

  return { scanned: rows.length, changed: result.count, rows: changedRows };
}