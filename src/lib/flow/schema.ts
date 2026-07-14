import { z } from "zod";
import type { FieldDef } from "./types";

function baseZod(type: FieldDef["type"]): z.ZodTypeAny {
  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "string_array":
      return z.array(z.string());
  }
}

export function buildZodSchema(fields: FieldDef[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const base = baseZod(field.type);
    shape[field.name] = field.required ? base : base.nullable();
  }
  return z.object(shape);
}
