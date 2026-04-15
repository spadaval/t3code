import type { BeadsCoordinatorEpicSnapshot, OrchestrationEpicRun } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCoordinatorRunEntries,
  describeCoordinatorActionCopy,
  resolveEpicOutputTarget,
  resolvePrimaryActionOutputTarget,
  selectCoordinatorRunEntry,
} from "./epicCoordinatorUi";

function makeRun(
  runId: string,
  status: OrchestrationEpicRun["status"],
  overrides: Partial<OrchestrationEpicRun> = {},
): OrchestrationEpicRun {
  return {
    runId: runId as never,
    projectId: "project-1" as never,
    epicIssueId: "EPIC-1",
    status,
    provider: "codex",
    model: "gpt-5.4",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    failureContext:
      status === "failed"
        ? {
            kind: "worker_failure",
            issueId: "ISSUE-1",
            executionId: null,
            workerThreadId: null,
            message: "boom",
          }
        : null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: status === "stopped" ? "2026-04-08T00:00:04.000Z" : null,
    failedAt: status === "failed" ? "2026-04-08T00:00:04.000Z" : null,
    completedAt: status === "completed" ? "2026-04-08T00:00:04.000Z" : null,
    updatedAt: "2026-04-08T00:00:05.000Z",
    ...overrides,
  };
}

function makeEpic(
  epicId: string,
  runs: readonly OrchestrationEpicRun[],
  overrides: Partial<BeadsCoordinatorEpicSnapshot> = {},
): BeadsCoordinatorEpicSnapshot {
  return {
    epicId,
    epicTitle: epicId,
    issue: null,
    trackerLoadState: "ready",
    trackerLoadDetail: null,
    coordinationSupported: true,
    coordinationUnsupportedReason: null,
    validationState: "valid",
    validationErrors: [],
    trackerState: "not_started",
    progress: {
      totalIssueCount: 3,
      completedIssueCount: 1,
      readyIssueCount: 1,
      activeIssueCount: 1,
      blockedIssueCount: 0,
      internalBlockedIssueCount: 0,
      externalBlockedIssueCount: 0,
      unknownBlockedIssueCount: 0,
      activeWorkerCount: 1,
      isComplete: false,
    },
    primaryAction: {
      kind: "start_epic_run",
      label: "Start epic",
      busyLabel: "Starting...",
      disabled: false,
    },
    activeRunId: null,
    activeExecutionId: null,
    projectConflict: null,
    trackerSummary: null,
    validation: null,
    status: null,
    runs,
    executions: [],
    ...overrides,
  } as BeadsCoordinatorEpicSnapshot;
}

describe("epicCoordinatorUi", () => {
  it("groups active, failed latest, and history runs into coordinator sections", () => {
    const activeEpic = makeEpic("EPIC-A", [makeRun("run-active", "running")], {
      activeRunId: "run-active" as never,
    });
    const failedEpic = makeEpic("EPIC-B", [makeRun("run-failed", "failed")]);
    const historyEpic = makeEpic("EPIC-C", [makeRun("run-done", "completed")]);
    const entries = buildCoordinatorRunEntries([activeEpic, failedEpic, historyEpic]);

    expect(entries.map((entry) => [entry.run.runId, entry.section])).toEqual([
      ["run-active", "active"],
      ["run-failed", "needsIntervention"],
      ["run-done", "history"],
    ]);
  });

  it("resolves coordinator selection by run id, then epic id, then active/failure/history precedence", () => {
    const activeEpic = makeEpic("EPIC-A", [makeRun("run-active", "running")], {
      activeRunId: "run-active" as never,
    });
    const failedEpic = makeEpic("EPIC-B", [makeRun("run-failed", "failed")]);
    const historyEpic = makeEpic("EPIC-C", [makeRun("run-done", "completed")]);
    const entries = buildCoordinatorRunEntries([activeEpic, failedEpic, historyEpic]);

    expect(selectCoordinatorRunEntry({ entries, runId: "run-done" })?.run.runId).toBe("run-done");
    expect(selectCoordinatorRunEntry({ entries, epicId: "EPIC-B" })?.run.runId).toBe("run-failed");
    expect(selectCoordinatorRunEntry({ entries })?.run.runId).toBe("run-active");
  });

  it("resolves output targets from active/latest run and project conflict", () => {
    const activeEpic = makeEpic(
      "EPIC-A",
      [
        makeRun("run-old", "completed", { updatedAt: "2026-04-07T00:00:00.000Z" }),
        makeRun("run-active", "running"),
      ],
      {
        activeRunId: "run-active" as never,
      },
    );

    expect(resolveEpicOutputTarget(activeEpic)).toEqual({
      epicId: "EPIC-A",
      runId: "run-active",
    });

    expect(
      resolvePrimaryActionOutputTarget(
        makeEpic("EPIC-B", [makeRun("run-b", "completed")], {
          projectConflict: {
            run: makeRun("run-conflict", "running", {
              epicIssueId: "EPIC-X",
            }),
            message: "busy",
          },
        }),
      ),
    ).toEqual({
      epicId: "EPIC-X",
      runId: "run-conflict",
    });
  });

  it("maps coordinator action copy by surface", () => {
    expect(
      describeCoordinatorActionCopy({
        surface: "issues",
        action: {
          kind: "open_coordinator",
          label: "Open epic",
          busyLabel: "Opening...",
        },
        epic: { projectConflict: null },
      }),
    ).toEqual({
      label: "Open output",
      busyLabel: "Opening...",
    });

    expect(
      describeCoordinatorActionCopy({
        surface: "coordinator",
        action: {
          kind: "start_epic_run",
          label: "Start epic",
          busyLabel: "Starting...",
        },
        epic: { projectConflict: null },
        selectedRun: { status: "failed" },
      }),
    ).toEqual({
      label: "Retry run",
      busyLabel: "Retrying...",
    });
  });
});
