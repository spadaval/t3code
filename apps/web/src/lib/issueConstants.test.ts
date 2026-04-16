import { describe, expect, it } from "vitest";

import { isIssueDoneStatus } from "./issueConstants";

describe("isIssueDoneStatus", () => {
  it("returns true for done tracker statuses", () => {
    expect(isIssueDoneStatus("closed")).toBe(true);
  });

  it("returns false for non-done and missing statuses", () => {
    expect(isIssueDoneStatus("open")).toBe(false);
    expect(isIssueDoneStatus("in_progress")).toBe(false);
    expect(isIssueDoneStatus(null)).toBe(false);
    expect(isIssueDoneStatus(undefined)).toBe(false);
    expect(isIssueDoneStatus("unknown")).toBe(false);
  });
});
