"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFlow, deleteFlow, updateFlow } from "./actions";
import type { FieldDef, FieldType } from "@/lib/flow/types";

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "string_array"];

type EditorFlow = { id: string; name: string; prompt: string; fields: FieldDef[] };

export default function FlowEditor({ mode, flow }: { mode: "new" | "edit"; flow?: EditorFlow }) {
  const router = useRouter();
  const [name, setName] = useState(flow?.name ?? "");
  const [prompt, setPrompt] = useState(flow?.prompt ?? "");
  const [fields, setFields] = useState<FieldDef[]>(
    flow?.fields ?? [{ name: "", type: "string", required: true, order: 0 }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function updateField(index: number, patch: Partial<FieldDef>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((prev) => [...prev, { name: "", type: "string", required: true, order: prev.length }]);
  }
  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i })));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = { name, prompt, fields: fields.map((f, i) => ({ ...f, order: i })) };
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
        setResult(`Error: ${JSON.stringify(data, null, 2)}`);
      } else {
        setResult(JSON.stringify(data, null, 2));
        router.refresh();
      }
    } catch (err) {
      setResult(`Request failed: ${(err as Error).message}`);
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
          <span className="text-sm font-medium">Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
          />
        </label>

        <div>
          <span className="text-sm font-medium">Output fields</span>
          <div className="mt-2 space-y-2">
            {fields.map((field, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  placeholder="field_name"
                  value={field.name}
                  onChange={(e) => updateField(i, { name: e.target.value })}
                  className="flex-1 rounded border px-2 py-1 text-sm"
                />
                <select
                  value={field.type}
                  onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
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
                    onChange={(e) => updateField(i, { required: e.target.checked })}
                  />
                  required
                </label>
                <button type="button" onClick={() => removeField(i)} className="text-sm text-red-600">
                  remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addField} className="mt-2 text-sm underline">
            + add field
          </button>
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
      </div>

      {mode === "edit" && flow && (
        <div className="space-y-2 border-t pt-4">
          <h2 className="font-semibold">Test</h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            placeholder="Paste text to extract from…"
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
          {result && <pre className="overflow-x-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-900">{result}</pre>}
        </div>
      )}
    </div>
  );
}
