import type { FieldDef } from "../types";
import type { LlmProvider } from "../providers/types";

export interface StepContext {
  prompt: string;
  input: string;
  fields: FieldDef[];
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
