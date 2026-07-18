import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const flows = await prisma.flow.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-8">
      <header className="mb-6 flex items-end justify-between border-b border-blueprint pb-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-[0.12em] text-ink">FlowForge</h1>
          <p className="mt-1 font-mono text-xs text-ink-soft">Linear LLM pipelines · drafting table</p>
        </div>
        <Link
          href="/flows/new"
          className="rounded-sm bg-azure px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
        >
          New flow
        </Link>
      </header>

      {flows.length === 0 ? (
        <p className="font-mono text-sm text-ink-soft">No flows yet. Draft your first one.</p>
      ) : (
        <ul className="divide-y divide-hairline border border-hairline bg-sheet">
          {flows.map((flow) => (
            <li key={flow.id}>
              <Link
                href={`/flows/${flow.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-paper/50"
              >
                <span className="h-2 w-2 rounded-full border border-blueprint" aria-hidden />
                <span className="font-medium text-ink">{flow.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
