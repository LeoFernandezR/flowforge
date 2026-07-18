import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

afterEach(() => vi.unstubAllEnvs());

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

  test("records the attempt count on each step trace entry", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);

    let call = 0;
    const retryingProvider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        call++;
        return call === 1 ? { name: 123 } : { name: "Ada" }; // first invalid, then valid on retry
      },
    };
    await runFlow("flow_1", "Ada", { provider: retryingProvider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as {
      status: string;
      output: { steps: Array<{ status: string; attempts: number }> };
    };
    expect(arg.status).toBe("success");
    expect(arg.output.steps[0].status).toBe("success");
    expect(arg.output.steps[0].attempts).toBe(2);
  });

  test("records the exhausted attempt count on an errored step trace", async () => {
    vi.stubEnv("FLOWFORGE_MAX_VALIDATION_RETRIES", "2");
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);

    const alwaysInvalid: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => ({ name: 123 }), // always fails Zod (name must be string)
    };
    await runFlow("flow_1", "Ada", { provider: alwaysInvalid });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as {
      status: string;
      output: { steps: Array<{ status: string; attempts: number }> };
    };
    expect(arg.status).toBe("error");
    expect(arg.output.steps[0].status).toBe("error");
    expect(arg.output.steps[0].attempts).toBe(3);
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

  test("sets final to null when a later step fails after an earlier success", async () => {
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

    let call = 0;
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        call++;
        return call === 1 ? { name: "Ada" } : { name: 123 }; // step 2 fails Zod validation
      },
    };
    await runFlow("flow_1", "Ada", { provider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as {
      status: string;
      output: { final: unknown; steps: Array<{ status: string }> };
    };
    expect(arg.status).toBe("error");
    expect(arg.output.final).toBeNull();
    expect(arg.output.steps).toHaveLength(2);
    expect(arg.output.steps[0].status).toBe("success");
    expect(arg.output.steps[1].status).toBe("error");
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

  test("persists the given batchId on the run", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);
    await runFlow("flow_1", "Ada", { provider }, "batch_42");

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as { batchId: string | null };
    expect(arg.batchId).toBe("batch_42");
  });

  test("persists a null batchId when none is given", async () => {
    vi.mocked(prisma.flow.findUnique).mockResolvedValue(oneStepFlow as never);
    await runFlow("flow_1", "Ada", { provider });

    const arg = vi.mocked(prisma.run.create).mock.calls[0][0].data as unknown as { batchId: string | null };
    expect(arg.batchId).toBeNull();
  });
});
