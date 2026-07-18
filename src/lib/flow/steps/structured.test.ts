import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runStructured } from "./structured";
import type { LlmProvider } from "../providers/types";
import type { FieldDef } from "../types";

const SYS = "system instruction";
const fields: FieldDef[] = [{ name: "name", type: "string", required: true, order: 0 }];

// Returns each scripted value in turn on successive calls (repeating the last once exhausted),
// and records every `input` it was called with so retries can be inspected.
function scriptedProvider(responses: unknown[]): { provider: LlmProvider; inputs: string[] } {
  const inputs: string[] = [];
  let i = 0;
  const provider: LlmProvider = {
    name: "mock",
    model: "mock-1",
    generateStructured: async ({ input }) => {
      inputs.push(input);
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r;
    },
  };
  return { provider, inputs };
}

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => vi.stubEnv("FLOWFORGE_MAX_VALIDATION_RETRIES", "2"));

describe("runStructured", () => {
  test("succeeds on the first attempt", async () => {
    const { provider, inputs } = scriptedProvider([{ name: "Ada" }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result).toEqual({
      status: "success",
      output: { name: "Ada" },
      errorMessage: null,
      attempts: 1,
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toBe("extract"); // no correction block on the first attempt
  });

  test("retries after an invalid response and records the attempt count", async () => {
    const { provider, inputs } = scriptedProvider([{ name: 123 }, { name: "Ada" }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("success");
    expect(result.output).toEqual({ name: "Ada" });
    expect(result.attempts).toBe(2);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("did not match the required schema");
    expect(inputs[1]).toContain("Validation errors");
  });

  test("fails after exhausting the default bound of 2 retries", async () => {
    const { provider, inputs } = scriptedProvider([{ name: 1 }, { name: 2 }, { name: 3 }, { name: 4 }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("error");
    expect(result.output).toBeNull();
    expect(result.errorMessage).toMatch(/Validation failed/);
    expect(result.attempts).toBe(3); // 1 initial + 2 retries
    expect(inputs).toHaveLength(3);
  });

  test("FLOWFORGE_MAX_VALIDATION_RETRIES=0 disables retries", async () => {
    vi.stubEnv("FLOWFORGE_MAX_VALIDATION_RETRIES", "0");
    const { provider, inputs } = scriptedProvider([{ name: 1 }, { name: "Ada" }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("error");
    expect(result.attempts).toBe(1);
    expect(inputs).toHaveLength(1);
  });

  test("an unparseable env value falls back to the default bound", async () => {
    vi.stubEnv("FLOWFORGE_MAX_VALIDATION_RETRIES", "not-a-number");
    const { provider } = scriptedProvider([{ name: 1 }, { name: 2 }, { name: 3 }, { name: 4 }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.attempts).toBe(3); // fell back to default 2 retries
  });

  test("a negative env value falls back to the default bound", async () => {
    vi.stubEnv("FLOWFORGE_MAX_VALIDATION_RETRIES", "-1");
    const { provider } = scriptedProvider([{ name: 1 }, { name: 2 }, { name: 3 }, { name: 4 }]);
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.attempts).toBe(3); // fell back to default 2 retries
  });

  test("does not retry when the provider throws", async () => {
    let calls = 0;
    const provider: LlmProvider = {
      name: "mock",
      model: "mock-1",
      generateStructured: async () => {
        calls += 1;
        throw new Error("network down");
      },
    };
    const result = await runStructured(SYS, "extract", fields, provider);
    expect(result.status).toBe("error");
    expect(result.errorMessage).toMatch(/LLM error: network down/);
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });
});
