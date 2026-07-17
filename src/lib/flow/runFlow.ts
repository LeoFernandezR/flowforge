import { prisma } from "@/lib/prisma";
import type { Prisma, Run } from "@/generated/prisma/client";
import { getProvider } from "./providers";
import type { LlmProvider } from "./providers/types";
import { getStepExecutor } from "./steps/registry";
import { resolveTemplate, type ResolveContext } from "./template";
import type { Step } from "./types";

export interface RunFlowDeps {
  provider?: LlmProvider;
}

interface StepTrace {
  key: string;
  type: string;
  status: "success" | "error";
  output: Record<string, unknown> | null;
  error: string | null;
  model: string;
  ms: number;
}

export async function runFlow(flowId: string, input: string, deps: RunFlowDeps = {}): Promise<Run> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow) {
    throw new Error("Flow not found");
  }

  const steps = (flow.steps ?? []) as unknown as Step[];
  const context: ResolveContext = { input };
  const trace: StepTrace[] = [];
  let finalOutput: Record<string, unknown> | null = null;
  let runStatus: "success" | "error" = "success";
  let runErrorMessage: string | null = null;
  let lastProviderName = flow.provider;
  let lastModel = "";

  for (const step of steps) {
    const start = Date.now();
    let status: "success" | "error";
    let output: Record<string, unknown> | null;
    let error: string | null;
    let model = lastModel;
    try {
      const provider = deps.provider ?? getProvider(step.provider ?? flow.provider);
      lastProviderName = provider.name;
      lastModel = provider.model;
      model = provider.model;
      const resolved = resolveTemplate(step.prompt, context);
      const result = await getStepExecutor(step.type).execute({
        prompt: resolved,
        fields: step.fields ?? [],
        provider,
      });
      status = result.status;
      output = result.output;
      error = result.errorMessage;
    } catch (err) {
      status = "error";
      output = null;
      error = (err as Error).message;
    }
    const ms = Date.now() - start;

    trace.push({ key: step.key, type: step.type, status, output, error, model, ms });

    if (status === "error") {
      runStatus = "error";
      runErrorMessage = error;
      break;
    }
    context[step.key] = output ?? {};
    finalOutput = output;
  }

  const durationMs = trace.reduce((sum, entry) => sum + entry.ms, 0);

  return prisma.run.create({
    data: {
      flowId: flow.id,
      input,
      status: runStatus,
      output: { final: finalOutput, steps: trace } as unknown as Prisma.InputJsonValue,
      errorMessage: runErrorMessage,
      provider: lastProviderName,
      model: lastModel,
      durationMs,
    },
  });
}
