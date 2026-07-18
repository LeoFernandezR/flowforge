import Link from "next/link";
import FlowEditor from "../FlowEditor";

export default function NewFlowPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 sm:p-8">
      <Link href="/" className="font-mono text-xs text-azure hover:underline">
        ← all flows
      </Link>
      <p className="mt-4 mb-4 font-display text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">
        New sheet
      </p>
      <FlowEditor mode="new" />
    </main>
  );
}
