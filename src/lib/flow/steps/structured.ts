import { z } from "zod";
import { buildZodSchema } from "../schema";
import type { FieldDef } from "../types";
import type { LlmProvider } from "../providers/types";
import type { StepResult } from "./types";

const DEFAULT_MAX_VALIDATION_RETRIES = 2;

// Read the retry bound once per call. Default 2 (→ up to 3 attempts); overridable via env for
// tuning. 0 disables retries (single attempt). Unparseable/negative values fall back to the
// default rather than throwing, so a bad env var can never crash a run.
function getMaxValidationRetries(): number {
  const raw = process.env.FLOWFORGE_MAX_VALIDATION_RETRIES;
  if (raw === undefined) return DEFAULT_MAX_VALIDATION_RETRIES;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_VALIDATION_RETRIES;
}

// The correction addendum appended to the step input on each retry: the previous invalid
// response plus the Zod errors, so the model can fix its own output. The system instruction is
// left unchanged, so provider adapters need no awareness of retries.
function buildCorrection(raw: unknown, error: z.ZodError): string {
  return (
    "The previous response did not match the required schema.\n" +
    `Previous response:\n${JSON.stringify(raw)}\n` +
    `Validation errors:\n${JSON.stringify(z.treeifyError(error))}\n` +
    "Return a corrected response that satisfies the schema."
  );
}

// Shared structured-output path for step executors that ask the LLM to fill a Zod schema
// (extract's user-defined fields, generate's implicit `{ text }` field). Owns the
// call → validate → success/error mapping, plus bounded retry: on a Zod validation failure it
// re-prompts with the validation error fed back, up to the configured bound, before failing.
export async function runStructured(
  systemInstruction: string,
  prompt: string,
  fields: FieldDef[],
  provider: LlmProvider,
): Promise<StepResult> {
  const zodSchema = buildZodSchema(fields);
  const maxRetries = getMaxValidationRetries();

  let lastRaw: unknown;
  let lastError: z.ZodError | null = null;
  let lastErrorMessage = "";
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt += 1;
    // First attempt uses the plain input; retries append the correction block.
    const input = lastError === null ? prompt : `${prompt}\n\n${buildCorrection(lastRaw, lastError)}`;

    let raw: unknown;
    try {
      raw = await provider.generateStructured({ prompt: systemInstruction, input, fields });
    } catch (err) {
      // Provider/network error: fail fast, no retry.
      return {
        status: "error",
        output: null,
        errorMessage: `LLM error: ${(err as Error).message}`,
        attempts: attempt,
      };
    }

    const parsed = zodSchema.safeParse(raw);
    if (parsed.success) {
      return {
        status: "success",
        output: parsed.data as Record<string, unknown>,
        errorMessage: null,
        attempts: attempt,
      };
    }

    lastRaw = raw;
    lastError = parsed.error;
    lastErrorMessage = `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`;
  }

  return { status: "error", output: null, errorMessage: lastErrorMessage, attempts: attempt };
}
