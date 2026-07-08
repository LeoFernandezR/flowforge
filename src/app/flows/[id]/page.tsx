import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import FlowEditor from "../FlowEditor";
import type { FieldDef } from "@/lib/flow/types";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await prisma.flow.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  if (!flow) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">{flow.name}</h1>

      <FlowEditor
        mode="edit"
        flow={{
          id: flow.id,
          name: flow.name,
          prompt: flow.prompt,
          fields: flow.fields as unknown as FieldDef[],
        }}
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
                {flow.runs.map((run) => (
                  <tr key={run.id} className="border-b align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{run.createdAt.toLocaleString()}</td>
                    <td className="py-2 pr-4">{run.status}</td>
                    <td className="py-2 pr-4">
                      <pre className="max-w-md overflow-x-auto text-xs">
                        {run.status === "success" ? JSON.stringify(run.output, null, 2) : run.errorMessage}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
