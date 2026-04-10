import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueDependency,
  BeadsIssueDetail,
  BeadsIssueRelationSummary,
  BeadsSwarmStatus,
  BeadsSwarmValidation,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
} from "@t3tools/contracts";

import { type CoordinatorLogEntry, executionEntries, runEntries } from "./coordinatorEventLog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of an issue within the work graph. */
export type WorkGraphIssueStatus = "completed" | "active" | "ready" | "blocked";

/** Classification of a blocked issue's block type. */
export type WorkGraphBlockedBy = "internal" | "external" | "unknown" | null;

/** A single issue node in the work graph, enriched with execution data. */
export type WorkGraphIssueNode = {
  /** The underlying issue summary. */
  readonly issue: BeadsIssueRelationSummary;
  /** Derived status from the swarm status buckets. */
  readonly status: WorkGraphIssueStatus;
  /** Wave index (0-based) from readyFronts, or null for completed/unscheduled issues. */
  readonly waveIndex: number | null;
  /** Executions for this issue **scoped to the parent run section**. Sorted by sequenceNumber descending. */
  readonly executions: readonly OrchestrationSwarmTaskExecution[];
  /** Most recent execution for this issue within the parent run section. */
  readonly latestExecution: OrchestrationSwarmTaskExecution | null;
  /** True if this issue currently has the active execution (is being worked on right now). */
  readonly isActiveWorker: boolean;
  /** Block classification from blocked breakdown (only set when status is "blocked"). */
  readonly blockedBy: WorkGraphBlockedBy;
  /** Dependencies fetched from issue detail (populated when issueDetails are provided). */
  readonly dependencies: readonly BeadsIssueDependency[];
  /** Description snippet from issue detail (populated when issueDetails are provided). */
  readonly descriptionSnippet: string | null;
  /** Lifecycle events for this issue's executions (chronological). */
  readonly events: readonly CoordinatorLogEntry[];
};

/** A group of issues within a run section (wave or status bucket). */
export type WorkGraphGroup = {
  /** Display label ("Completed", "Wave 1", "Issues", etc.). */
  readonly label: string;
  /** Group kind. */
  readonly kind: "completed" | "wave";
  /** 0-based wave index, or null for the "Completed" group or fallback "Issues" group. */
  readonly waveIndex: number | null;
  /** Issue nodes in this group, ordered by status priority then title. */
  readonly nodes: readonly WorkGraphIssueNode[];
};

/** Summary counts for a run section header. */
export type WorkGraphRunSectionSummary = {
  readonly total: number;
  readonly completed: number;
  readonly active: number;
  readonly failed: number;
};

/** A run section in the work graph -- groups all issues associated with a run. */
export type WorkGraphRunSection = {
  /** The run, or null for the "pending" section. */
  readonly run: OrchestrationSwarmRun | null;
  /** Section kind. */
  readonly kind: "active" | "historical" | "unscheduled";
  /** Display label for the section header. */
  readonly label: string;
  /** Wave/status groups within this run section. */
  readonly groups: readonly WorkGraphGroup[];
  /** Summary counts for the section header. */
  readonly summary: WorkGraphRunSectionSummary;
  /** Run lifecycle events (chronological). Empty for the unscheduled section. */
  readonly events: readonly CoordinatorLogEntry[];
};

/** The fully joined data model for the work graph view. */
export type WorkGraphData = {
  /** Run sections in chronological order (oldest historical first, then pending, then active/current). */
  readonly sections: readonly WorkGraphRunSection[];
  /** The currently active run, if any. */
  readonly activeRun: OrchestrationSwarmRun | null;
  /** The most recent run (active or historical). */
  readonly latestRun: OrchestrationSwarmRun | null;
  /** All runs for this epic. */
  readonly runs: readonly OrchestrationSwarmRun[];
  /** True when wave data is available (validation.readyFronts is non-empty). */
  readonly hasWaveData: boolean;
  /** Total number of waves from validation, or 0 if no wave data. */
  readonly waveCount: number;
  /** Max parallelism from validation, if known. */
  readonly maxParallelism: number | null;
  /** Estimated worker sessions from validation, if known. */
  readonly estimatedWorkerSessions: number | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a map from runId to all executions for that run,
 * with executions sorted by sequenceNumber descending within each run.
 */
function buildRunExecutionMap(
  executions: readonly OrchestrationSwarmTaskExecution[],
): Map<string, OrchestrationSwarmTaskExecution[]> {
  const map = new Map<string, OrchestrationSwarmTaskExecution[]>();
  for (const exec of executions) {
    const list = map.get(exec.runId);
    if (list !== undefined) {
      list.push(exec);
    } else {
      map.set(exec.runId, [exec]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  }
  return map;
}

/**
 * Build a map from issueId to all executions for that issue within a specific set of executions,
 * with executions sorted by sequenceNumber descending.
 */
function buildIssueExecutionMap(
  executions: readonly OrchestrationSwarmTaskExecution[],
): Map<string, OrchestrationSwarmTaskExecution[]> {
  const map = new Map<string, OrchestrationSwarmTaskExecution[]>();
  for (const exec of executions) {
    const list = map.get(exec.issueId);
    if (list !== undefined) {
      list.push(exec);
    } else {
      map.set(exec.issueId, [exec]);
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  }
  return map;
}

/**
 * Build a map from issueId to wave index (0-based) using readyFronts.
 */
function buildWaveMap(
  readyFronts: readonly (readonly BeadsIssueRelationSummary[])[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let waveIdx = 0; waveIdx < readyFronts.length; waveIdx++) {
    const front = readyFronts[waveIdx]!;
    for (const issue of front) {
      map.set(issue.id, waveIdx);
    }
  }
  return map;
}

/**
 * Build a set-based lookup for blocked issue classifications from the blocked breakdown.
 */
function buildBlockedByMap(status: BeadsSwarmStatus): Map<string, WorkGraphBlockedBy> {
  const map = new Map<string, WorkGraphBlockedBy>();
  for (const issue of status.blockedBreakdown.internal) {
    map.set(issue.id, "internal");
  }
  for (const issue of status.blockedBreakdown.external) {
    map.set(issue.id, "external");
  }
  for (const issue of status.blockedBreakdown.unknown) {
    map.set(issue.id, "unknown");
  }
  return map;
}

/** Status priority for sorting nodes within a group (lower = first). */
function statusSortPriority(status: WorkGraphIssueStatus): number {
  switch (status) {
    case "active":
      return 0;
    case "ready":
      return 1;
    case "blocked":
      return 2;
    case "completed":
      return 3;
  }
}

function sortNodes(nodes: WorkGraphIssueNode[]): WorkGraphIssueNode[] {
  return nodes.toSorted((a, b) => {
    const sp = statusSortPriority(a.status) - statusSortPriority(b.status);
    if (sp !== 0) return sp;
    return a.issue.title.localeCompare(b.issue.title);
  });
}

/**
 * Collect all unique issues from the status buckets, tagged with their status.
 * Deduplicates by issue id (first occurrence wins).
 */
function collectStatusIssues(
  status: BeadsSwarmStatus,
): Array<{ issue: BeadsIssueRelationSummary; status: WorkGraphIssueStatus }> {
  const seen = new Set<string>();
  const result: Array<{ issue: BeadsIssueRelationSummary; status: WorkGraphIssueStatus }> = [];

  const buckets: Array<{
    issues: readonly BeadsIssueRelationSummary[];
    status: WorkGraphIssueStatus;
  }> = [
    { issues: status.active, status: "active" },
    { issues: status.ready, status: "ready" },
    { issues: status.blocked, status: "blocked" },
    { issues: status.completed, status: "completed" },
  ];

  for (const bucket of buckets) {
    for (const issue of bucket.issues) {
      if (!seen.has(issue.id)) {
        seen.add(issue.id);
        result.push({ issue, status: bucket.status });
      }
    }
  }

  return result;
}

/** Compute summary counts from a flat list of nodes. */
function computeSummary(nodes: readonly WorkGraphIssueNode[]): WorkGraphRunSectionSummary {
  let completed = 0;
  let active = 0;
  let failed = 0;
  for (const node of nodes) {
    if (node.status === "completed") completed++;
    else if (node.status === "active") active++;
    if (
      node.latestExecution !== null &&
      (node.latestExecution.status === "failed" || node.latestExecution.status === "stopped")
    ) {
      failed++;
    }
  }
  return { total: nodes.length, completed, active, failed };
}

/** Build groups from a list of nodes using wave data. Order: completed first, then waves. */
function buildGroups(
  nodes: WorkGraphIssueNode[],
  hasWaveData: boolean,
  waveCount: number,
): WorkGraphGroup[] {
  const groups: WorkGraphGroup[] = [];

  const completedNodes: WorkGraphIssueNode[] = [];
  const waveNodes: WorkGraphIssueNode[][] = Array.from({ length: waveCount }, () => []);
  const unscheduledNodes: WorkGraphIssueNode[] = [];

  for (const node of nodes) {
    if (node.status === "completed") {
      completedNodes.push(node);
    } else if (hasWaveData && node.waveIndex !== null && node.waveIndex < waveCount) {
      waveNodes[node.waveIndex]!.push(node);
    } else {
      unscheduledNodes.push(node);
    }
  }

  // Completed group first (collapsible, out of the way).
  if (completedNodes.length > 0) {
    groups.push({
      label: "Completed",
      kind: "completed",
      waveIndex: null,
      nodes: sortNodes(completedNodes),
    });
  }

  if (hasWaveData) {
    // Wave groups in ascending order (Wave 1 = no deps, Wave 2 = depends on Wave 1, etc.).
    for (let i = 0; i < waveCount; i++) {
      const waveIssues =
        i === waveCount - 1 ? [...waveNodes[i]!, ...unscheduledNodes] : waveNodes[i]!;
      if (waveIssues.length > 0) {
        groups.push({
          label: `Wave ${(i + 1).toString()}`,
          kind: "wave",
          waveIndex: i,
          nodes: sortNodes(waveIssues),
        });
      }
    }
  } else {
    // No wave data: single "Issues" group for non-completed.
    const allNonCompleted = nodes.filter((n) => n.status !== "completed");
    if (allNonCompleted.length > 0) {
      groups.push({
        label: "Issues",
        kind: "wave",
        waveIndex: null,
        nodes: sortNodes(allNonCompleted),
      });
    }
  }

  return groups;
}

function formatRunLabel(run: OrchestrationSwarmRun, isActive: boolean): string {
  const status = run.status.charAt(0).toUpperCase() + run.status.slice(1);
  return isActive ? `Current Run \u00B7 ${status}` : `Run \u00B7 ${status}`;
}

/** Extract a short description snippet from issue detail (first ~120 chars). */
function extractDescriptionSnippet(detail: BeadsIssueDetail | undefined): string | null {
  const desc = detail?.description;
  if (!desc) return null;
  const trimmed = desc.trim();
  if (trimmed.length === 0) return null;
  // Take first line or first 120 chars, whichever is shorter.
  const firstLine = trimmed.split("\n")[0]!;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the unified work graph data model from an epic snapshot.
 *
 * Joins three data sources:
 * - `epic.status` (issue breakdown by status)
 * - `epic.validation` (parallelism wavefronts)
 * - `epic.executions` (execution log, partitioned by run)
 *
 * Optionally enriched with per-issue detail data (dependencies, description).
 *
 * into a run-sectioned, group-based model for vertical rendering.
 */
export function buildWorkGraphData(
  epic: BeadsCoordinatorEpicSnapshot,
  issueDetails?: ReadonlyMap<string, BeadsIssueDetail>,
): WorkGraphData {
  const activeRun = epic.activeRunId
    ? (epic.runs.find((r) => r.runId === epic.activeRunId) ?? null)
    : null;
  const latestRun = epic.runs[0] ?? null;
  const validation: BeadsSwarmValidation | null = epic.validation;
  const status: BeadsSwarmStatus | null = epic.status;
  const executions = epic.executions ?? [];
  const activeExecutionId = epic.activeExecutionId;
  const hasWaveData = validation !== null && validation.readyFronts.length > 0;
  const waveMap = hasWaveData ? buildWaveMap(validation.readyFronts) : new Map<string, number>();
  const waveCount = hasWaveData ? validation.readyFronts.length : 0;
  const blockedByMap =
    status !== null ? buildBlockedByMap(status) : new Map<string, WorkGraphBlockedBy>();

  // If no status data at all, return empty graph.
  if (status === null) {
    return {
      sections: [],
      activeRun,
      latestRun,
      runs: epic.runs,
      hasWaveData: false,
      waveCount: 0,
      maxParallelism: null,
      estimatedWorkerSessions: null,
    };
  }

  // Collect all issues with their status from tracker.
  const taggedIssues = collectStatusIssues(status);
  const issueMap = new Map(
    taggedIssues.map(({ issue, status: s }) => [issue.id, { issue, status: s }]),
  );

  // Group executions by runId.
  const runExecutionMap = buildRunExecutionMap(executions);

  // Track which issues have been claimed by at least one run section.
  const issuesClaimedByRun = new Set<string>();

  // Determine the "primary" run: the active run, or the latest run if no active run.
  const primaryRun = activeRun ?? latestRun;

  /** Enrich a node with issue detail data (dependencies, description snippet) and lifecycle events. */
  function enrichNode(
    issueId: string,
    base: Omit<WorkGraphIssueNode, "dependencies" | "descriptionSnippet" | "events">,
  ): WorkGraphIssueNode {
    const detail = issueDetails?.get(issueId);
    // Derive lifecycle events from this node's executions.
    const events: CoordinatorLogEntry[] = [];
    for (const exec of base.executions) {
      events.push(...executionEntries(exec));
    }
    events.sort((a, b) => {
      const tsDelta = a.timestamp.localeCompare(b.timestamp);
      if (tsDelta !== 0) return tsDelta;
      return a.key.localeCompare(b.key);
    });
    return {
      ...base,
      dependencies: detail?.dependencies ?? [],
      descriptionSnippet: extractDescriptionSnippet(detail),
      events,
    };
  }

  // Build sections in chronological order: historical (oldest first) -> pending -> active.
  const sections: WorkGraphRunSection[] = [];

  // --- 1. Historical run sections (oldest first) ---
  // epic.runs is newest-first from server; reverse non-primary runs for chronological order.
  const historicalRuns = epic.runs.filter((r) => r.runId !== primaryRun?.runId).toReversed();
  for (const run of historicalRuns) {
    const runExecs = runExecutionMap.get(run.runId) ?? [];
    if (runExecs.length === 0) continue; // Skip runs with no executions.
    const runIssueExecMap = buildIssueExecutionMap(runExecs);

    const histNodes: WorkGraphIssueNode[] = [];
    for (const [issueId, issueExecs] of runIssueExecMap) {
      issuesClaimedByRun.add(issueId);
      const tagged = issueMap.get(issueId);
      const issue = tagged?.issue;
      if (!issue) continue;

      // For historical runs, derive status from the execution outcome rather than
      // the current tracker status (which reflects the latest state, not this run's era).
      const latestExec = issueExecs[0]!;
      let histStatus: WorkGraphIssueStatus;
      if (latestExec.status === "completed") histStatus = "completed";
      else if (latestExec.status === "running" || latestExec.status === "launching")
        histStatus = "active";
      else if (latestExec.status === "failed" || latestExec.status === "stopped")
        histStatus = "blocked";
      else histStatus = "ready";

      histNodes.push(
        enrichNode(issueId, {
          issue,
          status: histStatus,
          waveIndex: null, // No wave data for historical runs.
          executions: issueExecs,
          latestExecution: latestExec,
          isActiveWorker: false,
          blockedBy: null,
        }),
      );
    }

    if (histNodes.length > 0) {
      // Historical runs don't use wave data -- just group by completion.
      const groups = buildGroups(histNodes, false, 0);
      sections.push({
        run,
        kind: "historical",
        label: formatRunLabel(run, false),
        groups,
        summary: computeSummary(histNodes),
        events: runEntries(run),
      });
    }
  }

  // --- 2. Active/primary run section ---
  // Built after historical so we know which issues have already been claimed,
  // but will be appended after the pending section below.
  let primarySection: WorkGraphRunSection | null = null;
  if (primaryRun !== null) {
    const runExecs = runExecutionMap.get(primaryRun.runId) ?? [];
    const runIssueExecMap = buildIssueExecutionMap(runExecs);
    const isPrimaryActive = primaryRun === activeRun;

    // Issues in the primary run: those with executions in this run,
    // plus (if active) all remaining issues from status buckets.
    const primaryNodes: WorkGraphIssueNode[] = [];
    const seenInPrimary = new Set<string>();

    // First, add all issues that have executions in this run.
    for (const [issueId, issueExecs] of runIssueExecMap) {
      seenInPrimary.add(issueId);
      issuesClaimedByRun.add(issueId);
      const tagged = issueMap.get(issueId);
      const issueStatus = tagged?.status ?? "completed";
      const issue = tagged?.issue ?? issueExecs[0]!.issueId;
      // If we don't have the issue object from status buckets, skip it
      // (shouldn't happen in practice, but be safe).
      if (typeof issue === "string") continue;
      primaryNodes.push(
        enrichNode(issueId, {
          issue,
          status: issueStatus,
          waveIndex: issueStatus === "completed" ? null : (waveMap.get(issueId) ?? null),
          executions: issueExecs,
          latestExecution: issueExecs[0] ?? null,
          isActiveWorker:
            activeExecutionId !== null &&
            issueExecs.some((e) => e.executionId === activeExecutionId),
          blockedBy: issueStatus === "blocked" ? (blockedByMap.get(issueId) ?? null) : null,
        }),
      );
    }

    // Only the active run claims all remaining issues from the status buckets.
    // A cancelled/completed/historical run should NOT claim issues it never executed.
    if (isPrimaryActive) {
      for (const { issue, status: issueStatus } of taggedIssues) {
        if (seenInPrimary.has(issue.id)) continue;
        seenInPrimary.add(issue.id);
        issuesClaimedByRun.add(issue.id);
        primaryNodes.push(
          enrichNode(issue.id, {
            issue,
            status: issueStatus,
            waveIndex: issueStatus === "completed" ? null : (waveMap.get(issue.id) ?? null),
            executions: [],
            latestExecution: null,
            isActiveWorker: false,
            blockedBy: issueStatus === "blocked" ? (blockedByMap.get(issue.id) ?? null) : null,
          }),
        );
      }
    }

    if (primaryNodes.length > 0) {
      const groups = buildGroups(primaryNodes, hasWaveData, waveCount);
      primarySection = {
        run: primaryRun,
        kind: isPrimaryActive ? "active" : "historical",
        label: formatRunLabel(primaryRun, isPrimaryActive),
        groups,
        summary: computeSummary(primaryNodes),
        events: runEntries(primaryRun),
      };
    }
  }

  // --- 3. Pending section: issues not claimed by any run ---
  const pendingNodes: WorkGraphIssueNode[] = [];
  for (const { issue, status: issueStatus } of taggedIssues) {
    if (issuesClaimedByRun.has(issue.id)) continue;
    pendingNodes.push(
      enrichNode(issue.id, {
        issue,
        status: issueStatus,
        waveIndex: issueStatus === "completed" ? null : (waveMap.get(issue.id) ?? null),
        executions: [],
        latestExecution: null,
        isActiveWorker: false,
        blockedBy: issueStatus === "blocked" ? (blockedByMap.get(issue.id) ?? null) : null,
      }),
    );
  }

  if (pendingNodes.length > 0) {
    const groups = buildGroups(pendingNodes, hasWaveData, waveCount);
    sections.push({
      run: null,
      kind: "unscheduled",
      label: "Pending",
      groups,
      summary: computeSummary(pendingNodes),
      events: [],
    });
  }

  // --- 4. Append the primary/active run section last (most recent) ---
  if (primarySection !== null) {
    sections.push(primarySection);
  }

  return {
    sections,
    activeRun,
    latestRun,
    runs: epic.runs,
    hasWaveData,
    waveCount,
    maxParallelism: validation?.maxParallelism ?? null,
    estimatedWorkerSessions: validation?.estimatedWorkerSessions ?? null,
  };
}
