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
      prompt: parsed.prompt,
      taskType: "extract",
      provider: parsed.provider,
      fields: parsed.fields as unknown as Prisma.InputJsonValue,
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
      prompt: parsed.prompt,
      provider: parsed.provider,
      fields: parsed.fields as unknown as Prisma.InputJsonValue,
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
