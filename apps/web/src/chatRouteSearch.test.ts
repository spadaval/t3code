import { describe, expect, it } from "vitest";

import { parseChatRouteSearch, stripRightPaneSearchParams } from "./chatRouteSearch";

describe("parseChatRouteSearch", () => {
  it("parses a canonical diff pane selection", () => {
    const parsed = parseChatRouteSearch({
      rightPane: "diff",
      diffTurnId: "turn-123",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      rightPane: "diff",
      diffTurnId: "turn-123",
      diffFilePath: "src/app.ts",
    });
  });

  it("parses a canonical issues pane selection", () => {
    expect(
      parseChatRouteSearch({
        rightPane: "issues",
        issueId: "TASK-101",
        diffTurnId: "turn-ignored",
      }),
    ).toEqual({
      rightPane: "issues",
      issueId: "TASK-101",
    });
  });

  it("supports the legacy diff flag for backward compatibility", () => {
    expect(
      parseChatRouteSearch({
        diff: "1",
        diffTurnId: "turn-123",
      }),
    ).toEqual({
      rightPane: "diff",
      diffTurnId: "turn-123",
    });
  });

  it("drops diff file selection when no diff turn is selected", () => {
    expect(
      parseChatRouteSearch({
        rightPane: "diff",
        diffFilePath: "src/app.ts",
      }),
    ).toEqual({
      rightPane: "diff",
    });
  });

  it("ignores issue ids unless the issues pane is active", () => {
    expect(
      parseChatRouteSearch({
        issueId: "TASK-101",
      }),
    ).toEqual({});
  });
});

describe("stripRightPaneSearchParams", () => {
  it("removes all right pane params while preserving unrelated search state", () => {
    expect(
      stripRightPaneSearchParams({
        rightPane: "issues",
        issueId: "TASK-101",
        foo: "bar",
      }),
    ).toEqual({
      foo: "bar",
    });
  });
});
