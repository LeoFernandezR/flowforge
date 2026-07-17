import { z } from "zod";
import { buildZodSchema } from "../schema";
import type { FieldDef } from "../types";
import type { LlmProvider } from "../providers/types";
import type { StepResult } from "./types";

// Shared structured-output path for step executors that ask the LLM to fill a Zod schema
// (extract's user-defined fields, generate's implicit `{ text }` field). Both executors are
// thin wrappers that supply the system instruction and field set; this owns the call →
// validate → success/error mapping.
export async function runStructured(
  systemInstruction: string,
  prompt: string,
  fields: FieldDef[],
  provider: LlmProvider,
): Promise<StepResult> {
  const zodSchema = buildZodSchema(fields);

  let raw: unknown;
  try {
    raw = await provider.generateStructured({ prompt: systemInstruction, input: prompt, fields });
  } catch (err) {
    return { status: "error", output: null, errorMessage: `LLM error: ${(err as Error).message}` };
  }

  const parsed = zodSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      output: null,
      errorMessage: `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`,
    };
  }

  return { status: "success", output: parsed.data as Record<string, unknown>, errorMessage: null };
}
