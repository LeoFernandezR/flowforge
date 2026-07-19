import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FlowEditor from "../FlowEditor";
import type { Step } from "@/lib/flow/types";
import type { ProviderName } from "@/lib/validations/flow";
import { groupRuns } from "@/lib/flow/runGroups";

export const dynamic = "force-dynamic";

type RunTrace = { final: unknown; steps: Array<{ key: string; status: string; ms: number }> };

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await prisma.flow.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 100 } },
  });

  if (!flow) {
    notFound();
  }

  const steps = ((flow.steps ?? []) as unknown as Step[]).map((s) => ({
    key: s.key,
    type: s.type,
    name: s.name ?? "",
    prompt: s.prompt,
    provider: (s.provider ?? "") as ProviderName | "",
    fields: s.fields ?? [],
  }));

  const runGroups = groupRuns(flow.runs);

  return (
    <main className="mx-auto w-full max-w-5xl p-6 sm:p-8">
      <Link href="/" className="font-mono text-xs text-blueprint hover:text-azure hover:underline">
        ← all flows
      </Link>

      <div className="mt-4">
        <FlowEditor
          mode="edit"
          flow={{ id: flow.id, name: flow.name, provider: flow.provider as ProviderName, steps }}
        />
      </div>

      <section className="mt-8">
        <details className="border border-hairline bg-sheet" open>
          <summary className="cursor-pointer border-b border-hairline px-3 py-1.5 font-display text-xs font-bold uppercase tracking-[0.2em] text-blueprint">
            Run history
          </summary>
          <div className="p-3">
            {flow.runs.length === 0 ? (
              <p className="font-mono text-sm text-ink-soft">No runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className="py-2 pr-4 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                        When
                      </th>
                      <th className="py-2 pr-4 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                        Status
                      </th>
                      <th className="py-2 pr-4 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
                        Output / Error
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runGroups.map((group) => {
                      if (group.kind === "single") {
                        const run = group.run;
                        const trace = run.output as unknown as RunTrace | null;
                        const ok = run.status === "success";
                        return (
                          <tr key={run.id} className="border-b border-hairline align-top">
                            <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs text-ink-soft">
                              {run.createdAt.toLocaleString()}
                            </td>
                            <td className="py-2 pr-4">
                              <span className="flex items-center gap-1.5 font-mono text-xs text-ink">
                                <span
                                  className={`h-2 w-2 rounded-full ${ok ? "bg-azure" : "bg-redline"}`}
                                  aria-hidden
                                />
                                {run.status}
                              </span>
                            </td>
                            <td className="py-2 pr-4">
                              {ok ? (
                                <>
                                  <div className="mb-1 font-mono text-xs text-ink-soft">
                                    {trace?.steps.map((s) => `${s.key}:${s.status} (${s.ms}ms)`).join("  ")}
                                  </div>
                                  <pre className="max-w-md overflow-x-auto font-mono text-xs text-ink">
                                    {JSON.stringify(trace?.final, null, 2)}
                                  </pre>
                                </>
                              ) : (
                                <pre className="max-w-md overflow-x-auto font-mono text-xs text-redline">
                                  {run.errorMessage}
                                </pre>
                              )}
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={group.batchId} className="border-b border-hairline align-top">
                          <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs text-ink-soft">
                            {group.runs[0].createdAt.toLocaleString()}
                          </td>
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-1.5 font-mono text-xs text-ink">
                              <span className="h-2 w-2 rounded-full bg-blueprint" aria-hidden />
                              CSV batch
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            <details>
                              <summary className="cursor-pointer font-mono text-xs text-ink-soft">
                                {group.total} rows · <span className="text-azure">{group.succeeded} ✓</span>
                                {" / "}
                                <span className="text-redline">{group.failed} ✗</span>
                              </summary>
                              <div className="mt-1 space-y-1">
                                {group.runs.map((run) => {
                                  const trace = run.output as unknown as RunTrace | null;
                                  return (
                                    <pre
                                      key={run.id}
                                      className="max-w-md overflow-x-auto font-mono text-xs text-ink"
                                    >
                                      {run.status === "success"
                                        ? JSON.stringify(trace?.final)
                                        : run.errorMessage}
                                    </pre>
                                  );
                                })}
                              </div>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      </section>
    </main>
  );
}
