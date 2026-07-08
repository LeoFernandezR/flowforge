import { z } from "zod";

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

export const flowSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  prompt: z.string().trim().min(1, "Prompt is required").max(10_000),
  fields: z.array(fieldDefSchema).min(1, "Add at least one field"),
});

export const runInputSchema = z.object({
  input: z.string().trim().min(1, "Input is required"),
});

export type FlowInput = z.infer<typeof flowSchema>;
export type RunInput = z.infer<typeof runInputSchema>;
