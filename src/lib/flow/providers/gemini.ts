import { GoogleGenAI } from "@google/genai";
import type { GenerateStructuredArgs, LlmProvider } from "./types";

const DEFAULT_MODEL = "gemini-flash-latest";

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
    async generateStructured({ prompt, input, jsonSchema }: GenerateStructuredArgs): Promise<unknown> {
      const response = await ai.models.generateContent({
        model,
        contents: `${prompt}\n\nInput:\n${input}`,
        config: {
          responseMimeType: "application/json",
          // Google GenAI Schema type is structurally compatible with our builder output.
          responseSchema: jsonSchema as never,
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
