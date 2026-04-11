import { ThreadId } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarProvider } from "../ui/sidebar";
import { ChatHeader } from "./ChatHeader";

function renderHeader(options?: {
  currentIssue?: Parameters<typeof ChatHeader>[0]["currentIssue"];
  issuesOpen?: boolean;
}) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <ChatHeader
          activeThreadId={ThreadId.makeUnsafe("thread-1")}
          activeThreadTitle="Chat thread"
          activeProjectName="t3code"
          isGitRepo={false}
          openInCwd={null}
          activeProjectScripts={undefined}
          preferredScriptId={null}
          keybindings={[]}
          availableEditors={[]}
          diffToggleShortcutLabel={null}
          gitCwd={null}
          diffOpen={false}
          issuesOpen={options?.issuesOpen ?? false}
          currentIssue={options?.currentIssue ?? null}
          onRunProjectScript={() => {}}
          onAddProjectScript={async () => {}}
          onUpdateProjectScript={async () => {}}
          onDeleteProjectScript={async () => {}}
          onToggleIssues={() => {}}
          onToggleDiff={() => {}}
        />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

describe("ChatHeader issue row", () => {
  it("preserves the top bar when the thread has no linked issue", () => {
    const markup = renderHeader();

    expect(markup).toContain("Chat thread");
    expect(markup).toContain("t3code");
    expect(markup).not.toContain("Fix the issue viewer");
    expect(markup).toContain('aria-label="Show issues"');
  });

  it("renders a small linked-issue badge", () => {
    const markup = renderHeader({
      currentIssue: {
        id: "beads-123",
        title: "Fix the issue viewer",
      },
    });

    expect(markup).toContain("Chat thread");
    expect(markup).toContain("t3code");
    expect(markup).toContain("Fix the issue viewer");
    expect(markup).toContain("beads-123");
    expect(markup).not.toContain("Refine");
    expect(markup).not.toContain("Continue");
  });

  it("updates the issues toggle label when the pane is open", () => {
    const markup = renderHeader({ issuesOpen: true });

    expect(markup).toContain('aria-label="Hide issues"');
    expect(markup).not.toContain('aria-label="Show issues"');
  });
});
