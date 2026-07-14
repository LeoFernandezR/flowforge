import { describe, expect, test } from "vitest";
import { buildGroqSchema } from "./groq";
import type { FieldDef } from "../types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
  { name: "tags", type: "string_array", required: false, order: 2 },
];

describe("buildGroqSchema", () => {
  test("builds strict JSON schema; non-required is a null-union but still required", () => {
    expect(buildGroqSchema(fields)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        tags: { type: ["array", "null"], items: { type: "string" } },
      },
      required: ["name", "age", "tags"],
      additionalProperties: false,
    });
  });
});
