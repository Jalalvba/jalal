import { describe, it, expect, vi, afterEach } from "vitest";
import { log, serializeError } from "@/lib/http/logger";

afterEach(() => vi.restoreAllMocks());

describe("serializeError", () => {
  it("unwraps an Error, which JSON.stringify would otherwise flatten to {}", () => {
    expect(JSON.stringify(new Error("boom"))).toBe("{}"); // the bug this exists for
    const out = serializeError(new Error("boom"));
    expect(out.errName).toBe("Error");
    expect(out.errMsg).toBe("boom");
    expect(typeof out.stack).toBe("string");
  });

  it("stringifies a non-Error throw rather than dropping it", () => {
    expect(serializeError("just a string")).toEqual({ err: "just a string" });
  });
});

describe("log", () => {
  it("emits parseable JSON after the [scope] prefix, with ctx merged in", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "rate-limit", "Mongo unreachable, failing open", { key: "abc" });

    expect(spy).toHaveBeenCalledOnce();
    const line = spy.mock.calls[0][0] as string;
    expect(line.startsWith("[rate-limit] ")).toBe(true);

    const parsed = JSON.parse(line.slice("[rate-limit] ".length));
    expect(parsed).toMatchObject({
      level: "error",
      scope: "rate-limit",
      msg: "Mongo unreachable, failing open",
      key: "abc",
    });
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false);
  });

  it("routes each level to its matching console sink", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});

    log("error", "s", "e");
    log("warn", "s", "w");
    log("info", "s", "i");

    expect(err).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
  });
});
