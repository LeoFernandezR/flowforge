"use client";

import { useState } from "react";
import { parseCsv } from "@/lib/flow/csv";

const MAX_ROWS = 50;

const EYEBROW =
  "font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-soft";

type RowResult = {
  input: string;
  status: "success" | "error";
  output: unknown;
  error: string | null;
};

export default function CsvRunPanel({ flowId, onComplete }: { flowId: string; onComplete: () => void }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [column, setColumn] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<RowResult[]>([]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setResults([]);
    setDone(0);
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    if (rows.length === 0) {
      setHeaders([]);
      setRows([]);
      setColumn("");
      setParseError("No rows found in the CSV.");
      return;
    }
    if (rows.length > MAX_ROWS) {
      setHeaders([]);
      setRows([]);
      setColumn("");
      setParseError(`CSV has ${rows.length} rows; the limit is ${MAX_ROWS}.`);
      return;
    }
    setHeaders(headers);
    setRows(rows);
    setColumn(headers[0] ?? "");
  }

  async function runBatch() {
    if (!column || rows.length === 0) return;
    setRunning(true);
    setResults([]);
    setDone(0);
    const batchId = crypto.randomUUID();
    const collected: RowResult[] = [];

    for (const row of rows) {
      const cell = (row[column] ?? "").trim();
      if (cell === "") {
        collected.push({ input: "", status: "error", output: null, error: "empty input" });
        setResults([...collected]);
        setDone(collected.length);
        continue;
      }
      try {
        const res = await fetch(`/api/flows/${flowId}/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: cell, batchId }),
        });
        const data = await res.json();
        if (!res.ok) {
          collected.push({ input: cell, status: "error", output: null, error: JSON.stringify(data) });
        } else {
          collected.push({
            input: cell,
            status: data.status,
            output: data.output?.final ?? null,
            error: data.errorMessage ?? null,
          });
        }
      } catch (err) {
        collected.push({ input: cell, status: "error", output: null, error: (err as Error).message });
      }
      setResults([...collected]);
      setDone(collected.length);
    }

    setRunning(false);
    onComplete();
  }

  const total = rows.length;
  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.length - succeeded;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={EYEBROW}>CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          disabled={running}
          className="mt-1 block w-full text-xs text-ink file:mr-2 file:rounded-sm file:border file:border-hairline file:bg-sheet file:px-2 file:py-1 file:font-display file:text-[10px] file:uppercase file:tracking-[0.15em] file:text-blueprint disabled:opacity-50"
        />
      </label>
      {parseError && <p className="font-mono text-xs text-redline">{parseError}</p>}

      {headers.length > 0 && (
        <label className="block">
          <span className={EYEBROW}>Input column</span>
          <select
            value={column}
            onChange={(e) => setColumn(e.target.value)}
            className="mt-1 block w-full rounded-sm border border-hairline bg-sheet px-2 py-1 text-sm text-ink outline-none"
          >
            {headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
      )}

      {rows.length > 0 && (
        <button
          type="button"
          onClick={runBatch}
          disabled={running || !column}
          className="w-full rounded-sm bg-azure px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50"
        >
          {running ? `Running… ${done}/${total}` : `▶ Run ${total} rows`}
        </button>
      )}

      {(running || results.length > 0) && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-sm border border-hairline bg-paper/40">
            <div className="h-full bg-azure transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="font-mono text-xs text-ink-soft">
            {done}/{total} · <span className="text-azure">✓ {succeeded}</span> ·{" "}
            <span className="text-redline">✗ {failed}</span>
          </p>

          {results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={`py-1 pr-3 ${EYEBROW}`}>Input</th>
                    <th className={`py-1 pr-3 ${EYEBROW}`}>Status</th>
                    <th className={`py-1 pr-3 ${EYEBROW}`}>Output / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-hairline align-top">
                      <td className="max-w-[12rem] truncate py-1 pr-3 font-mono text-ink">
                        {r.input}
                      </td>
                      <td className="py-1 pr-3">
                        <span className="flex items-center gap-1.5 font-mono text-ink-soft">
                          <span
                            className={`h-2 w-2 rounded-full ${r.status === "success" ? "bg-azure" : "bg-redline"}`}
                            aria-hidden
                          />
                          {r.status}
                        </span>
                      </td>
                      <td className="py-1 pr-3">
                        <pre className="max-w-md overflow-x-auto font-mono text-[11px] text-ink">
                          {r.status === "success" ? JSON.stringify(r.output) : r.error}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
