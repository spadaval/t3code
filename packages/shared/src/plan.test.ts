import { describe, expect, it } from "vitest";

import { describeProposedPlanFollowUpOutcome } from "./plan";

describe("describeProposedPlanFollowUpOutcome", () => {
  it("returns code follow-up copy for code follow-up", () => {
    expect(describeProposedPlanFollowUpOutcome({ kind: "implement-code" })).toBe(
      "Code follow-up started",
    );
  });

  it("returns tracker-specific copy for tracker conversion follow-up", () => {
    expect(describeProposedPlanFollowUpOutcome({ kind: "convert-to-tracker" })).toBe(
      "Converted to tracker",
    );
  });
});
