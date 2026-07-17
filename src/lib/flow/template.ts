import type { Step } from "./types";

// One matcher instance per call — a shared global-flag regex would carry `lastIndex` between calls.
const tokenRe = () => /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s*\}\}/g;

export interface TemplateRef {
  raw: string; // e.g. "input" or "extract1.author"
  step: string | null; // null for {{input}}
  field: string | null; // null for {{input}}
}

export type ResolveContext = {
  input: string;
  [key: string]: Record<string, unknown> | string;
};

export function parseRefs(template: string): TemplateRef[] {
  const refs: TemplateRef[] = [];
  for (const match of template.matchAll(tokenRe())) {
    const raw = match[1];
    if (raw === "input") {
      refs.push({ raw, step: null, field: null });
      continue;
    }
    const dot = raw.indexOf(".");
    if (dot === -1) {
      refs.push({ raw, step: raw, field: null }); // bare non-input token — invalid ref
    } else {
      refs.push({ raw, step: raw.slice(0, dot), field: raw.slice(dot + 1) });
    }
  }
  return refs;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function resolveTemplate(template: string, ctx: ResolveContext): string {
  return template.replace(tokenRe(), (_full, raw: string) => {
    if (raw === "input") return ctx.input;
    const dot = raw.indexOf(".");
    if (dot === -1) throw new Error(`Unresolved template variable: {{${raw}}}`);
    const step = raw.slice(0, dot);
    const field = raw.slice(dot + 1);
    const bag = ctx[step];
    if (
      typeof bag !== "object" ||
      bag === null ||
      !(field in bag)
    ) {
      throw new Error(`Unresolved template variable: {{${raw}}}`);
    }
    return stringify((bag as Record<string, unknown>)[field]);
  });
}

export function stepOutputFields(step: Step): string[] {
  if (step.type === "generate") return ["text"];
  return (step.fields ?? []).map((field) => field.name);
}

export function availableRefs(priorSteps: Step[]): string[] {
  const refs = ["input"];
  for (const step of priorSteps) {
    for (const field of stepOutputFields(step)) refs.push(`${step.key}.${field}`);
  }
  return refs;
}
