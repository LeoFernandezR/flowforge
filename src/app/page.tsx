import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const flows = await prisma.flow.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">FlowForge</h1>
        <Link
          href="/flows/new"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          New flow
        </Link>
      </div>

      {flows.length === 0 ? (
        <p className="text-gray-500">No flows yet. Create your first one.</p>
      ) : (
        <ul className="divide-y rounded border">
          {flows.map((flow) => (
            <li key={flow.id}>
              <Link href={`/flows/${flow.id}`} className="block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                <span className="font-medium">{flow.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
