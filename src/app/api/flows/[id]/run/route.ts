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
    const message = (err as Error).message;
    if (message === "Flow not found") {
      return Response.json({ error: message }, { status: 404 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
