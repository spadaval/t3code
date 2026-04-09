import { describe, expect, it } from "vitest";

import { parseDiffRouteSearch, stripDiffSearchParams } from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses legacy right pane diff values", () => {
    const parsed = parseDiffRouteSearch({
      rightPane: "diff",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("accepts the diff toggle and normalizes it to diff", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when no diff pane is selected", () => {
    const parsed = parseDiffRouteSearch({
      rightPane: "issues",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("drops file value when turn is not selected", () => {
    const parsed = parseDiffRouteSearch({
      rightPane: "diff",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      rightPane: "diff",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });
});

describe("stripDiffSearchParams", () => {
  it("removes legacy right pane and diff search params", () => {
    expect(
      stripDiffSearchParams({
        rightPane: "issues",
        diff: "1",
        diffTurnId: "turn-1",
        diffFilePath: "src/app.ts",
        foo: "bar",
      }),
    ).toEqual({
      foo: "bar",
    });
  });
});
