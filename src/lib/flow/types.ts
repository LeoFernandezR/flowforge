export type FieldType = "string" | "number" | "boolean" | "string_array";

export interface FieldDef {
  name: string;
  type: FieldType;
  required: boolean;
  order: number;
}

export type StepType = "extract" | "generate";

export interface Step {
  key: string;
  type: StepType;
  name?: string;
  prompt: string;
  provider?: string; // omitted ⇒ inherit flow default; constrained to a ProviderName by Zod
  fields?: FieldDef[]; // extract only
}
