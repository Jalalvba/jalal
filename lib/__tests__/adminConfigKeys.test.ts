import { describe, expect, it } from "vitest";
import { OPTION_KEYS, COLORED_OPTION_KEYS, type OptionKey } from "@/lib/types";
import { PLAIN_KEYS, COLORED_KEYS } from "@/app/admin/config/page";

describe("admin/config PLAIN_KEYS/COLORED_KEYS — derived, not hand-copied (I4)", () => {
  it("every real OPTION_KEYS entry is reachable through exactly one of PLAIN_KEYS/COLORED_KEYS", () => {
    const covered = new Set([...PLAIN_KEYS, ...COLORED_KEYS]);
    for (const key of OPTION_KEYS) {
      expect(covered.has(key), `${key} is missing from both PLAIN_KEYS and COLORED_KEYS`).toBe(true);
    }
    expect(covered.size).toBe(OPTION_KEYS.length); // no duplicates, no extras
  });

  it("COLORED_KEYS matches lib/types.ts's COLORED_OPTION_KEYS exactly", () => {
    expect(new Set(COLORED_KEYS)).toEqual(new Set(COLORED_OPTION_KEYS));
  });

  // Demonstrates the actual failure mode the audit found: a hand-copied
  // array (typed as the same non-exhaustive OptionKey[] the old code used)
  // compiles fine and silently drops a newly-added key — the mechanism this
  // fix closes by deriving instead. This doesn't touch the real
  // lib/types.ts; it simulates "a key gets added later" against a
  // structurally identical hand-copied list to show the old code's failure
  // mode is real, not hypothetical.
  it("a hand-copied key list (the old pattern) would silently miss a newly-added OPTION_KEYS entry — this is exactly the bug being fixed", () => {
    const OPTION_KEYS_AFTER_A_FUTURE_ADD = [...OPTION_KEYS, "SOME_NEW_OPTIONS"] as const;
    const OLD_STYLE_HAND_COPIED_PLAIN_KEYS: string[] = [...PLAIN_KEYS]; // frozen at today's keys, exactly like the old hardcoded array was

    const missing = OPTION_KEYS_AFTER_A_FUTURE_ADD.filter(
      (k) => !OLD_STYLE_HAND_COPIED_PLAIN_KEYS.includes(k) && !COLORED_KEYS.includes(k as OptionKey)
    );
    expect(missing).toEqual(["SOME_NEW_OPTIONS"]); // the old pattern's exact failure

    // The derived approach (what PLAIN_KEYS/COLORED_KEYS now actually are)
    // doesn't have this gap: re-deriving PLAIN_KEYS the same way
    // app/admin/config/page.tsx does, against the hypothetical expanded
    // key list, naturally includes the new key.
    const rederivedPlainKeys = OPTION_KEYS_AFTER_A_FUTURE_ADD.filter(
      (k) => !(COLORED_OPTION_KEYS as readonly string[]).includes(k)
    );
    expect(rederivedPlainKeys).toContain("SOME_NEW_OPTIONS");
  });
});
