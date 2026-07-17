import { z } from "zod";
import { parseRefs, stepOutputFields } from "@/lib/flow/template";
import type { Step } from "@/lib/flow/types";

export const PROVIDER_NAMES = ["gemini", "groq"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const fieldTypeSchema = z.enum(["string", "number", "boolean", "string_array"]);

export const fieldDefSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Field name is required")
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Must be a valid identifier"),
  type: fieldTypeSchema,
  required: z.boolean(),
  order: z.number().int().nonnegative(),
});

export const stepTypeSchema = z.enum(["extract", "generate"]);

export const stepSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Step key must be a valid identifier"),
    type: stepTypeSchema,
    name: z.string().trim().max(120).optional(),
    prompt: z.string().trim().min(1, "Prompt is required").max(10_000),
    provider: z.enum(PROVIDER_NAMES).optional(),
    fields: z.array(fieldDefSchema).optional(),
  })
  .superRefine((step, ctx) => {
    if (step.type === "extract") {
      const fields = step.fields ?? [];
      if (fields.length < 1) {
        ctx.addIssue({ code: "custom", message: "Extract steps need at least one field", path: ["fields"] });
      }
      if (new Set(fields.map((f) => f.name)).size !== fields.length) {
        ctx.addIssue({ code: "custom", message: "Field names must be unique", path: ["fields"] });
      }
    }
  });

export const flowSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    provider: z.enum(PROVIDER_NAMES).default("gemini"),
    steps: z.array(stepSchema).min(1, "Add at least one step"),
  })
  .superRefine((flow, ctx) => {
    const keys = flow.steps.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", message: "Step keys must be unique", path: ["steps"] });
    }

    flow.steps.forEach((step, i) => {
      const prior = flow.steps.slice(0, i) as Step[];
      const allowed = new Set<string>(["input"]);
      for (const p of prior) {
        for (const field of stepOutputFields(p)) allowed.add(`${p.key}.${field}`);
      }
      for (const ref of parseRefs(step.prompt)) {
        if (!allowed.has(ref.raw)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown variable {{${ref.raw}}}`,
            path: ["steps", i, "prompt"],
          });
        }
      }
    });
  });

export const runInputSchema = z.object({
  input: z.string().trim().min(1, "Input is required"),
});

export type FlowInput = z.infer<typeof flowSchema>;
export type RunInput = z.infer<typeof runInputSchema>;
