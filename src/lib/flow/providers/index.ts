import type { LlmProvider } from "./types";
import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";

export function getProvider(name: string): LlmProvider {
  switch (name) {
    case "gemini":
      return createGeminiProvider();
    case "groq":
      return createGroqProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
