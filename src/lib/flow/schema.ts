import { z } from "zod";
import { Type } from "@google/genai";
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

function baseJsonSchema(type: FieldDef["type"]): Record<string, unknown> {
  switch (type) {
    case "string":
      return { type: Type.STRING };
    case "number":
      return { type: Type.NUMBER };
    case "boolean":
      return { type: Type.BOOLEAN };
    case "string_array":
      return { type: Type.ARRAY, items: { type: Type.STRING } };
  }
}

export function buildJsonSchema(fields: FieldDef[]): object {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    const prop = baseJsonSchema(field.type);
    if (field.required) {
      required.push(field.name);
    } else {
      prop.nullable = true;
    }
    properties[field.name] = prop;
  }
  return { type: Type.OBJECT, properties, required };
}
