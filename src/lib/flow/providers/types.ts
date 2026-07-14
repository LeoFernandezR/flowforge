import type { FieldDef } from "../types";

export interface GenerateStructuredArgs {
  prompt: string;
  input: string;
  fields: FieldDef[];
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(args: GenerateStructuredArgs): Promise<unknown>;
}
