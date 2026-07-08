import { describe, expect, test } from "vitest";
import { flowSchema, fieldDefSchema, runInputSchema } from "./flow";

describe("flowSchema", () => {
  const validFlow = {
    name: "Contacts",
    prompt: "Extract the contact",
    fields: [{ name: "email", type: "string", required: true, order: 0 }],
  };

  test("accepts a valid flow", () => {
    expect(flowSchema.safeParse(validFlow).success).toBe(true);
  });

  test("rejects an empty name", () => {
    expect(flowSchema.safeParse({ ...validFlow, name: "  " }).success).toBe(false);
  });

  test("rejects a flow with no fields", () => {
    expect(flowSchema.safeParse({ ...validFlow, fields: [] }).success).toBe(false);
  });
});

describe("fieldDefSchema", () => {
  test("rejects a field name that is not an identifier", () => {
    const r = fieldDefSchema.safeParse({ name: "2bad", type: "string", required: true, order: 0 });
    expect(r.success).toBe(false);
  });

  test("rejects an unknown type", () => {
    const r = fieldDefSchema.safeParse({ name: "x", type: "date", required: true, order: 0 });
    expect(r.success).toBe(false);
  });
});

describe("runInputSchema", () => {
  test("rejects empty input", () => {
    expect(runInputSchema.safeParse({ input: "   " }).success).toBe(false);
  });
});
