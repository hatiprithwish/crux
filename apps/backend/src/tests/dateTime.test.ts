import { describe, it, expect } from "vitest";
import { localDateIn } from "@/utils/DateTime";

describe("localDateIn", () => {
  it("rolls to the next calendar day at local midnight, ahead of UTC midnight", () => {
    // 18:43 UTC on 18 Sep is 00:13 IST on 19 Sep.
    const at = new Date(Date.UTC(2026, 8, 18, 18, 43, 0));
    expect(localDateIn("Asia/Kolkata", at)).toBe("2026-09-19");
    expect(localDateIn("UTC", at)).toBe("2026-09-18");
  });

  it("stays on the previous calendar day behind UTC", () => {
    // 02:00 UTC on 19 Sep is 22:00 EDT on 18 Sep.
    const at = new Date(Date.UTC(2026, 8, 19, 2, 0, 0));
    expect(localDateIn("America/New_York", at)).toBe("2026-09-18");
  });
});
