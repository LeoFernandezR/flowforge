import { describe, expect, test } from "vitest";
import { parseRefs, resolveTemplate, stepOutputFields, availableRefs } from "./template";
import type { Step } from "./types";

const extractStepDef: Step = {
  key: "extract1",
  type: "extract",
  prompt: "",
  fields: [
    { name: "author", type: "string", required: true, order: 0 },
    { name: "count", type: "number", required: true, order: 1 },
  ],
};
const generateStepDef: Step = { key: "gen1", type: "generate", prompt: "" };

describe("parseRefs", () => {
  test("finds the input token and field tokens", () => {
    const refs = parseRefs("Given {{input}} and {{extract1.author}}");
    expect(refs).toEqual([
      { raw: "input", step: null, field: null },
      { raw: "extract1.author", step: "extract1", field: "author" },
    ]);
  });

  test("treats a bare non-input token as an invalid field ref", () => {
    expect(parseRefs("{{oops}}")).toEqual([{ raw: "oops", step: "oops", field: null }]);
  });
});

describe("resolveTemplate", () => {
  test("interpolates the flow input", () => {
    expect(resolveTemplate("Hi {{input}}", { input: "Ada" })).toBe("Hi Ada");
  });

  test("interpolates a prior step's field and stringifies non-strings", () => {
    const ctx = { input: "x", extract1: { author: "Ana", count: 3, tags: ["a", "b"] } };
    expect(resolveTemplate("{{extract1.author}} / {{extract1.count}} / {{extract1.tags}}", ctx)).toBe(
      'Ana / 3 / ["a","b"]',
    );
  });

  test("throws on an unknown step", () => {
    expect(() => resolveTemplate("{{nope.x}}", { input: "" })).toThrow(
      "Unresolved template variable: {{nope.x}}",
    );
  });

  test("throws on a missing field", () => {
    expect(() => resolveTemplate("{{extract1.missing}}", { input: "", extract1: { author: "A" } })).toThrow(
      "Unresolved template variable: {{extract1.missing}}",
    );
  });

  test("throws on a bare non-input token", () => {
    expect(() => resolveTemplate("{{oops}}", { input: "" })).toThrow(
      "Unresolved template variable: {{oops}}",
    );
  });
});

describe("stepOutputFields", () => {
  test("returns field names for extract steps", () => {
    expect(stepOutputFields(extractStepDef)).toEqual(["author", "count"]);
  });

  test("returns ['text'] for generate steps", () => {
    expect(stepOutputFields(generateStepDef)).toEqual(["text"]);
  });
});

describe("availableRefs", () => {
  test("lists input plus every prior step's outputs", () => {
    expect(availableRefs([extractStepDef, generateStepDef])).toEqual([
      "input",
      "extract1.author",
      "extract1.count",
      "gen1.text",
    ]);
  });
});
