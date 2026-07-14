import { z } from "zod";
import { buildZodSchema } from "../schema";
import type { StepContext, StepExecutor, StepResult } from "./types";

const SYSTEM_INSTRUCTION =
  "You are a data extraction engine. Extract the requested fields from the input. " +
  "Return only the fields defined in the schema, with no extra commentary.";

export const extractStep: StepExecutor = {
  async execute({ prompt, input, fields, provider }: StepContext): Promise<StepResult> {
    const zodSchema = buildZodSchema(fields);

    let raw: unknown;
    try {
      raw = await provider.generateStructured({
        prompt: `${SYSTEM_INSTRUCTION}\n\n${prompt}`,
        input,
        fields,
      });
    } catch (err) {
      return {
        status: "error",
        output: null,
        errorMessage: `LLM error: ${(err as Error).message}`,
      };
    }

    const parsed = zodSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        status: "error",
        output: null,
        errorMessage: `Validation failed: ${JSON.stringify(z.treeifyError(parsed.error))}`,
      };
    }

    return {
      status: "success",
      output: parsed.data as Record<string, unknown>,
      errorMessage: null,
    };
  },
};
