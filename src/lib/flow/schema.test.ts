import { describe, expect, test } from "vitest";
import { buildZodSchema } from "./schema";
import type { FieldDef } from "./types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
  { name: "tags", type: "string_array", required: false, order: 2 },
];

describe("buildZodSchema", () => {
  test("accepts a matching object (nullable field present as null)", () => {
    const schema = buildZodSchema(fields);
    const r = schema.safeParse({ name: "Ada", age: 36, tags: null });
    expect(r.success).toBe(true);
  });

  test("rejects a wrong type", () => {
    const schema = buildZodSchema(fields);
    const r = schema.safeParse({ name: "Ada", age: "old", tags: null });
    expect(r.success).toBe(false);
  });

  test("requires the key even when the field is not required (nullable, not optional)", () => {
    const schema = buildZodSchema(fields);
    const r = schema.safeParse({ name: "Ada", age: 36 });
    expect(r.success).toBe(false);
  });
});
