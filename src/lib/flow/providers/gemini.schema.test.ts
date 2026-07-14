import { describe, expect, test } from "vitest";
import { Type } from "@google/genai";
import { buildGeminiSchema } from "./gemini";
import type { FieldDef } from "../types";

const fields: FieldDef[] = [
  { name: "name", type: "string", required: true, order: 0 },
  { name: "age", type: "number", required: true, order: 1 },
  { name: "tags", type: "string_array", required: false, order: 2 },
];

describe("buildGeminiSchema", () => {
  test("maps types and required list for Gemini responseSchema", () => {
    expect(buildGeminiSchema(fields)).toEqual({
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        age: { type: Type.NUMBER },
        tags: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
      },
      required: ["name", "age", "tags"],
    });
  });
});
