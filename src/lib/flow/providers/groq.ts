import Groq from "groq-sdk";
import type { FieldDef } from "../types";
import type { GenerateStructuredArgs, LlmProvider } from "./types";

const DEFAULT_MODEL = "openai/gpt-oss-20b";

function baseGroqType(type: FieldDef["type"], nullable: boolean): Record<string, unknown> {
  const scalar = (t: string) => (nullable ? [t, "null"] : t);
  switch (type) {
    case "string":
      return { type: scalar("string") };
    case "number":
      return { type: scalar("number") };
    case "boolean":
      return { type: scalar("boolean") };
    case "string_array":
      return { type: scalar("array"), items: { type: "string" } };
  }
}

export function buildGroqSchema(fields: FieldDef[]): object {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of fields) {
    properties[field.name] = baseGroqType(field.type, !field.required);
    // Strict mode requires every key present; "optional" is expressed as null-union.
    required.push(field.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function createGroqProvider(): LlmProvider {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set");
  }
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const groq = new Groq({ apiKey });

  return {
    name: "groq",
    model,
    async generateStructured({ prompt, input, fields }: GenerateStructuredArgs): Promise<unknown> {
      const schema = buildGroqSchema(fields);
      const response = await groq.chat.completions.create({
        model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: input },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "extraction", schema: schema as Record<string, unknown>, strict: true },
        },
      });
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Groq returned an empty response");
      }
      return JSON.parse(content);
    },
  };
}
