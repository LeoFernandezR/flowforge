import type { LlmProvider } from "./types";
import { createGeminiProvider } from "./gemini";

export function getProvider(name: string): LlmProvider {
  switch (name) {
    case "gemini":
      return createGeminiProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
