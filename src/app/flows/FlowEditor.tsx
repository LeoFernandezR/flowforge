"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createFlow, deleteFlow, updateFlow } from "./actions";
import type { FieldDef, FieldType, Step, StepType } from "@/lib/flow/types";
import { availableRefs } from "@/lib/flow/template";
import { PROVIDER_NAMES, type ProviderName } from "@/lib/validations/flow";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "string_array"];

let fieldKeySeq = 0;

type EditorField = FieldDef & { _key: number }; // _key is client-only, never saved

type EditorStep = {
  key: string;
  type: StepType;
  name: string;
  prompt: string;
  provider: ProviderName | ""; // "" = inherit flow default
  fields: EditorField[]; // used by extract; empty for generate
};

// Shape of a step as it arrives via props (server data, no client-only `_key` yet).
type IncomingStep = Omit<EditorStep, "fields"> & { fields: FieldDef[] };

type EditorFlow = { id: string; name: string; provider: ProviderName; steps: IncomingStep[] };

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
    fields: [{ name: "", type: "string", required: true, order: 0, _key: fieldKeySeq++ }],
  };
}

function emptyGenerateStep(steps: EditorStep[]): EditorStep {
  return { key: nextKey("generate", steps), type: "generate", name: "", prompt: "", provider: "", fields: [] };
}

function refsBefore(steps: EditorStep[], index: number): string[] {
  return availableRefs(steps.slice(0, index) as unknown as Step[]);
}

// Refs this step contributes onto the wire (its own outputs), for the rail annotation.
function refsAfter(step: EditorStep): string[] {
  if (step.type === "generate") return [`${step.key}.text`];
  return step.fields.filter((f) => f.name.trim()).map((f) => `${step.key}.${f.name}`);
}

function withFieldKeys(steps: IncomingStep[]): EditorStep[] {
  return steps.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f, _key: fieldKeySeq++ })) }));
}

// Rail cell: the connector "wire" running down the drawing, with a node marker per row.
// "terminal" = the square input/output caps; "node" = a step's round marker.
function RailCell({ kind }: { kind: "node" | "terminal" }) {
  return (
    <div className="relative flex w-6 justify-center">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-blueprint/40" aria-hidden />
      {kind === "terminal" ? (
        <span className="relative mt-1.5 h-2.5 w-2.5 border border-blueprint bg-paper" aria-hidden />
      ) : (
        <span className="relative mt-4 h-2.5 w-2.5 rounded-full border border-blueprint bg-paper" aria-hidden />
      )}
    </div>
  );
}

const EYEBROW = "font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft";
const INPUT_CLS =
  "rounded-sm border border-hairline bg-sheet px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-soft";

export default function FlowEditor({ mode, flow }: { mode: "new" | "edit"; flow?: EditorFlow }) {
  const router = useRouter();
  const [name, setName] = useState(flow?.name ?? "");
  const [provider, setProvider] = useState<ProviderName>(flow?.provider ?? "gemini");
  const [steps, setSteps] = useState<EditorStep[]>(flow ? withFieldKeys(flow.steps) : [emptyExtractStep([])]);
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
          ? {
              ...s,
              fields: [
                ...s.fields,
                { name: "", type: "string", required: true, order: s.fields.length, _key: fieldKeySeq++ },
              ],
            }
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
    if (s.type === "extract") {
      step.fields = s.fields.map((f, i) => ({ name: f.name, type: f.type, required: f.required, order: i }));
    }
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

  const twoPane = mode === "edit" && !!flow;
  const lastStep = steps[steps.length - 1];

  return (
    <div className="space-y-6">
      {/* ── Title block: the drawing's metadata stamp ── */}
      <section className="border border-blueprint bg-sheet">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-1.5">
          <span className="font-display text-xs font-bold uppercase tracking-[0.2em] text-blueprint">
            FlowForge · Sheet
          </span>
          <span className="font-mono text-[11px] text-ink-soft">rev —</span>
        </div>
        <div className="grid grid-cols-1 divide-y divide-hairline sm:grid-cols-[2fr_1fr_auto_auto] sm:divide-x sm:divide-y-0">
          <label className="block px-3 py-2">
            <span className={EYEBROW}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled flow"
              className="mt-0.5 w-full min-w-0 bg-transparent font-display text-lg font-bold text-ink outline-none placeholder:text-ink-soft"
            />
          </label>
          <label className="block px-3 py-2">
            <span className={EYEBROW}>Default provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderName)}
              className="mt-0.5 block w-full bg-transparent font-mono text-sm text-ink outline-none"
            >
              {PROVIDER_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="px-3 py-2">
            <span className={EYEBROW}>Steps</span>
            <div className="mt-0.5 font-mono text-lg text-ink">{steps.length}</div>
          </div>
          <div className="px-3 py-2">
            <span className={EYEBROW}>Status</span>
            <div className="mt-0.5 font-mono text-sm text-ink">{result?.status ?? "draft"}</div>
          </div>
        </div>
      </section>

      <div className={`grid gap-6 ${twoPane ? "lg:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        {/* ── The drawing ── */}
        <div className="min-w-0">
          {/* input node */}
          <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <RailCell kind="terminal" />
            <div className="py-1">
              <span className="font-mono text-xs font-medium text-blueprint">input</span>
              <span className="ml-2 font-mono text-[11px] text-ink-soft">{`{{input}}`} · the run&apos;s input text</span>
            </div>
          </div>

          {/* step cards */}
          {steps.map((step, i) => (
            <div key={step.key} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
              <RailCell kind="node" />
              <div className="mb-3 border border-hairline bg-sheet">
                {/* title strip */}
                <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-paper/60 px-3 py-1.5">
                  <span className="rounded-sm border border-blueprint bg-sheet px-1.5 py-0.5 font-mono text-xs font-medium text-blueprint">
                    {step.key}
                  </span>
                  <span className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                    {step.type}
                  </span>
                  <input
                    placeholder="label (optional)"
                    value={step.name}
                    onChange={(e) => updateStep(i, { name: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none placeholder:text-ink-soft"
                  />
                  <select
                    value={step.provider}
                    onChange={(e) => updateStep(i, { provider: e.target.value as ProviderName | "" })}
                    className="rounded-sm border border-hairline bg-sheet px-1.5 py-0.5 font-mono text-xs text-ink"
                  >
                    <option value="">↳ flow default</option>
                    {PROVIDER_NAMES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                      className="px-1 text-ink-soft hover:text-ink disabled:opacity-30"
                      aria-label="Move step up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(i, 1)}
                      disabled={i === steps.length - 1}
                      className="px-1 text-ink-soft hover:text-ink disabled:opacity-30"
                      aria-label="Move step down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      className="px-1 text-redline hover:opacity-70"
                      aria-label="Remove step"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* body */}
                <div className="space-y-3 p-3">
                  <label className="block">
                    <span className={EYEBROW}>Prompt template</span>
                    <textarea
                      ref={(el) => {
                        promptRefs.current[step.key] = el;
                      }}
                      value={step.prompt}
                      onChange={(e) => updateStep(i, { prompt: e.target.value })}
                      rows={3}
                      className="mt-1 w-full rounded-sm border border-hairline bg-paper/40 px-3 py-2 font-mono text-sm text-ink outline-none"
                    />
                  </label>

                  {/* ports: insert available refs */}
                  <div className="flex flex-wrap items-center gap-1">
                    <span className={`${EYEBROW} mr-1`}>Ports</span>
                    {refsBefore(steps, i).map((ref) => (
                      <button
                        key={ref}
                        type="button"
                        onClick={() => insertToken(i, ref)}
                        className="rounded-sm border border-blueprint/50 bg-sheet px-1.5 py-0.5 font-mono text-[11px] text-blueprint hover:border-azure hover:text-azure"
                      >
                        {`{{${ref}}}`}
                      </button>
                    ))}
                  </div>

                  {step.type === "extract" ? (
                    <div>
                      <span className={EYEBROW}>Output fields</span>
                      <div className="mt-1 space-y-2">
                        {step.fields.map((field, k) => (
                          <div key={field._key} className="flex flex-wrap items-center gap-2">
                            <input
                              placeholder="field_name"
                              value={field.name}
                              onChange={(e) => updateField(i, k, { name: e.target.value })}
                              className={`min-w-0 flex-1 ${INPUT_CLS}`}
                            />
                            <select
                              value={field.type}
                              onChange={(e) => updateField(i, k, { type: e.target.value as FieldType })}
                              className="rounded-sm border border-hairline bg-sheet px-2 py-1 font-mono text-xs text-ink"
                            >
                              {FIELD_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-1 text-xs text-ink-soft">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateField(i, k, { required: e.target.checked })}
                                className="accent-azure"
                              />
                              required
                            </label>
                            <button
                              type="button"
                              onClick={() => removeField(i, k)}
                              className="text-xs text-redline hover:opacity-70"
                            >
                              remove
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => addField(i)}
                        className="mt-2 font-mono text-xs text-blueprint hover:text-azure hover:underline"
                      >
                        + add field
                      </button>
                    </div>
                  ) : (
                    <p className="font-mono text-[11px] text-ink-soft">
                      outputs <span className="text-blueprint">{`{{${step.key}.text}}`}</span>
                    </p>
                  )}

                  {/* rail annotation: what this component puts on the wire */}
                  {refsAfter(step).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 border-t border-dashed border-hairline pt-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">on wire →</span>
                      {refsAfter(step).map((r) => (
                        <span key={r} className="font-mono text-[11px] text-blueprint">
                          {`{{${r}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* add-step controls */}
          <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <RailCell kind="node" />
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => addStep("extract")}
                className="rounded-sm border border-dashed border-blueprint/50 px-3 py-1.5 font-mono text-xs text-blueprint hover:border-azure hover:text-azure"
              >
                + extract step
              </button>
              <button
                type="button"
                onClick={() => addStep("generate")}
                className="rounded-sm border border-dashed border-blueprint/50 px-3 py-1.5 font-mono text-xs text-blueprint hover:border-azure hover:text-azure"
              >
                + generate step
              </button>
            </div>
          </div>

          {/* output node */}
          <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
            <RailCell kind="terminal" />
            <div className="py-1">
              <span className="font-mono text-xs font-medium text-blueprint">output</span>
              {lastStep && (
                <span className="ml-2 font-mono text-[11px] text-ink-soft">final ← {lastStep.key}</span>
              )}
            </div>
          </div>

          {error && <p className="mt-3 font-mono text-sm text-redline">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-sm bg-azure px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save flow"}
            </button>
            {mode === "edit" && flow && (
              <button
                type="button"
                onClick={() => deleteFlow(flow.id)}
                className="rounded-sm border border-redline px-4 py-2 text-sm font-semibold text-redline hover:bg-redline/10"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* ── Test rig ── */}
        {twoPane && flow && (
          <aside className="h-fit border border-blueprint bg-sheet lg:sticky lg:top-6">
            <div className="border-b border-hairline px-3 py-1.5">
              <span className="font-display text-xs font-bold uppercase tracking-[0.2em] text-blueprint">
                Test rig
              </span>
            </div>
            <div className="space-y-3 p-3">
              <label className="block">
                <span className={EYEBROW}>Input</span>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={4}
                  placeholder="Paste input text…"
                  className="mt-1 w-full rounded-sm border border-hairline bg-paper/40 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-soft"
                />
              </label>
              <button
                type="button"
                onClick={run}
                disabled={running || input.trim() === ""}
                className="w-full rounded-sm bg-azure px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                {running ? "Running…" : "▶ Run"}
              </button>

              {result && (
                <div className="space-y-3">
                  <div>
                    <span className={EYEBROW}>Trace</span>
                    <div className="mt-1 space-y-1">
                      {result.output?.steps.map((s, idx) => (
                        <div
                          key={s.key}
                          className="plot-in rounded-sm border border-hairline bg-paper/40 p-2"
                          style={{ animationDelay: `${idx * 80}ms` }}
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={`h-2 w-2 rounded-full ${s.status === "success" ? "bg-azure" : "bg-redline"}`}
                              aria-hidden
                            />
                            <span className="font-mono text-blueprint">{s.key}</span>
                            <span className="text-ink-soft">{s.type}</span>
                            <span className="ml-auto font-mono text-ink-soft">{s.ms}ms</span>
                          </div>
                          <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-ink">
                            {s.status === "success" ? JSON.stringify(s.output, null, 2) : s.error}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                  {result.errorMessage && <p className="font-mono text-xs text-redline">{result.errorMessage}</p>}
                  {result.output && (
                    <div>
                      <span className={EYEBROW}>Final</span>
                      <pre className="mt-1 overflow-x-auto rounded-sm border border-hairline bg-paper/40 p-3 font-mono text-[11px] text-ink">
                        {JSON.stringify(result.output.final, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
