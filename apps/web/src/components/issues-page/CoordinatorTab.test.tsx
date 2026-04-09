import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CoordinatorTab } from "./CoordinatorTab";

const SWARM_SUPPORT = {
  supported: true,
  reason: null,
  backend: {
    kind: "dolt",
    doltMode: null,
    database: null,
    projectId: null,
    role: null,
    bdVersion: null,
  },
} as const;

function renderCoordinatorTab() {
  const queryClient = new QueryClient();

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CoordinatorTab
        cwd="/repo"
        projectId={null}
        swarmSupport={SWARM_SUPPORT}
        swarmSupportPending={false}
        swarmSupportError={null}
        snapshot={{
          projectId: "project-1" as never,
          support: SWARM_SUPPORT,
          epics: [
            {
              epicId: "EPIC-1",
              epicTitle: "Epic 1",
              issue: null,
              fetchLifecycle: { kind: "ready", detail: null },
              stateKind: "cancelled",
              primaryAction: {
                kind: "resume_paused_swarm_run",
                label: "Resume swarm",
                busyLabel: "Resuming...",
                disabled: false,
              },
              latestRun: {
                runId: "run-1" as never,
                projectId: "project-1" as never,
                epicIssueId: "EPIC-1",
                status: "cancelled",
                schedulerMode: "automatic",
                workspaceMode: "shared",
                provider: "codex",
                model: "gpt-5.4",
                modelOptions: null,
                providerOptions: null,
                assistantDeliveryMode: null,
                runtimeMode: "full-access",
                lastError: null,
                requestedAt: "2026-04-08T00:00:00.000Z",
                startedAt: "2026-04-08T00:00:01.000Z",
                idledAt: null,
                pausedAt: null,
                blockedAt: null,
                blockedContext: null,
                failedAt: null,
                cancelledAt: "2026-04-08T00:00:02.000Z",
                completedAt: null,
                updatedAt: "2026-04-08T00:00:02.000Z",
              },
              projectConflict: null,
              swarmSummary: null,
              validation: null,
              status: null,
              runs: [],
              executions: [],
              activeExecution: null,
            },
          ],
        }}
        snapshotPending={false}
        snapshotError={null}
        selectedEpicId="EPIC-1"
        onSelectEpic={() => {}}
        onOpenEpicIssue={() => {}}
        onOpenThread={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("CoordinatorTab actions", () => {
  it("renders a resume action for cancelled swarms", () => {
    const markup = renderCoordinatorTab();

    expect(markup).toContain("Actions");
    expect(markup).toContain("Resume swarm");
  });
});
