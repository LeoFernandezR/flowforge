import { describe, expect, test } from "vitest";
import { generateStep } from "./generate";
import type { LlmProvider } from "../providers/types";

function mockProvider(returns: unknown): LlmProvider {
  return { name: "mock", model: "mock-1", generateStructured: async () => returns };
}

describe("generateStep", () => {
  test("returns { text } on success", async () => {
    const result = await generateStep.execute({
      prompt: "Write a haiku about Ada",
      fields: [],
      provider: mockProvider({ text: "code blooms in spring" }),
    });
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ text: "code blooms in spring" });
  });

  test("errors when the model omits text", async () => {
    const result = await generateStep.execute({
      prompt: "x",
      fields: [],
      provider: mockProvider({ notText: 1 }),
    });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/Validation failed/);
  });

  test("errors when the provider throws", async () => {
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        throw new Error("boom");
      },
    };
    const result = await generateStep.execute({ prompt: "x", fields: [], provider });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/LLM error: boom/);
  });
});
