import { TurnId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useUiStateStore } from "~/uiStateStore";
import { AssistantChangedFilesSection } from "./MessagesTimeline";

const turnId = TurnId.make("turn-1");
const turnSummary = {
  turnId,
  completedAt: "2026-03-17T19:12:28.000Z",
  files: [
    { path: "apps/web/src/session-logic.ts", additions: 2, deletions: 1 },
    { path: "apps/web/src/components/chat/MessagesTimeline.tsx" },
  ],
};

describe("AssistantChangedFilesSection", () => {
  it("renders changed files collapsed by default", () => {
    useUiStateStore.setState({ threadChangedFilesExpandedById: {} });

    const markup = renderToStaticMarkup(
      <AssistantChangedFilesSection
        turnSummary={turnSummary}
        routeThreadKey="environment-local:thread-1"
        resolvedTheme="light"
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain("Changed files (2)");
    expect(markup).toContain("Show files");
    expect(markup).not.toContain("session-logic.ts");
    expect(markup).not.toContain("MessagesTimeline.tsx");
  });
});
