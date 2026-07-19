// Seeds a single demo flow that exercises every FlowForge feature end to end.
//
//   npm run seed
//
// Idempotent: the flow has a fixed id, so re-running refreshes it in place rather
// than piling up duplicates. Runs recorded against it are left alone.
//
// Coverage: both step types, all four field types, an optional field, {{input}} and
// {{step.field}} chaining (including {{generate.text}}), a multi-hop backward ref,
// and an explicit per-step provider override.
//
// Not covered: retry-on-invalid-output. Groq enforces the JSON schema server-side, so
// a Zod validation failure — what triggers the retry — effectively never fires here.
// When it does fire, the per-step attempt count in the trace panel is where it shows up.

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Step } from "../src/lib/flow/types";

const DEMO_FLOW_ID = "demo-support-ticket-triage";

const steps: Step[] = [
  {
    key: "ticket",
    type: "extract",
    name: "Read the ticket",
    prompt: [
      "You are triaging an inbound customer support ticket.",
      "",
      "Ticket:",
      "{{input}}",
      "",
      "Pull out the structured details. Rate urgency from 1 (trivial) to 5 (outage).",
      "Leave customer_name empty if the ticket does not name the customer.",
    ].join("\n"),
    fields: [
      { name: "category", type: "string", required: true, order: 0 },
      { name: "urgency", type: "number", required: true, order: 1 },
      { name: "needs_refund", type: "boolean", required: true, order: 2 },
      { name: "tags", type: "string_array", required: true, order: 3 },
      { name: "customer_name", type: "string", required: false, order: 4 },
    ],
  },
  {
    key: "reply",
    type: "generate",
    name: "Draft a reply",
    // Set explicitly rather than inherited, so the per-step override control shows populated.
    provider: "groq",
    prompt: [
      "Write a short, warm reply to this support ticket. Three sentences at most.",
      "",
      "Category: {{ticket.category}}",
      "Urgency (1-5): {{ticket.urgency}}",
      "Customer name (may be blank): {{ticket.customer_name}}",
      "",
      "Original ticket:",
      "{{input}}",
      "",
      "Address the customer by name if you have one. Do not promise a refund.",
    ].join("\n"),
  },
  {
    key: "triage",
    type: "extract",
    name: "Route it",
    // Chains from both prior steps — a numeric field from step 1 and the free text of step 2.
    prompt: [
      "Decide how this ticket should be routed.",
      "",
      "Urgency (1-5): {{ticket.urgency}}",
      "",
      "Drafted reply:",
      "{{reply.text}}",
      "",
      "Pick a queue (billing, technical, or general), an SLA in hours, and whether a",
      "human should escalate before the reply goes out.",
    ].join("\n"),
    fields: [
      { name: "queue", type: "string", required: true, order: 0 },
      { name: "sla_hours", type: "number", required: true, order: 1 },
      { name: "escalate", type: "boolean", required: true, order: 2 },
    ],
  },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const data = {
    name: "Demo — Support Ticket Triage",
    provider: "groq",
    steps: steps as unknown as object,
  };

  const flow = await prisma.flow.upsert({
    where: { id: DEMO_FLOW_ID },
    create: { id: DEMO_FLOW_ID, ...data },
    update: data,
  });

  console.log(`Seeded flow "${flow.name}" (${flow.id})`);
  console.log("Open /flows/" + flow.id + " to run it.");
  console.log("Sample CSV for the batch path: public/demo-tickets.csv (column: body)");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
