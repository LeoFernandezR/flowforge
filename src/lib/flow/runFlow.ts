import { prisma } from "@/lib/prisma";
import type { Prisma, Run } from "@/generated/prisma/client";
import { getProvider } from "./providers";
import type { LlmProvider } from "./providers/types";
import { getStepExecutor } from "./steps/registry";
import type { FieldDef } from "./types";

export interface RunFlowDeps {
  provider?: LlmProvider;
}

export async function runFlow(flowId: string, input: string, deps: RunFlowDeps = {}): Promise<Run> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow) {
    throw new Error("Flow not found");
  }

  const provider = deps.provider ?? getProvider("gemini");
  const step = getStepExecutor(flow.taskType);
  const fields = flow.fields as unknown as FieldDef[];

  const start = Date.now();
  const result = await step.execute({ prompt: flow.prompt, input, fields, provider });
  const durationMs = Date.now() - start;

  return prisma.run.create({
    data: {
      flowId: flow.id,
      input,
      status: result.status,
      output: result.output === null ? undefined : (result.output as Prisma.InputJsonValue),
      errorMessage: result.errorMessage,
      provider: provider.name,
      model: provider.model,
      durationMs,
    },
  });
}
