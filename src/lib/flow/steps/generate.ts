import type { FieldDef } from "../types";
import { runStructured } from "./structured";
import type { StepContext, StepExecutor, StepResult } from "./types";

const SYSTEM_INSTRUCTION =
  "You are a helpful assistant. Produce the requested text. " +
  "Return the result as the `text` field, with no extra commentary.";

// A generate step is a structured step with one implicit field, so it reuses the whole
// structured-output path (no new provider method) and outputs a uniform { text } object.
const GENERATE_FIELDS: FieldDef[] = [{ name: "text", type: "string", required: true, order: 0 }];

export const generateStep: StepExecutor = {
  async execute({ prompt, provider }: StepContext): Promise<StepResult> {
    return runStructured(SYSTEM_INSTRUCTION, prompt, GENERATE_FIELDS, provider);
  },
};
