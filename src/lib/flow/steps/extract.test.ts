import { describe, expect, test } from "vitest";
import { extractStep } from "./extract";
import type { LlmProvider } from "../providers/types";
import type { FieldDef } from "../types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
];

function mockProvider(returns: unknown): LlmProvider {
  return { name: "mock", model: "mock-1", generateStructured: async () => returns };
}

describe("extractStep", () => {
  test("returns typed success when the LLM output validates", async () => {
    const result = await extractStep.execute({
      prompt: "Extract from: Ada, 36",
      fields,
      provider: mockProvider({ name: "Ada", age: 36 }),
    });
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ name: "Ada", age: 36 });
    expect(result.errorMessage).toBeNull();
  });

  test("returns an error when the LLM output fails Zod validation", async () => {
    const result = await extractStep.execute({
      prompt: "Extract from: Ada, old",
      fields,
      provider: mockProvider({ name: "Ada", age: "old" }),
    });
    expect(result.status).toBe("error");
    expect(result.output).toBeNull();
    expect(result.errorMessage).toMatch(/Validation failed/);
  });

  test("returns an error when the provider throws", async () => {
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        throw new Error("network down");
      },
    };
    const result = await extractStep.execute({ prompt: "x", fields, provider });
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/LLM error: network down/);
  });
});
