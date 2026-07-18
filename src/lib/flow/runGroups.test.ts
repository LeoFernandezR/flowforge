import { describe, expect, test } from "vitest";
import { groupRuns } from "./runGroups";

describe("groupRuns", () => {
  test("leaves runs with a null batchId as singles", () => {
    const groups = groupRuns([
      { batchId: null, status: "success" },
      { batchId: null, status: "error" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "single")).toBe(true);
  });

  test("collapses consecutive runs sharing a batchId with correct counts", () => {
    const groups = groupRuns([
      { batchId: "b1", status: "success" },
      { batchId: "b1", status: "error" },
      { batchId: "b1", status: "success" },
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.kind).toBe("batch");
    if (g.kind === "batch") {
      expect(g.total).toBe(3);
      expect(g.succeeded).toBe(2);
      expect(g.failed).toBe(1);
      expect(g.batchId).toBe("b1");
    }
  });

  test("separates a single run sitting between two batches", () => {
    const groups = groupRuns([
      { batchId: "b2", status: "success" },
      { batchId: null, status: "success" },
      { batchId: "b1", status: "success" },
      { batchId: "b1", status: "success" },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["batch", "single", "batch"]);
  });

  test("does not merge two different adjacent batches", () => {
    const groups = groupRuns([
      { batchId: "b2", status: "success" },
      { batchId: "b1", status: "success" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "batch")).toBe(true);
  });
});
