export type FieldType = "string" | "number" | "boolean" | "string_array";

export interface FieldDef {
  name: string;
  type: FieldType;
  required: boolean;
  order: number;
}
