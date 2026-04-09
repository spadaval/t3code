import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildWorkGraphData } from "./workGraphData";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIssue(
  id: string,
  title: string,
  overrides?: Partial<BeadsIssueRelationSummary>,
): BeadsIssueRelationSummary {
  return {
    id,
    title,
    status: "open",
    priority: null,
    issueType: "task",
    assignee: null,
    owner: null,
    parent: null,
    ...overrides,
  } as BeadsIssueRelationSummary;
}

function makeExecution(
  id: string,
  issueId: string,
  seq: number,
  overrides?: Partial<OrchestrationSwarmTaskExecution>,
): OrchestrationSwarmTaskExecution {
  return {
    executionId: id as never,
    runId: "run-1" as never,
    issueId,
    workerThreadId: null,
    sequenceNumber: seq,
    status: "completed",
    originalStatus: "open",
    originalAssignee: null,
    lastError: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    completedAt: "2026-04-08T00:00:10.000Z",
    failedAt: null,
    cancelledAt: null,
    updatedAt: "2026-04-08T00:00:10.000Z",
    ...overrides,
  } as OrchestrationSwarmTaskExecution;
}

function makeRun(
  id: string,
  status: OrchestrationSwarmRun["status"],
  overrides?: Partial<OrchestrationSwarmRun>,
): OrchestrationSwarmRun {
  return {
    runId: id as never,
    projectId: "project-1" as never,
    epicIssueId: "EPIC-1",
    status,
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
    cancelledAt: null,
    completedAt: null,
    updatedAt: "2026-04-08T00:00:01.000Z",
    ...overrides,
  } as OrchestrationSwarmRun;
}

function makeStatus(
  overrides: Partial<BeadsSwarmStatus> & {
    completed?: BeadsIssueRelationSummary[];
    active?: BeadsIssueRelationSummary[];
    ready?: BeadsIssueRelationSummary[];
    blocked?: BeadsIssueRelationSummary[];
  },
): BeadsCoordinatorEpicSnapshot["status"] {
  return {
    epicId: "EPIC-1",
    epicTitle: "Test Epic",
    swarm: null,
    completed: [],
    active: [],
    ready: [],
    blocked: [],
    blockedBreakdown: { internal: [], external: [], unknown: [] },
    ...overrides,
  } as BeadsCoordinatorEpicSnapshot["status"];
}

const BASE_EPIC: BeadsCoordinatorEpicSnapshot = {
  epicId: "EPIC-1",
  epicTitle: "Test Epic",
  issue: null,
  trackerLoadState: "ready",
  trackerLoadDetail: null,
  coordinationSupported: true,
  coordinationUnsupportedReason: null,
  validationState: "valid",
  validationErrors: [],
  trackerState: "in_progress",
  progress: {
    totalIssueCount: 0,
    completedIssueCount: 0,
    readyIssueCount: 0,
    activeIssueCount: 0,
    blockedIssueCount: 0,
    internalBlockedIssueCount: 0,
    externalBlockedIssueCount: 0,
    unknownBlockedIssueCount: 0,
    activeWorkerCount: 0,
    isComplete: false,
  },
  primaryAction: {
    kind: "start_swarm",
    label: "Start",
    busyLabel: "Starting...",
    disabled: false,
  },
  activeRunId: null,
  activeExecutionId: null,
  projectConflict: null,
  swarmSummary: null,
  validation: null,
  status: null,
  runs: [],
  executions: [],
} as BeadsCoordinatorEpicSnapshot;

/** Helper to flatten all nodes from all groups in all sections. */
function allNodes(data: ReturnType<typeof buildWorkGraphData>) {
  return data.sections.flatMap((s) => s.groups.flatMap((g) => g.nodes));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildWorkGraphData", () => {
  it("returns empty sections when status is null", () => {
    const result = buildWorkGraphData({ ...BASE_EPIC, status: null });
    expect(result.sections).toEqual([]);
    expect(result.hasWaveData).toBe(false);
  });

  it("returns empty sections when all status buckets are empty", () => {
    const result = buildWorkGraphData({
      ...BASE_EPIC,
      status: makeStatus({}),
    });
    expect(result.sections).toEqual([]);
    expect(result.hasWaveData).toBe(false);
  });

  it("places issues in an unscheduled section when no runs exist", () => {
    const issueA = makeIssue("A", "Fix auth");
    const issueB = makeIssue("B", "Add types");
    const result = buildWorkGraphData({
      ...BASE_EPIC,
      status: makeStatus({ completed: [issueA], ready: [issueB] }),
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.kind).toBe("unscheduled");
    expect(result.sections[0]!.label).toBe("Not Scheduled");
    // Groups: "Issues" (ready) then "Completed".
    expect(result.sections[0]!.groups).toHaveLength(2);
    expect(result.sections[0]!.groups[0]!.label).toBe("Issues");
    expect(result.sections[0]!.groups[0]!.nodes.map((n) => n.issue.id)).toEqual(["B"]);
    expect(result.sections[0]!.groups[1]!.label).toBe("Completed");
    expect(result.sections[0]!.groups[1]!.nodes.map((n) => n.issue.id)).toEqual(["A"]);
  });

  it("creates wave groups in the active run section from validation.readyFronts", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const issueC = makeIssue("C", "Task C");
    const run = makeRun("run-1", "running");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({ ready: [issueA, issueB, issueC] }),
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Test Epic",
        swarm: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[issueA, issueB], [issueC]],
        maxParallelism: 2,
        estimatedWorkerSessions: 3,
      } as BeadsCoordinatorEpicSnapshot["validation"],
    });

    expect(result.hasWaveData).toBe(true);
    expect(result.maxParallelism).toBe(2);
    expect(result.estimatedWorkerSessions).toBe(3);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.kind).toBe("active");
    expect(result.sections[0]!.groups).toHaveLength(2);
    expect(result.sections[0]!.groups[0]!.label).toBe("Wave 1");
    expect(result.sections[0]!.groups[0]!.nodes.map((n) => n.issue.id)).toEqual(["A", "B"]);
    expect(result.sections[0]!.groups[1]!.label).toBe("Wave 2");
    expect(result.sections[0]!.groups[1]!.nodes.map((n) => n.issue.id)).toEqual(["C"]);
  });

  it("falls back to single Issues group when no wave data", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const run = makeRun("run-1", "running");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({ active: [issueA], ready: [issueB] }),
      validation: null,
    });

    expect(result.hasWaveData).toBe(false);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.groups).toHaveLength(1);
    expect(result.sections[0]!.groups[0]!.label).toBe("Issues");
    expect(result.sections[0]!.groups[0]!.kind).toBe("wave");
    // Active sorts before ready.
    expect(result.sections[0]!.groups[0]!.nodes[0]!.status).toBe("active");
    expect(result.sections[0]!.groups[0]!.nodes[1]!.status).toBe("ready");
  });

  it("scopes executions to their parent run section", () => {
    const issueA = makeIssue("A", "Task A");
    const run1 = makeRun("run-1", "completed", {
      completedAt: "2026-04-08T00:00:10.000Z",
    });
    const run2 = makeRun("run-2", "running", {
      requestedAt: "2026-04-08T00:01:00.000Z",
      startedAt: "2026-04-08T00:01:01.000Z",
      updatedAt: "2026-04-08T00:01:01.000Z",
    });
    const exec1 = makeExecution("exec-1", "A", 1, { runId: "run-1" as never });
    const exec2 = makeExecution("exec-2", "A", 2, {
      runId: "run-2" as never,
      status: "active",
    });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-2" as never,
      runs: [run2, run1],
      executions: [exec1, exec2],
      status: makeStatus({ active: [issueA] }),
    });

    // Should have 2 sections: active run-2 and historical run-1.
    expect(result.sections).toHaveLength(2);

    // Active run-2: issue A with only exec-2.
    const activeSection = result.sections[0]!;
    expect(activeSection.kind).toBe("active");
    const activeNode = activeSection.groups[0]!.nodes.find((n) => n.issue.id === "A")!;
    expect(activeNode.executions).toHaveLength(1);
    expect(activeNode.executions[0]!.executionId).toBe("exec-2");

    // Historical run-1: issue A with only exec-1.
    const histSection = result.sections[1]!;
    expect(histSection.kind).toBe("historical");
    const histNode = histSection.groups[0]!.nodes.find((n) => n.issue.id === "A")!;
    expect(histNode.executions).toHaveLength(1);
    expect(histNode.executions[0]!.executionId).toBe("exec-1");
  });

  it("sets isActiveWorker flag correctly", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const run = makeRun("run-1", "running");
    const exec1 = makeExecution("exec-1", "A", 1, { status: "active" });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      activeExecutionId: "exec-1" as never,
      runs: [run],
      status: makeStatus({ active: [issueA], ready: [issueB] }),
      executions: [exec1],
    });

    const nodes = allNodes(result);
    const nodeA = nodes.find((n) => n.issue.id === "A")!;
    const nodeB = nodes.find((n) => n.issue.id === "B")!;
    expect(nodeA.isActiveWorker).toBe(true);
    expect(nodeB.isActiveWorker).toBe(false);
  });

  it("deduplicates issues appearing in multiple status buckets", () => {
    const issueA = makeIssue("A", "Task A");
    const run = makeRun("run-1", "running");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({
        active: [issueA],
        ready: [issueA], // Duplicate.
      }),
    });

    const nodes = allNodes(result);
    // Should only appear once, with the first status (active).
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.status).toBe("active");
  });

  it("merges unscheduled issues into the last wave group", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const issueC = makeIssue("C", "Task C"); // Not in any wave.
    const run = makeRun("run-1", "running");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({ ready: [issueA, issueB], blocked: [issueC] }),
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Test Epic",
        swarm: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[issueA], [issueB]], // issueC not in any front.
        maxParallelism: null,
        estimatedWorkerSessions: null,
      } as BeadsCoordinatorEpicSnapshot["validation"],
    });

    // Active run section with Wave 1 = [A], Wave 2 = [B, C (merged)].
    expect(result.sections).toHaveLength(1);
    const groups = result.sections[0]!.groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]!.nodes.map((n) => n.issue.id)).toEqual(["A"]);
    // B is ready (priority 1), C is blocked (priority 2).
    expect(groups[1]!.nodes.map((n) => n.issue.id)).toEqual(["B", "C"]);
  });

  it("resolves activeRun and latestRun from runs array", () => {
    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-2" as never,
      runs: [
        makeRun("run-2", "running", {
          requestedAt: "2026-04-08T00:01:00.000Z",
          startedAt: "2026-04-08T00:01:01.000Z",
          updatedAt: "2026-04-08T00:01:01.000Z",
        }),
        makeRun("run-1", "completed", {
          completedAt: "2026-04-08T00:00:10.000Z",
          updatedAt: "2026-04-08T00:00:10.000Z",
        }),
      ],
    } as BeadsCoordinatorEpicSnapshot);

    expect(result.activeRun!.runId).toBe("run-2");
    expect(result.latestRun!.runId).toBe("run-2"); // First in array.
    expect(result.runs).toHaveLength(2);
  });

  it("produces both wave groups and completed group together", () => {
    const done = makeIssue("DONE-1", "Done task");
    const ready = makeIssue("READY-1", "Ready task");
    const run = makeRun("run-1", "running");
    const exec1 = makeExecution("exec-1", "DONE-1", 1);

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      executions: [exec1],
      status: makeStatus({ completed: [done], ready: [ready] }),
      validation: {
        epicId: "EPIC-1",
        epicTitle: "Test Epic",
        swarm: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[ready]],
        maxParallelism: null,
        estimatedWorkerSessions: null,
      } as BeadsCoordinatorEpicSnapshot["validation"],
    });

    // Single active section with Wave 1 and Completed groups.
    expect(result.sections).toHaveLength(1);
    const groups = result.sections[0]!.groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]!.label).toBe("Wave 1");
    expect(groups[0]!.nodes[0]!.issue.id).toBe("READY-1");
    expect(groups[1]!.label).toBe("Completed");
    expect(groups[1]!.nodes[0]!.issue.id).toBe("DONE-1");
  });

  it("creates separate sections for multiple runs", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const run1 = makeRun("run-1", "cancelled", {
      requestedAt: "2026-04-08T00:00:00.000Z",
      cancelledAt: "2026-04-08T00:00:05.000Z",
      updatedAt: "2026-04-08T00:00:05.000Z",
    });
    const run2 = makeRun("run-2", "running", {
      requestedAt: "2026-04-08T00:01:00.000Z",
      startedAt: "2026-04-08T00:01:01.000Z",
      updatedAt: "2026-04-08T00:01:01.000Z",
    });
    const exec1 = makeExecution("exec-1", "A", 1, {
      runId: "run-1" as never,
      status: "cancelled",
    });
    const exec2 = makeExecution("exec-2", "A", 2, {
      runId: "run-2" as never,
      status: "active",
    });
    const exec3 = makeExecution("exec-3", "B", 1, {
      runId: "run-2" as never,
      status: "completed",
    });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-2" as never,
      activeExecutionId: "exec-2" as never,
      runs: [run2, run1],
      executions: [exec1, exec2, exec3],
      status: makeStatus({ completed: [issueB], active: [issueA] }),
    });

    // Active run-2 section, then historical run-1 section.
    expect(result.sections).toHaveLength(2);

    // Active section (run-2): A (active) + B (completed).
    const active = result.sections[0]!;
    expect(active.kind).toBe("active");
    expect(active.run!.runId).toBe("run-2");
    const activeNodes = active.groups.flatMap((g) => g.nodes);
    expect(activeNodes.map((n) => n.issue.id).sort()).toEqual(["A", "B"]);

    // Historical section (run-1): A only (with exec-1).
    const hist = result.sections[1]!;
    expect(hist.kind).toBe("historical");
    expect(hist.run!.runId).toBe("run-1");
    const histNodes = hist.groups.flatMap((g) => g.nodes);
    expect(histNodes).toHaveLength(1);
    expect(histNodes[0]!.issue.id).toBe("A");
    expect(histNodes[0]!.executions[0]!.executionId).toBe("exec-1");
  });

  it("computes summary counts for run sections", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const issueC = makeIssue("C", "Task C");
    const run = makeRun("run-1", "running");
    const execB = makeExecution("exec-b", "B", 1, { status: "failed" });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      executions: [execB],
      status: makeStatus({
        completed: [issueA],
        active: [issueB],
        ready: [issueC],
      }),
    });

    const summary = result.sections[0]!.summary;
    expect(summary.total).toBe(3);
    expect(summary.completed).toBe(1);
    expect(summary.active).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("historical run derives status from execution outcome", () => {
    const issueA = makeIssue("A", "Task A");
    const run1 = makeRun("run-1", "failed", {
      failedAt: "2026-04-08T00:00:05.000Z",
      lastError: "Task failed",
    });
    const run2 = makeRun("run-2", "running", {
      requestedAt: "2026-04-08T00:01:00.000Z",
      startedAt: "2026-04-08T00:01:01.000Z",
      updatedAt: "2026-04-08T00:01:01.000Z",
    });
    const exec1 = makeExecution("exec-1", "A", 1, {
      runId: "run-1" as never,
      status: "failed",
      lastError: "Test failure",
    });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-2" as never,
      runs: [run2, run1],
      executions: [exec1],
      status: makeStatus({ active: [issueA] }),
    });

    // Historical section should show the issue as "blocked" (derived from failed execution).
    const hist = result.sections.find((s) => s.kind === "historical")!;
    const histNode = hist.groups.flatMap((g) => g.nodes).find((n) => n.issue.id === "A")!;
    expect(histNode.status).toBe("blocked");
    expect(histNode.latestExecution!.status).toBe("failed");
  });
});
