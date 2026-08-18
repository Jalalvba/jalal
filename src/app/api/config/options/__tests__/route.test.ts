import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/http/rateLimit", () => ({ rateLimitOrNull: vi.fn().mockResolvedValue(null) }));

const mockGetAllSheetFieldOptionsWithStatus = vi.fn();
const mockUpdateFieldOptions = vi.fn();

vi.mock("@/lib/mongo/sheetFieldOptions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mongo/sheetFieldOptions")>("@/lib/mongo/sheetFieldOptions");
  return {
    ...actual,
    getAllSheetFieldOptionsWithStatus: (...args: unknown[]) => mockGetAllSheetFieldOptionsWithStatus(...args),
    updateFieldOptions: (...args: unknown[]) => mockUpdateFieldOptions(...args),
  };
});

import { GET, POST } from "@/app/api/config/options/route";
import { OptionsConflictError, OptionsValidationError } from "@/lib/mongo/sheetFieldOptions";

function req(body: unknown): Request {
  return new Request("http://localhost/api/config/options", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/config/options — surfaces degraded status (C2)", () => {
  it("passes through degraded:true and meta so the client can tell a Mongo outage apart from a normal read", async () => {
    mockGetAllSheetFieldOptionsWithStatus.mockResolvedValue({
      options: { EMPLACEMENT_OPTIONS: ["ATELIER"] },
      degraded: true,
      meta: { EMPLACEMENT_OPTIONS: null },
    });

    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.meta.EMPLACEMENT_OPTIONS).toBeNull();
  });
});

describe("POST /api/config/options — caps, trimming, conflict (I2/C2)", () => {
  it("rejects a list over the MAX_OPTIONS cap", async () => {
    const res = await POST(req({ key: "EMPLACEMENT_OPTIONS", options: Array.from({ length: 101 }, (_, i) => `v${i}`) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Trop de valeurs/);
    expect(mockUpdateFieldOptions).not.toHaveBeenCalled();
  });

  it("rejects a value over MAX_VALUE_LENGTH", async () => {
    const res = await POST(req({ key: "EMPLACEMENT_OPTIONS", options: ["a".repeat(201)] }));
    expect(res.status).toBe(400);
    expect(mockUpdateFieldOptions).not.toHaveBeenCalled();
  });

  it("trims a value with leading/trailing whitespace before it reaches updateFieldOptions (I2)", async () => {
    mockUpdateFieldOptions.mockResolvedValue(undefined);

    await POST(req({ key: "EMPLACEMENT_OPTIONS", options: ["ALI "], expectedUpdatedAt: null }));

    expect(mockUpdateFieldOptions).toHaveBeenCalledWith(
      { key: "EMPLACEMENT_OPTIONS", options: ["ALI"] },
      expect.any(String),
      null
    );
  });

  it("trims colored-option values too", async () => {
    mockUpdateFieldOptions.mockResolvedValue(undefined);

    await POST(req({ key: "FLAG_OPTIONS", options: [{ value: " Urgent ", color: "red" }], expectedUpdatedAt: null }));

    expect(mockUpdateFieldOptions).toHaveBeenCalledWith(
      { key: "FLAG_OPTIONS", options: [{ value: "Urgent", color: "red" }] },
      expect.any(String),
      null
    );
  });

  it("passes expectedUpdatedAt through to updateFieldOptions", async () => {
    mockUpdateFieldOptions.mockResolvedValue(undefined);

    await POST(req({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"], expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }));

    expect(mockUpdateFieldOptions).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "2026-01-01T00:00:00.000Z"
    );
  });

  it("a conflict from updateFieldOptions surfaces as 409, not a generic 500", async () => {
    mockUpdateFieldOptions.mockRejectedValue(new OptionsConflictError("changed since you loaded it"));

    const res = await POST(req({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"], expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("a validation error still surfaces as 400", async () => {
    mockUpdateFieldOptions.mockRejectedValue(new OptionsValidationError("La liste ne peut pas être vide."));

    const res = await POST(req({ key: "EMPLACEMENT_OPTIONS", options: ["ATELIER"] }));

    expect(res.status).toBe(400);
  });
});
