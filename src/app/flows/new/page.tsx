import Link from "next/link";
import FlowEditor from "../FlowEditor";

export default function NewFlowPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm underline">
        ← Back
      </Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold">New flow</h1>
      <FlowEditor mode="new" />
    </main>
  );
}
