import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/http/rateLimit", () => ({ rateLimitOrNull: vi.fn().mockResolvedValue(null) }));

const mockUpdateSheetRow = vi.fn();
vi.mock("@/lib/sheets/googleSheetsBdd", () => ({
  updateSheetRow: (...args: unknown[]) => mockUpdateSheetRow(...args),
}));

import { POST } from "@/app/api/bdd/update/route";

function req(body: unknown): Request {
  return new Request("http://localhost/api/bdd/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bdd/update — row-identity plumbing", () => {
  it("rejects a request with no 'imm' — the exact gap Opus's audit found (C1)", async () => {
    const res = await POST(req({ row: 42, updates: { commentaire: "hi" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/imm/i);
    expect(mockUpdateSheetRow).not.toHaveBeenCalled();
  });

  it("rejects a request with a blank 'imm'", async () => {
    const res = await POST(req({ row: 42, updates: { commentaire: "hi" }, imm: "   " }));
    expect(res.status).toBe(400);
    expect(mockUpdateSheetRow).not.toHaveBeenCalled();
  });

  it("passes 'imm' straight through to updateSheetRow as the expectedImm argument", async () => {
    mockUpdateSheetRow.mockResolvedValue({ ok: true, written: ["commentaire"] });

    const res = await POST(req({ row: 42, updates: { commentaire: "hi" }, imm: "12345-B-6" }));

    expect(res.status).toBe(200);
    expect(mockUpdateSheetRow).toHaveBeenCalledWith(42, { commentaire: "hi" }, "12345-B-6");
  });
});
