import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getProvider } from "./index";

describe("getProvider", () => {
  const original = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env.GEMINI_API_KEY = original;
  });

  test("returns a gemini provider with name and model", () => {
    const provider = getProvider("gemini");
    expect(provider.name).toBe("gemini");
    expect(provider.model).toBe("gemini-flash-latest");
  });

  test("throws on an unknown provider", () => {
    expect(() => getProvider("groq")).toThrow(/Unknown provider/);
  });

  test("gemini provider throws a clear error when the API key is missing", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => getProvider("gemini")).toThrow(/GEMINI_API_KEY/);
  });
});
