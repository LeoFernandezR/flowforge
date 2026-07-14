import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    flow: { findUnique: vi.fn() },
    run: { create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { runFlow } from "./runFlow";
import type { LlmProvider } from "./providers/types";

const provider: LlmProvider = {
  name: "mock",
  model: "mock-1",
  generateStructured: async () => ({ name: "Ada" }),
};

const flowRow = {
  id: "flow_1",
  name: "Contacts",
  prompt: "extract",
  taskType: "extract",
  fields: [{ name: "name", type: "string", required: true, order: 0 }],
};

beforeEach(() => {
  vi.mocked(prisma.run.create).mockReset();
  vi.mocked(prisma.flow.findUnique).mockReset();
  vi.mocked(prisma.run.create).mockImplementation((async ({ data }: { data: unknown }) => ({
    id: "run_1",
    ...(data as object),
  })) as never);
});

describe("runFlow", () => {
  test("throws when the flow does not exist", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(null);
    await expect(runFlow("missing", "hi", { provider })).rejects.toThrow("Flow not found");
  });

  test("persists a success run with output and provider metadata", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(flowRow as never);
    await runFlow("flow_1", "Ada", { provider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data;
    expect(arg).toMatchObject({
      flowId: "flow_1",
      input: "Ada",
      status: "success",
      output: { name: "Ada" },
      provider: "mock",
      model: "mock-1",
    });
    expect(typeof arg.durationMs).toBe("number");
  });

  test("persists an error run when validation fails", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(flowRow as never);
    const badProvider: LlmProvider = { ...provider, generateStructured: async () => ({ name: 123 }) };
    await runFlow("flow_1", "Ada", { provider: badProvider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data;
    expect(arg.status).toBe("error");
    expect(arg.output).toBeUndefined();
    expect(arg.errorMessage).toMatch(/Validation failed/);
  });
});
