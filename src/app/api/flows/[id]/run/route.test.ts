import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/flow/runFlow", () => ({ runFlow: vi.fn() }));

import { runFlow } from "@/lib/flow/runFlow";
import { POST } from "./route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/flows/flow_1/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: "flow_1" }) };

beforeEach(() => {
  vi.mocked(runFlow).mockReset();
});

describe("POST /api/flows/[id]/run", () => {
  test("returns 400 for empty input", async () => {
    const res = await POST(makeRequest({ input: "  " }) as never, ctx as never);
    expect(res.status).toBe(400);
  });

  test("returns 200 with the persisted run on success", async () => {
    vi.mocked(runFlow).mockResolvedValue({ id: "run_1", status: "success" } as never);
    const res = await POST(makeRequest({ input: "Ada" }) as never, ctx as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "run_1", status: "success" });
  });

  test("returns 404 when the flow is not found", async () => {
    vi.mocked(runFlow).mockRejectedValue(new Error("Flow not found"));
    const res = await POST(makeRequest({ input: "Ada" }) as never, ctx as never);
    expect(res.status).toBe(404);
  });

  test("returns 500 for other errors", async () => {
    vi.mocked(runFlow).mockRejectedValue(new Error("GEMINI_API_KEY is not set"));
    const res = await POST(makeRequest({ input: "Ada" }) as never, ctx as never);
    expect(res.status).toBe(500);
  });
});
