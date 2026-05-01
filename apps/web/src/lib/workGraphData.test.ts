import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueDetail,
  BeadsIssueRelationSummary,
  BeadsEpicCoordinationStatus,
  OrchestrationEpicRun,
  OrchestrationEpicIssueExecution,
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
  overrides?: Record<string, unknown>,
): OrchestrationEpicIssueExecution {
  return {
    executionId: id as never,
    runId: "run-1" as never,
    issueId,
    workerThreadId: null,
    sequenceNumber: seq,
    status: "completed",
    workspaceKey: "shared",
    workspacePath: null,
    failureContext: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    completedAt: "2026-04-08T00:00:10.000Z",
    failedAt: null,
    updatedAt: "2026-04-08T00:00:10.000Z",
    ...overrides,
  } as unknown as OrchestrationEpicIssueExecution;
}

function makeRun(
  id: string,
  status: OrchestrationEpicRun["status"],
  overrides?: Record<string, unknown>,
): OrchestrationEpicRun {
  return {
    runId: id as never,
    projectId: "project-1" as never,
    epicIssueId: "EPIC-1",
    status,
    provider: "codex" as never,
    model: "gpt-5.4",
    modelOptions: null,
    providerOptions: null,
    assistantDeliveryMode: null,
    runtimeMode: "full-access",
    failureContext: null,
    requestedAt: "2026-04-08T00:00:00.000Z",
    startedAt: "2026-04-08T00:00:01.000Z",
    stopRequestedAt: null,
    stoppedAt: null,
    failedAt: null,
    completedAt: null,
    updatedAt: "2026-04-08T00:00:01.000Z",
    ...overrides,
  } as unknown as OrchestrationEpicRun;
}

function makeStatus(
  overrides: Partial<BeadsEpicCoordinationStatus> & {
    completed?: BeadsIssueRelationSummary[];
    active?: BeadsIssueRelationSummary[];
    ready?: BeadsIssueRelationSummary[];
    blocked?: BeadsIssueRelationSummary[];
  },
): BeadsCoordinatorEpicSnapshot["status"] {
  return {
    epicId: "EPIC-1",
    epicTitle: "Test Epic",
    summary: null,
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
  coordinationLoadState: "ready",
  coordinationLoadDetail: null,
  coordinationSupported: true,
  coordinationUnsupportedReason: null,
  validationState: "valid",
  validationErrors: [],
  coordinationState: "in_progress",
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
  execution: {
    state: "ready",
    summary: "Epic is ready to launch.",
    blockingReason: null,
    nextIssue: null,
  },
  commands: [
    {
      kind: "start_epic_run",
      label: "Start",
      busyLabel: "Starting...",
      disabled: false,
      disabledReason: null,
    },
  ],
  activeRunId: null,
  activeExecutionId: null,
  projectConflict: null,
  summary: null,
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
    expect(result.waveCount).toBe(0);
  });

  it("returns empty sections when all status buckets are empty", () => {
    const result = buildWorkGraphData({
      ...BASE_EPIC,
      status: makeStatus({}),
    });
    expect(result.sections).toEqual([]);
    expect(result.hasWaveData).toBe(false);
  });

  it("places issues in a pending section when no runs exist", () => {
    const issueA = makeIssue("A", "Fix auth");
    const issueB = makeIssue("B", "Add types");
    const result = buildWorkGraphData({
      ...BASE_EPIC,
      status: makeStatus({ completed: [issueA], ready: [issueB] }),
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.kind).toBe("unscheduled");
    expect(result.sections[0]!.label).toBe("Pending");
    // Groups: "Completed" first, then "Issues" (ready).
    expect(result.sections[0]!.groups).toHaveLength(2);
    expect(result.sections[0]!.groups[0]!.label).toBe("Completed");
    expect(result.sections[0]!.groups[0]!.nodes.map((n) => n.issue.id)).toEqual(["A"]);
    expect(result.sections[0]!.groups[1]!.label).toBe("Issues");
    expect(result.sections[0]!.groups[1]!.nodes.map((n) => n.issue.id)).toEqual(["B"]);
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
        summary: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[issueA, issueB], [issueC]],
        maxParallelism: 2,
        estimatedWorkerSessions: 3,
      } as BeadsCoordinatorEpicSnapshot["validation"],
    });

    expect(result.hasWaveData).toBe(true);
    expect(result.waveCount).toBe(2);
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

    // Should have 2 sections: chronological order = historical run-1 first, active run-2 last.
    expect(result.sections).toHaveLength(2);

    // Historical run-1 (first -- oldest): issue A with only exec-1.
    const histSection = result.sections[0]!;
    expect(histSection.kind).toBe("historical");
    const histNode = histSection.groups[0]!.nodes.find((n) => n.issue.id === "A")!;
    expect(histNode.executions).toHaveLength(1);
    expect(histNode.executions[0]!.executionId).toBe("exec-1");

    // Active run-2 (last -- most recent): issue A with only exec-2.
    const activeSection = result.sections[1]!;
    expect(activeSection.kind).toBe("active");
    const activeNode = activeSection.groups[0]!.nodes.find((n) => n.issue.id === "A")!;
    expect(activeNode.executions).toHaveLength(1);
    expect(activeNode.executions[0]!.executionId).toBe("exec-2");
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
        summary: null,
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

  it("produces completed group before wave groups", () => {
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
        summary: null,
        valid: true,
        errors: [],
        warnings: [],
        readyFronts: [[ready]],
        maxParallelism: null,
        estimatedWorkerSessions: null,
      } as BeadsCoordinatorEpicSnapshot["validation"],
    });

    // Single active section with Completed first, then Wave 1.
    expect(result.sections).toHaveLength(1);
    const groups = result.sections[0]!.groups;
    expect(groups).toHaveLength(2);
    expect(groups[0]!.label).toBe("Completed");
    expect(groups[0]!.nodes[0]!.issue.id).toBe("DONE-1");
    expect(groups[1]!.label).toBe("Wave 1");
    expect(groups[1]!.nodes[0]!.issue.id).toBe("READY-1");
  });

  it("creates separate sections for multiple runs in chronological order", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const run1 = makeRun("run-1", "stopped", {
      requestedAt: "2026-04-08T00:00:00.000Z",
      stoppedAt: "2026-04-08T00:00:05.000Z",
      updatedAt: "2026-04-08T00:00:05.000Z",
    });
    const run2 = makeRun("run-2", "running", {
      requestedAt: "2026-04-08T00:01:00.000Z",
      startedAt: "2026-04-08T00:01:01.000Z",
      updatedAt: "2026-04-08T00:01:01.000Z",
    });
    const exec1 = makeExecution("exec-1", "A", 1, {
      runId: "run-1" as never,
      status: "stopped",
    });
    const exec2 = makeExecution("exec-2", "A", 2, {
      runId: "run-2" as never,
      status: "running",
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

    // Chronological order: historical run-1 first, then active run-2.
    expect(result.sections).toHaveLength(2);

    // Historical section (run-1, oldest): A only (with exec-1).
    const hist = result.sections[0]!;
    expect(hist.kind).toBe("historical");
    expect(hist.run!.runId).toBe("run-1");
    const histNodes = hist.groups.flatMap((g) => g.nodes);
    expect(histNodes).toHaveLength(1);
    expect(histNodes[0]!.issue.id).toBe("A");
    expect(histNodes[0]!.executions[0]!.executionId).toBe("exec-1");

    // Active section (run-2, most recent): A (active) + B (completed).
    const active = result.sections[1]!;
    expect(active.kind).toBe("active");
    expect(active.run!.runId).toBe("run-2");
    const activeNodes = active.groups.flatMap((g) => g.nodes);
    expect(activeNodes.map((n) => n.issue.id).toSorted()).toEqual(["A", "B"]);
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
      failureContext: {
        kind: "worker_failure",
        message: "Task failed",
        issueId: "A",
        executionId: "exec-1" as never,
        workerThreadId: null,
      },
    });
    const run2 = makeRun("run-2", "running", {
      requestedAt: "2026-04-08T00:01:00.000Z",
      startedAt: "2026-04-08T00:01:01.000Z",
      updatedAt: "2026-04-08T00:01:01.000Z",
    });
    const exec1 = makeExecution("exec-1", "A", 1, {
      runId: "run-1" as never,
      status: "failed",
      failureContext: {
        kind: "worker_failure",
        message: "Test failure",
        issueId: "A",
        executionId: "exec-1" as never,
        workerThreadId: null,
      },
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

  it("stopped run with no active run does not claim unexecuted issues", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const run = makeRun("run-1", "stopped", {
      stoppedAt: "2026-04-08T00:00:05.000Z",
    });
    const exec1 = makeExecution("exec-1", "A", 1, {
      runId: "run-1" as never,
      status: "stopped",
    });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: null,
      runs: [run],
      executions: [exec1],
      status: makeStatus({ ready: [issueA, issueB] }),
    });

    // run-1 should only claim issue A (has execution). Issue B goes to pending.
    // Chronological order: pending first (no run), then historical run-1 last (primary).
    expect(result.sections).toHaveLength(2);

    // Pending section first (no run association).
    const pending = result.sections[0]!;
    expect(pending.kind).toBe("unscheduled");
    expect(pending.label).toBe("Pending");
    const pendingNodes = pending.groups.flatMap((g) => g.nodes);
    expect(pendingNodes).toHaveLength(1);
    expect(pendingNodes[0]!.issue.id).toBe("B");

    // Historical run-1 last (primary run when no active run).
    const hist = result.sections[1]!;
    expect(hist.kind).toBe("historical");
    const histNodes = hist.groups.flatMap((g) => g.nodes);
    expect(histNodes).toHaveLength(1);
    expect(histNodes[0]!.issue.id).toBe("A");
  });

  it("populates blockedBy classification from blocked breakdown", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const run = makeRun("run-1", "running");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({
        blocked: [issueA, issueB],
        blockedBreakdown: {
          internal: [issueA],
          external: [issueB],
          unknown: [],
        },
      }),
    });

    const nodes = allNodes(result);
    const nodeA = nodes.find((n) => n.issue.id === "A")!;
    const nodeB = nodes.find((n) => n.issue.id === "B")!;
    expect(nodeA.blockedBy).toBe("internal");
    expect(nodeB.blockedBy).toBe("external");
  });

  it("enriches nodes with issue details when provided", () => {
    const issueA = makeIssue("A", "Task A");
    const run = makeRun("run-1", "running");
    const detail: BeadsIssueDetail = {
      id: "A",
      title: "Task A",
      description: "First line of description\nSecond line",
      status: "open",
      priority: null,
      issueType: "task",
      assignee: null,
      owner: null,
      parent: null,
      createdAt: "2026-04-08T00:00:00.000Z",
      updatedAt: "2026-04-08T00:00:00.000Z",
      createdBy: null,
      labels: [],
      dependencyRefs: [],
      dependencies: [
        {
          id: "B",
          title: "Task B",
          status: "open",
          priority: null,
          issueType: "task",
          owner: null,
          createdAt: "2026-04-08T00:00:00.000Z",
          createdBy: null,
          updatedAt: "2026-04-08T00:00:00.000Z",
          dependencyType: "blocked_by",
        },
      ],
      comments: [],
    } as unknown as BeadsIssueDetail;

    const issueDetailsMap = new Map<string, BeadsIssueDetail>([["A", detail]]);

    const result = buildWorkGraphData(
      {
        ...BASE_EPIC,
        activeRunId: "run-1" as never,
        runs: [run],
        status: makeStatus({ ready: [issueA] }),
      },
      issueDetailsMap,
    );

    const nodes = allNodes(result);
    expect(nodes[0]!.dependencies).toHaveLength(1);
    expect(nodes[0]!.dependencies[0]!.id).toBe("B");
    expect(nodes[0]!.descriptionSnippet).toBe("First line of description");
  });

  it("nodes have empty dependencies and null snippet without issue details", () => {
    const issueA = makeIssue("A", "Task A");
    const run = makeRun("run-1", "running");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({ ready: [issueA] }),
    });

    const nodes = allNodes(result);
    expect(nodes[0]!.dependencies).toEqual([]);
    expect(nodes[0]!.descriptionSnippet).toBeNull();
  });

  it("populates run lifecycle events on run sections", () => {
    const run = makeRun("run-1", "running", {
      requestedAt: "2026-04-08T00:00:00.000Z",
      startedAt: "2026-04-08T00:00:01.000Z",
    });
    const issueA = makeIssue("A", "Task A");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({ ready: [issueA] }),
    });

    expect(result.sections).toHaveLength(1);
    const section = result.sections[0]!;
    expect(section.events.length).toBeGreaterThanOrEqual(2);
    expect(section.events.some((e) => e.kind === "run.requested")).toBe(true);
    expect(section.events.some((e) => e.kind === "run.started")).toBe(true);
  });

  it("populates empty events on unscheduled sections", () => {
    const issueA = makeIssue("A", "Task A");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      status: makeStatus({ ready: [issueA] }),
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]!.kind).toBe("unscheduled");
    expect(result.sections[0]!.events).toEqual([]);
  });

  it("populates execution lifecycle events on issue nodes", () => {
    const issueA = makeIssue("A", "Task A");
    const run = makeRun("run-1", "running");
    const exec = makeExecution("exec-1", "A", 1, {
      status: "completed",
      requestedAt: "2026-04-08T00:00:00.000Z",
      startedAt: "2026-04-08T00:00:01.000Z",
      completedAt: "2026-04-08T00:00:10.000Z",
    });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      executions: [exec],
      status: makeStatus({ completed: [issueA] }),
    });

    const nodes = allNodes(result);
    const nodeA = nodes.find((n) => n.issue.id === "A")!;
    expect(nodeA.events.length).toBeGreaterThanOrEqual(2);
    expect(nodeA.events.some((e) => e.kind === "execution.requested")).toBe(true);
    expect(nodeA.events.some((e) => e.kind === "execution.completed")).toBe(true);
    // Events should be in chronological order.
    for (let i = 1; i < nodeA.events.length; i++) {
      expect(nodeA.events[i]!.timestamp >= nodeA.events[i - 1]!.timestamp).toBe(true);
    }
  });

  it("nodes without executions have empty events", () => {
    const issueA = makeIssue("A", "Task A");
    const run = makeRun("run-1", "running");

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-1" as never,
      runs: [run],
      status: makeStatus({ ready: [issueA] }),
    });

    const nodes = allNodes(result);
    expect(nodes[0]!.events).toEqual([]);
  });

  it("orders multiple historical runs oldest-first", () => {
    const issueA = makeIssue("A", "Task A");
    const issueB = makeIssue("B", "Task B");
    const run1 = makeRun("run-1", "completed", {
      requestedAt: "2026-04-08T00:00:00.000Z",
      startedAt: "2026-04-08T00:00:01.000Z",
      completedAt: "2026-04-08T00:00:10.000Z",
      updatedAt: "2026-04-08T00:00:10.000Z",
    });
    const run2 = makeRun("run-2", "completed", {
      requestedAt: "2026-04-08T00:01:00.000Z",
      startedAt: "2026-04-08T00:01:01.000Z",
      completedAt: "2026-04-08T00:01:10.000Z",
      updatedAt: "2026-04-08T00:01:10.000Z",
    });
    const run3 = makeRun("run-3", "running", {
      requestedAt: "2026-04-08T00:02:00.000Z",
      startedAt: "2026-04-08T00:02:01.000Z",
      updatedAt: "2026-04-08T00:02:01.000Z",
    });
    const exec1 = makeExecution("exec-1", "A", 1, { runId: "run-1" as never });
    const exec2 = makeExecution("exec-2", "B", 1, { runId: "run-2" as never });

    const result = buildWorkGraphData({
      ...BASE_EPIC,
      activeRunId: "run-3" as never,
      // Server provides newest-first.
      runs: [run3, run2, run1],
      executions: [exec1, exec2],
      status: makeStatus({ completed: [issueA, issueB] }),
    });

    // Chronological: run-1 (oldest), run-2, then run-3 (active, last).
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0]!.run!.runId).toBe("run-1");
    expect(result.sections[0]!.kind).toBe("historical");
    expect(result.sections[1]!.run!.runId).toBe("run-2");
    expect(result.sections[1]!.kind).toBe("historical");
    expect(result.sections[2]!.run!.runId).toBe("run-3");
    expect(result.sections[2]!.kind).toBe("active");
  });
});
