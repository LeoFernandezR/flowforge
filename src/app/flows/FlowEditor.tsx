"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createFlow, deleteFlow, updateFlow } from "./actions";
import type { FieldDef, FieldType, Step, StepType } from "@/lib/flow/types";
import { stepOutputFields } from "@/lib/flow/template";
import { PROVIDER_NAMES, type ProviderName } from "@/lib/validations/flow";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "string_array"];

type EditorStep = {
  key: string;
  type: StepType;
  name: string;
  prompt: string;
  provider: ProviderName | ""; // "" = inherit flow default
  fields: FieldDef[]; // used by extract; empty for generate
};

type EditorFlow = { id: string; name: string; provider: ProviderName; steps: EditorStep[] };

type StepTraceView = {
  key: string;
  type: string;
  status: string;
  output: unknown;
  error: string | null;
  ms: number;
};
type RunResult = {
  status: string;
  output: { final: unknown; steps: StepTraceView[] } | null;
  errorMessage: string | null;
};

function nextKey(type: StepType, steps: EditorStep[]): string {
  const used = new Set(steps.map((s) => s.key));
  let n = 1;
  while (used.has(`${type}${n}`)) n++;
  return `${type}${n}`;
}

function emptyExtractStep(steps: EditorStep[]): EditorStep {
  return {
    key: nextKey("extract", steps),
    type: "extract",
    name: "",
    prompt: "",
    provider: "",
    fields: [{ name: "", type: "string", required: true, order: 0 }],
  };
}

function emptyGenerateStep(steps: EditorStep[]): EditorStep {
  return { key: nextKey("generate", steps), type: "generate", name: "", prompt: "", provider: "", fields: [] };
}

function refsBefore(steps: EditorStep[], index: number): string[] {
  const refs = ["input"];
  for (let i = 0; i < index; i++) {
    for (const field of stepOutputFields(steps[i] as unknown as Step)) {
      refs.push(`${steps[i].key}.${field}`);
    }
  }
  return refs;
}

export default function FlowEditor({ mode, flow }: { mode: "new" | "edit"; flow?: EditorFlow }) {
  const router = useRouter();
  const [name, setName] = useState(flow?.name ?? "");
  const [provider, setProvider] = useState<ProviderName>(flow?.provider ?? "gemini");
  const [steps, setSteps] = useState<EditorStep[]>(flow?.steps ?? [emptyExtractStep([])]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const promptRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  function updateStep(index: number, patch: Partial<EditorStep>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function addStep(type: StepType) {
    setSteps((prev) => [...prev, type === "extract" ? emptyExtractStep(prev) : emptyGenerateStep(prev)]);
  }
  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }
  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function updateField(stepIndex: number, fieldIndex: number, patch: Partial<FieldDef>) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, fields: s.fields.map((f, k) => (k === fieldIndex ? { ...f, ...patch } : f)) }
          : s,
      ),
    );
  }
  function addField(stepIndex: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, fields: [...s.fields, { name: "", type: "string", required: true, order: s.fields.length }] }
          : s,
      ),
    );
  }
  function removeField(stepIndex: number, fieldIndex: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, fields: s.fields.filter((_, k) => k !== fieldIndex).map((f, k) => ({ ...f, order: k })) }
          : s,
      ),
    );
  }

  function insertToken(index: number, ref: string) {
    const token = `{{${ref}}}`;
    const step = steps[index];
    const el = promptRefs.current[step.key];
    if (!el) {
      updateStep(index, { prompt: step.prompt + token });
      return;
    }
    const start = el.selectionStart ?? step.prompt.length;
    const end = el.selectionEnd ?? step.prompt.length;
    updateStep(index, { prompt: step.prompt.slice(0, start) + token + step.prompt.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function toPayloadStep(s: EditorStep): Step {
    const step: Step = { key: s.key, type: s.type, prompt: s.prompt };
    if (s.name.trim()) step.name = s.name.trim();
    if (s.provider) step.provider = s.provider;
    if (s.type === "extract") step.fields = s.fields.map((f, i) => ({ ...f, order: i }));
    return step;
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = { name, provider, steps: steps.map(toPayloadStep) };
    try {
      if (mode === "new") {
        await createFlow(payload);
      } else if (flow) {
        await updateFlow(flow.id, payload);
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    if (!flow) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/flows/${flow.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ status: "error", output: null, errorMessage: JSON.stringify(data) });
      } else {
        setResult({ status: data.status, output: data.output, errorMessage: data.errorMessage });
        router.refresh();
      }
    } catch (err) {
      setResult({ status: "error", output: null, errorMessage: (err as Error).message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Default provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderName)}
            className="mt-1 block w-full rounded border px-3 py-2"
          >
            {PROVIDER_NAMES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-4">
        <span className="text-sm font-medium">Steps</span>
        {steps.map((step, i) => (
          <div key={step.key} className="rounded border p-3 space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-gray-200 px-2 py-0.5 font-mono text-xs dark:bg-gray-800">
                {step.key}
              </span>
              <span className="text-xs text-gray-500">{step.type}</span>
              <input
                placeholder="label (optional)"
                value={step.name}
                onChange={(e) => updateStep(i, { name: e.target.value })}
                className="flex-1 rounded border px-2 py-1 text-sm"
              />
              <select
                value={step.provider}
                onChange={(e) => updateStep(i, { provider: e.target.value as ProviderName | "" })}
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="">↳ flow default</option>
                {PROVIDER_NAMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => moveStep(i, -1)}
                disabled={i === 0}
                className="px-1 text-sm disabled:opacity-30"
                aria-label="Move step up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveStep(i, 1)}
                disabled={i === steps.length - 1}
                className="px-1 text-sm disabled:opacity-30"
                aria-label="Move step down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeStep(i)}
                className="text-sm text-red-600"
                aria-label="Remove step"
              >
                ✕
              </button>
            </div>

            <label className="block">
              <span className="text-xs text-gray-500">Prompt template</span>
              <textarea
                ref={(el) => {
                  promptRefs.current[step.key] = el;
                }}
                value={step.prompt}
                onChange={(e) => updateStep(i, { prompt: e.target.value })}
                rows={3}
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
              />
            </label>

            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-gray-500">insert:</span>
              {refsBefore(steps, i).map((ref) => (
                <button
                  key={ref}
                  type="button"
                  onClick={() => insertToken(i, ref)}
                  className="rounded border px-1.5 py-0.5 font-mono hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  {`{{${ref}}}`}
                </button>
              ))}
            </div>

            {step.type === "extract" ? (
              <div>
                <span className="text-xs text-gray-500">Output fields</span>
                <div className="mt-1 space-y-2">
                  {step.fields.map((field, k) => (
                    <div key={k} className="flex items-center gap-2">
                      <input
                        placeholder="field_name"
                        value={field.name}
                        onChange={(e) => updateField(i, k, { name: e.target.value })}
                        className="flex-1 rounded border px-2 py-1 text-sm"
                      />
                      <select
                        value={field.type}
                        onChange={(e) => updateField(i, k, { type: e.target.value as FieldType })}
                        className="rounded border px-2 py-1 text-sm"
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(i, k, { required: e.target.checked })}
                        />
                        required
                      </label>
                      <button
                        type="button"
                        onClick={() => removeField(i, k)}
                        className="text-sm text-red-600"
                      >
                        remove
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => addField(i)} className="mt-2 text-sm underline">
                  + add field
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Outputs <span className="font-mono">{`{{${step.key}.text}}`}</span>
              </p>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <button type="button" onClick={() => addStep("extract")} className="text-sm underline">
            + add extract step
          </button>
          <button type="button" onClick={() => addStep("generate")} className="text-sm underline">
            + add generate step
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {saving ? "Saving…" : "Save flow"}
        </button>
        {mode === "edit" && flow && (
          <button
            type="button"
            onClick={() => deleteFlow(flow.id)}
            className="rounded border px-4 py-2 text-sm font-medium text-red-600"
          >
            Delete
          </button>
        )}
      </div>

      {mode === "edit" && flow && (
        <div className="space-y-2 border-t pt-4">
          <h2 className="font-semibold">Test</h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            placeholder="Paste input text…"
            className="w-full rounded border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={run}
            disabled={running || input.trim() === ""}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {running ? "Running…" : "Run"}
          </button>

          {result && (
            <div className="space-y-2">
              <p className="text-sm">
                Status: <span className="font-medium">{result.status}</span>
              </p>
              {result.output?.steps.map((s) => (
                <div key={s.key} className="rounded border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{s.key}</span>
                    <span className="text-gray-500">{s.type}</span>
                    <span>{s.status}</span>
                    <span className="text-gray-500">{s.ms}ms</span>
                  </div>
                  <pre className="overflow-x-auto">
                    {s.status === "success" ? JSON.stringify(s.output, null, 2) : s.error}
                  </pre>
                </div>
              ))}
              {result.errorMessage && <p className="text-xs text-red-600">{result.errorMessage}</p>}
              {result.output && (
                <div>
                  <span className="text-xs text-gray-500">Final output</span>
                  <pre className="overflow-x-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-900">
                    {JSON.stringify(result.output.final, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
