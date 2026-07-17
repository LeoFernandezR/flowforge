import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FlowEditor from "../FlowEditor";
import type { Step } from "@/lib/flow/types";
import type { ProviderName } from "@/lib/validations/flow";

export const dynamic = "force-dynamic";

type RunTrace = { final: unknown; steps: Array<{ key: string; status: string; ms: number }> };

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await prisma.flow.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } },
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

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">{flow.name}</h1>

      <FlowEditor
        mode="edit"
        flow={{ id: flow.id, name: flow.name, provider: flow.provider as ProviderName, steps }}
      />

      <section className="mt-8">
        <h2 className="mb-2 font-semibold">Run history</h2>
        {flow.runs.length === 0 ? (
          <p className="text-sm text-gray-500">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Output / Error</th>
                </tr>
              </thead>
              <tbody>
                {flow.runs.map((run) => {
                  const trace = run.output as unknown as RunTrace | null;
                  return (
                    <tr key={run.id} className="border-b align-top">
                      <td className="py-2 pr-4 whitespace-nowrap">{run.createdAt.toLocaleString()}</td>
                      <td className="py-2 pr-4">{run.status}</td>
                      <td className="py-2 pr-4">
                        {run.status === "success" ? (
                          <>
                            <div className="mb-1 text-xs text-gray-500">
                              {trace?.steps.map((s) => `${s.key}:${s.status} (${s.ms}ms)`).join("  ")}
                            </div>
                            <pre className="max-w-md overflow-x-auto text-xs">
                              {JSON.stringify(trace?.final, null, 2)}
                            </pre>
                          </>
                        ) : (
                          <pre className="max-w-md overflow-x-auto text-xs">{run.errorMessage}</pre>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
