type StudyPointsPostCommitHook = (userId: string) => Promise<unknown>;

let postCommitHook: StudyPointsPostCommitHook | undefined;

export function setStudyPointsPostCommitHook(
  hook: StudyPointsPostCommitHook | undefined,
): void {
  postCommitHook = hook;
}

/**
 * Cosmetic listeners run only after the canonical Study Points transaction
 * commits. A listener failure must never roll back the points mutation.
 */
export async function notifyStudyPointsPostCommit(userId: string): Promise<void> {
  if (!postCommitHook) return;
  try {
    await postCommitHook(userId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[Study Points] Post-commit listener failed: ${reason}`);
  }
}