import type { FieldDef } from "../types";
import type { LlmProvider } from "../providers/types";

export interface StepContext {
  prompt: string; // fully-resolved instruction (template already interpolated)
  fields: FieldDef[]; // output fields (extract). generate ignores this and uses its own.
  provider: LlmProvider;
}

export interface StepResult {
  status: "success" | "error";
  output: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface StepExecutor {
  execute(ctx: StepContext): Promise<StepResult>;
}
