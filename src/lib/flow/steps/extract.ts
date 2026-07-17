import { runStructured } from "./structured";
import type { StepContext, StepExecutor, StepResult } from "./types";

const SYSTEM_INSTRUCTION =
  "You are a data extraction engine. Extract the requested fields from the input. " +
  "Return only the fields defined in the schema, with no extra commentary.";

export const extractStep: StepExecutor = {
  async execute({ prompt, fields, provider }: StepContext): Promise<StepResult> {
    return runStructured(SYSTEM_INSTRUCTION, prompt, fields, provider);
  },
};
