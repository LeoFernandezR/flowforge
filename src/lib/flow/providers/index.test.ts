import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getProvider } from "./index";

describe("getProvider", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns a gemini provider with name and model", () => {
    const provider = getProvider("gemini");
    expect(provider.name).toBe("gemini");
    expect(provider.model).toBe("gemini-flash-latest");
  });

  test("returns a groq provider with name and model", () => {
    const provider = getProvider("groq");
    expect(provider.name).toBe("groq");
    expect(provider.model).toBe("openai/gpt-oss-20b");
  });

  test("throws on an unknown provider", () => {
    expect(() => getProvider("openai")).toThrow(/Unknown provider/);
  });

  test("gemini provider throws a clear error when the API key is missing", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => getProvider("gemini")).toThrow(/GEMINI_API_KEY/);
  });

  test("groq provider throws a clear error when the API key is missing", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(() => getProvider("groq")).toThrow(/GROQ_API_KEY/);
  });
});
