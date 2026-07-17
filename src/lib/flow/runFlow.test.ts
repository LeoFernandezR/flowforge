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

const oneStepFlow = {
  id: "flow_1",
  name: "Contacts",
  provider: "gemini",
  steps: [
    {
      key: "extract1",
      type: "extract",
      prompt: "Extract from {{input}}",
      fields: [{ name: "name", type: "string", required: true, order: 0 }],
    },
  ],
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

  test("persists a success run with a final output and per-step trace", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);
    await runFlow("flow_1", "Ada", { provider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as {
      status: string;
      output: { final: unknown; steps: Array<{ key: string; status: string }> };
      provider: string;
      model: string;
      durationMs: number;
    };
    expect(arg.status).toBe("success");
    expect(arg.output.final).toEqual({ name: "Ada" });
    expect(arg.output.steps).toHaveLength(1);
    expect(arg.output.steps[0]).toMatchObject({ key: "extract1", status: "success" });
    expect(arg.provider).toBe("mock");
    expect(arg.model).toBe("mock-1");
    expect(typeof arg.durationMs).toBe("number");
  });

  test("feeds each step's output into the next step's template", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue({
      ...oneStepFlow,
      steps: [
        {
          key: "extract1",
          type: "extract",
          prompt: "Extract from {{input}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
        {
          key: "extract2",
          type: "extract",
          prompt: "Greet {{extract1.name}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
      ],
    } as never);

    const calls: string[] = [];
    const capturing: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async ({ input }) => {
        calls.push(input);
        return { name: "Ada" };
      },
    };
    await runFlow("flow_1", "raw text", { provider: capturing });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("raw text"); // {{input}} resolved
    expect(calls[1]).toContain("Ada"); // {{extract1.name}} resolved from step 1's output
  });

  test("halts on the first errored step", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue({
      ...oneStepFlow,
      steps: [
        {
          key: "extract1",
          type: "extract",
          prompt: "Extract {{input}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
        {
          key: "extract2",
          type: "extract",
          prompt: "Then {{extract1.name}}",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
      ],
    } as never);

    const badProvider: LlmProvider = { ...provider, generateStructured: async () => ({ name: 123 }) };
    await runFlow("flow_1", "Ada", { provider: badProvider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as {
      status: string;
      errorMessage: string;
      output: { final: unknown; steps: unknown[] };
    };
    expect(arg.status).toBe("error");
    expect(arg.output.steps).toHaveLength(1); // second step never ran
    expect(arg.output.final).toBeNull();
    expect(arg.errorMessage).toMatch(/Validation failed/);
  });

  test("persists an error run when a step's provider is unknown", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue({
      ...oneStepFlow,
      steps: [
        {
          key: "extract1",
          type: "extract",
          prompt: "Extract {{input}}",
          provider: "bogus",
          fields: [{ name: "name", type: "string", required: true, order: 0 }],
        },
      ],
    } as never);

    await runFlow("flow_1", "Ada", {}); // no deps.provider → getProvider("bogus") runs and throws

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as {
      status: string;
      errorMessage: string;
      output: { final: unknown; steps: unknown[] };
    };
    expect(arg.status).toBe("error");
    expect(arg.errorMessage).toMatch(/Unknown provider/);
    expect(arg.output.steps).toHaveLength(1);
    expect(arg.output.final).toBeNull();
  });
});
