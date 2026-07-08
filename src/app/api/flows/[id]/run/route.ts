import type { NextRequest } from "next/server";
import { runFlow } from "@/lib/flow/runFlow";
import { runInputSchema } from "@/lib/validations/flow";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/flows/[id]/run">) {
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = runInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Input is required" }, { status: 400 });
  }

  try {
    const run = await runFlow(id, parsed.data.input);
    return Response.json(run, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "Flow not found") {
      return Response.json({ error: err.message }, { status: 404 });
    }
    console.error("POST /api/flows/[id]/run failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
