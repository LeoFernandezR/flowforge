"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { flowSchema } from "@/lib/validations/flow";
import type { Prisma } from "@/generated/prisma/client";

export async function createFlow(data: unknown): Promise<void> {
  const parsed = flowSchema.parse(data);
  const flow = await prisma.flow.create({
    data: {
      name: parsed.name,
      provider: parsed.provider,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
      // Legacy columns (dropped in a later task) — filled to satisfy NOT NULL.
      prompt: parsed.steps[0].prompt,
      taskType: "extract",
      fields: (parsed.steps[0].fields ?? []) as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/");
  redirect(`/flows/${flow.id}`);
}

export async function updateFlow(id: string, data: unknown): Promise<void> {
  const parsed = flowSchema.parse(data);
  await prisma.flow.update({
    where: { id },
    data: {
      name: parsed.name,
      provider: parsed.provider,
      steps: parsed.steps as unknown as Prisma.InputJsonValue,
      // Legacy columns (dropped in a later task) — kept in sync to satisfy NOT NULL.
      prompt: parsed.steps[0].prompt,
      taskType: "extract",
      fields: (parsed.steps[0].fields ?? []) as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath(`/flows/${id}`);
  revalidatePath("/");
}

export async function deleteFlow(id: string): Promise<void> {
  await prisma.flow.delete({ where: { id } });
  revalidatePath("/");
  redirect("/");
}
