import { describe, expect, test } from "vitest";
import { flowSchema, fieldDefSchema, runInputSchema } from "./flow";

const extractStep = {
  key: "extract1",
  type: "extract",
  prompt: "Extract the contact from {{input}}",
  fields: [{ name: "email", type: "string", required: true, order: 0 }],
};

const validFlow = { name: "Contacts", steps: [extractStep] };

describe("flowSchema", () => {
  test("accepts a valid one-step flow", () => {
    expect(flowSchema.safeParse(validFlow).success).toBe(true);
  });

  test("rejects an empty name", () => {
    expect(flowSchema.safeParse({ ...validFlow, name: "  " }).success).toBe(false);
  });

  test("rejects a flow with no steps", () => {
    expect(flowSchema.safeParse({ ...validFlow, steps: [] }).success).toBe(false);
  });

  test("rejects an extract step with no fields", () => {
    expect(
      flowSchema.safeParse({ ...validFlow, steps: [{ ...extractStep, fields: [] }] }).success,
    ).toBe(false);
  });

  test("rejects duplicate field names within a step", () => {
    const step = {
      ...extractStep,
      fields: [
        { name: "email", type: "string", required: true, order: 0 },
        { name: "email", type: "number", required: false, order: 1 },
      ],
    };
    expect(flowSchema.safeParse({ ...validFlow, steps: [step] }).success).toBe(false);
  });

  test("rejects duplicate step keys", () => {
    const flow = { ...validFlow, steps: [extractStep, { ...extractStep, prompt: "Again {{input}}" }] };
    expect(flowSchema.safeParse(flow).success).toBe(false);
  });

  test("accepts a generate step with no fields", () => {
    const flow = {
      ...validFlow,
      steps: [extractStep, { key: "gen1", type: "generate", prompt: "Bio for {{extract1.email}}" }],
    };
    expect(flowSchema.safeParse(flow).success).toBe(true);
  });

  test("rejects an unknown variable reference", () => {
    const flow = { ...validFlow, steps: [{ ...extractStep, prompt: "Use {{nope.x}}" }] };
    expect(flowSchema.safeParse(flow).success).toBe(false);
  });

  test("rejects a forward reference to a later step", () => {
    const flow = {
      ...validFlow,
      steps: [
        { ...extractStep, prompt: "Use {{gen1.text}}" }, // references a step defined AFTER it
        { key: "gen1", type: "generate", prompt: "hi" },
      ],
    };
    expect(flowSchema.safeParse(flow).success).toBe(false);
  });

  test("accepts a valid backward reference", () => {
    const flow = {
      ...validFlow,
      steps: [
        extractStep,
        { key: "gen1", type: "generate", prompt: "Bio for {{extract1.email}} from {{input}}" },
      ],
    };
    expect(flowSchema.safeParse(flow).success).toBe(true);
  });

  test("accepts a valid provider and rejects an unknown one", () => {
    expect(flowSchema.safeParse({ ...validFlow, provider: "groq" }).success).toBe(true);
    expect(flowSchema.safeParse({ ...validFlow, provider: "openai" }).success).toBe(false);
  });

  test("defaults the provider to gemini", () => {
    expect(flowSchema.parse(validFlow).provider).toBe("gemini");
  });
});

describe("fieldDefSchema", () => {
  test("rejects a field name that is not an identifier", () => {
    expect(fieldDefSchema.safeParse({ name: "2bad", type: "string", required: true, order: 0 }).success).toBe(
      false,
    );
  });

  test("rejects an unknown type", () => {
    expect(fieldDefSchema.safeParse({ name: "x", type: "date", required: true, order: 0 }).success).toBe(false);
  });
});

describe("runInputSchema", () => {
  test("rejects empty input", () => {
    expect(runInputSchema.safeParse({ input: "   " }).success).toBe(false);
  });
});
