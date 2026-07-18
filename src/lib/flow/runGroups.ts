export type RunLike = { batchId: string | null; status: string };

export type RunGroup<T extends RunLike> =
  | { kind: "single"; run: T }
  | { kind: "batch"; batchId: string; runs: T[]; total: number; succeeded: number; failed: number };

/**
 * Collapse consecutive runs that share a non-null batchId into one batch group.
 * Runs with a null batchId (single runs) are passed through untouched. Order is
 * preserved; callers pass runs already sorted (newest first).
 */
export function groupRuns<T extends RunLike>(runs: T[]): RunGroup<T>[] {
  const groups: RunGroup<T>[] = [];
  let current: { batchId: string; runs: T[] } | null = null;

  const flush = () => {
    if (!current) return;
    const succeeded = current.runs.filter((r) => r.status === "success").length;
    groups.push({
      kind: "batch",
      batchId: current.batchId,
      runs: current.runs,
      total: current.runs.length,
      succeeded,
      failed: current.runs.length - succeeded,
    });
    current = null;
  };

  for (const run of runs) {
    if (run.batchId === null) {
      flush();
      groups.push({ kind: "single", run });
      continue;
    }
    if (current && current.batchId === run.batchId) {
      current.runs.push(run);
    } else {
      flush();
      current = { batchId: run.batchId, runs: [run] };
    }
  }
  flush();
  return groups;
}
