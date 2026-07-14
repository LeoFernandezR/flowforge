import { GoogleGenAI, Type } from "@google/genai";
import type { FieldDef } from "../types";
import type { GenerateStructuredArgs, LlmProvider } from "./types";

const DEFAULT_MODEL = "gemini-flash-latest";

function baseGeminiType(type: FieldDef["type"]): Record<string, unknown> {
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

export function buildGeminiSchema(fields: FieldDef[]): object {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    const prop = baseGeminiType(field.type);
    if (field.required) {
      required.push(field.name);
    } else {
      prop.nullable = true;
    }
    properties[field.name] = prop;
  }
  return { type: Type.OBJECT, properties, required };
}

export function createGeminiProvider(): LlmProvider {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  return {
    name: "gemini",
    model,
    async generateStructured({ prompt, input, fields }: GenerateStructuredArgs): Promise<unknown> {
      const responseSchema = buildGeminiSchema(fields);
      const response = await ai.models.generateContent({
        model,
        contents: `${prompt}\n\nInput:\n${input}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema as never,
        },
      });
      const text = response.text;
      if (!text) {
        throw new Error("Gemini returned an empty response");
      }
      return JSON.parse(text);
    },
  };
}
