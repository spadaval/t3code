import type {
  BeadsCoordinatorLoadState,
  BeadsCoordinatorState,
  BeadsCoordinatorValidationState,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationSummary,
  BeadsEpicCoordinationValidation,
  BeadsIssueRelationSummary,
} from "@t3tools/contracts";

import {
  describeEpicRunCoordinatorFetchFailure,
  isEpicRunCoordinatorFetchTimeoutMessage,
} from "./epicRun.ts";

export interface EpicCoordinationGraphNode {
  readonly issue: BeadsIssueRelationSummary;
  readonly internalDependencyIds: ReadonlyArray<string>;
  readonly externalDependencyIds: ReadonlyArray<string>;
  readonly unknownDependencyIds: ReadonlyArray<string>;
  readonly hasOpenDescendants: boolean;
}

export interface EpicCoordinationGraph {
  readonly epicId: string;
  readonly epicTitle: string;
  readonly nodes: ReadonlyArray<EpicCoordinationGraphNode>;
}

export interface EpicCoordinationLoadStateResult {
  readonly coordinationLoadState: BeadsCoordinatorLoadState;
  readonly coordinationLoadDetail: string | null;
}

export interface EpicCoordinationProgressState {
  readonly totalIssueCount: number;
  readonly completedIssueCount: number;
  readonly readyIssueCount: number;
  readonly activeIssueCount: number;
  readonly blockedIssueCount: number;
  readonly internalBlockedIssueCount: number;
  readonly externalBlockedIssueCount: number;
  readonly unknownBlockedIssueCount: number;
  readonly activeWorkerCount: number;
  readonly isComplete: boolean;
}

export interface EpicCoordinationValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly readyFronts: ReadonlyArray<ReadonlyArray<BeadsIssueRelationSummary>>;
  readonly estimatedWorkerSessions: number;
  readonly maxParallelism: number;
  readonly summary: BeadsEpicCoordinationSummary;
}

function compareIssueRelations(
  left: BeadsIssueRelationSummary,
  right: BeadsIssueRelationSummary,
): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.id.localeCompare(right.id);
}

function buildNodeMap(
  nodes: ReadonlyArray<EpicCoordinationGraphNode>,
): ReadonlyMap<string, EpicCoordinationGraphNode> {
  return new Map(nodes.map((node) => [node.issue.id, node] as const));
}

function countSummary(input: {
  readonly epicId: string;
  readonly epicTitle: string;
  readonly completedIssueCount: number;
  readonly activeIssueCount: number;
  readonly readyIssueCount: number;
  readonly blockedIssueCount: number;
  readonly totalIssueCount: number;
  readonly activeWorkerCount?: number;
}): BeadsEpicCoordinationSummary {
  return {
    epicId: input.epicId,
    epicTitle: input.epicTitle,
    totalIssueCount: input.totalIssueCount,
    completedIssueCount: input.completedIssueCount,
    activeIssueCount: input.activeIssueCount,
    readyIssueCount: input.readyIssueCount,
    blockedIssueCount: input.blockedIssueCount,
    activeWorkerCount: input.activeWorkerCount ?? 0,
  };
}

function findCyclePath(graph: EpicCoordinationGraph): ReadonlyArray<string> | null {
  const nodeMap = buildNodeMap(graph.nodes);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  const visit = (nodeId: string): ReadonlyArray<string> | null => {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      return cycleStart === -1 ? [nodeId] : [...path.slice(cycleStart), nodeId];
    }
    if (visited.has(nodeId)) {
      return null;
    }

    visited.add(nodeId);
    visiting.add(nodeId);
    path.push(nodeId);

    const node = nodeMap.get(nodeId);
    for (const dependencyId of node?.internalDependencyIds ?? []) {
      if (!nodeMap.has(dependencyId)) {
        continue;
      }
      const cycle = visit(dependencyId);
      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    visiting.delete(nodeId);
    return null;
  };

  for (const node of graph.nodes) {
    const cycle = visit(node.issue.id);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

export function buildEpicCoordinationGraph(input: {
  readonly epicId: string;
  readonly epicTitle: string;
  readonly nodes: ReadonlyArray<EpicCoordinationGraphNode>;
}): EpicCoordinationGraph {
  return {
    epicId: input.epicId,
    epicTitle: input.epicTitle,
    nodes: [...input.nodes].toSorted((left, right) =>
      compareIssueRelations(left.issue, right.issue),
    ),
  };
}

export function computeEpicExecutionWaves(
  graph: EpicCoordinationGraph,
): ReadonlyArray<ReadonlyArray<BeadsIssueRelationSummary>> {
  if (graph.nodes.length === 0) {
    return [];
  }

  const nodeMap = buildNodeMap(graph.nodes);
  const indegree = new Map<string, number>();
  const dependentsById = new Map<string, string[]>();

  for (const node of graph.nodes) {
    indegree.set(node.issue.id, 0);
    dependentsById.set(node.issue.id, []);
  }

  for (const node of graph.nodes) {
    for (const dependencyId of node.internalDependencyIds) {
      if (!nodeMap.has(dependencyId)) {
        continue;
      }
      indegree.set(node.issue.id, (indegree.get(node.issue.id) ?? 0) + 1);
      dependentsById.get(dependencyId)?.push(node.issue.id);
    }
  }

  let frontier = graph.nodes
    .filter((node) => (indegree.get(node.issue.id) ?? 0) === 0)
    .map((node) => node.issue)
    .toSorted(compareIssueRelations);
  const waves: BeadsIssueRelationSummary[][] = [];
  const visited = new Set<string>();

  while (frontier.length > 0) {
    waves.push(frontier);
    const nextFrontier: BeadsIssueRelationSummary[] = [];

    for (const issue of frontier) {
      if (visited.has(issue.id)) {
        continue;
      }
      visited.add(issue.id);

      for (const dependentId of dependentsById.get(issue.id) ?? []) {
        const nextIndegree = (indegree.get(dependentId) ?? 0) - 1;
        indegree.set(dependentId, nextIndegree);
        if (nextIndegree === 0) {
          const dependent = nodeMap.get(dependentId);
          if (dependent) {
            nextFrontier.push(dependent.issue);
          }
        }
      }
    }

    frontier = nextFrontier.toSorted(compareIssueRelations);
  }

  return waves;
}

export function deriveEpicCoordinationStatus(
  graph: EpicCoordinationGraph,
): BeadsEpicCoordinationStatus {
  const completed: BeadsIssueRelationSummary[] = [];
  const active: BeadsIssueRelationSummary[] = [];
  const ready: BeadsIssueRelationSummary[] = [];
  const blocked: BeadsIssueRelationSummary[] = [];
  const blockedBreakdown = {
    internal: [] as BeadsIssueRelationSummary[],
    external: [] as BeadsIssueRelationSummary[],
    unknown: [] as BeadsIssueRelationSummary[],
  };

  for (const node of graph.nodes) {
    if (node.issue.status === "closed") {
      completed.push(node.issue);
      continue;
    }

    if (node.issue.status === "in_progress" || node.issue.status === "hooked") {
      active.push(node.issue);
      continue;
    }

    if (
      node.internalDependencyIds.length > 0 ||
      node.externalDependencyIds.length > 0 ||
      node.unknownDependencyIds.length > 0
    ) {
      blocked.push(node.issue);
      if (node.externalDependencyIds.length > 0) {
        blockedBreakdown.external.push(node.issue);
      } else if (node.unknownDependencyIds.length > 0) {
        blockedBreakdown.unknown.push(node.issue);
      } else {
        blockedBreakdown.internal.push(node.issue);
      }
      continue;
    }

    ready.push(node.issue);
  }

  completed.sort(compareIssueRelations);
  active.sort(compareIssueRelations);
  ready.sort(compareIssueRelations);
  blocked.sort(compareIssueRelations);
  blockedBreakdown.internal.sort(compareIssueRelations);
  blockedBreakdown.external.sort(compareIssueRelations);
  blockedBreakdown.unknown.sort(compareIssueRelations);

  return {
    epicId: graph.epicId,
    epicTitle: graph.epicTitle,
    summary: countSummary({
      epicId: graph.epicId,
      epicTitle: graph.epicTitle,
      totalIssueCount: graph.nodes.length,
      completedIssueCount: completed.length,
      activeIssueCount: active.length,
      readyIssueCount: ready.length,
      blockedIssueCount: blocked.length,
    }),
    completed,
    active,
    ready,
    blocked,
    blockedBreakdown,
  };
}

export function validateEpicCoordinationGraph(
  graph: EpicCoordinationGraph,
): EpicCoordinationValidationResult {
  const errors: string[] = [];
  const cyclePath = findCyclePath(graph);
  if (cyclePath) {
    errors.push(`Epic coordination graph contains a dependency cycle: ${cyclePath.join(" -> ")}.`);
  }

  for (const node of graph.nodes) {
    if (node.hasOpenDescendants) {
      errors.push(
        `Direct child ${node.issue.id} has open descendants. Coordination requires the epic to execute only direct child issues.`,
      );
    }

    if (node.unknownDependencyIds.length > 0) {
      errors.push(
        `Blocked child ${node.issue.id} has an open dependency that could not be identified. Fix dependency metadata before starting the epic.`,
      );
    }
  }

  const readyFronts = computeEpicExecutionWaves(graph);
  const summary =
    deriveEpicCoordinationStatus(graph).summary ??
    countSummary({
      epicId: graph.epicId,
      epicTitle: graph.epicTitle,
      totalIssueCount: graph.nodes.length,
      completedIssueCount: 0,
      activeIssueCount: 0,
      readyIssueCount: 0,
      blockedIssueCount: 0,
    });

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    readyFronts,
    estimatedWorkerSessions: graph.nodes.length,
    maxParallelism: readyFronts.reduce((max, front) => Math.max(max, front.length), 0),
    summary,
  };
}

export function isEpicCoordinationComplete(
  summary:
    | Pick<
        BeadsEpicCoordinationSummary,
        | "totalIssueCount"
        | "completedIssueCount"
        | "readyIssueCount"
        | "activeIssueCount"
        | "blockedIssueCount"
      >
    | null
    | undefined,
): boolean {
  return (
    summary !== null &&
    summary !== undefined &&
    summary.totalIssueCount > 0 &&
    summary.completedIssueCount >= summary.totalIssueCount &&
    summary.readyIssueCount === 0 &&
    summary.activeIssueCount === 0 &&
    summary.blockedIssueCount === 0
  );
}

export function deriveEpicCoordinationProgress(input: {
  readonly validation: Pick<BeadsEpicCoordinationValidation, "summary"> | null;
  readonly status:
    | (Pick<BeadsEpicCoordinationStatus, "summary" | "completed" | "ready" | "active" | "blocked"> &
        Partial<Pick<BeadsEpicCoordinationStatus, "blockedBreakdown">>)
    | null;
}): EpicCoordinationProgressState {
  const summary = input.status?.summary ?? input.validation?.summary ?? null;
  const totalIssueCount = summary?.totalIssueCount ?? 0;
  const completedIssueCount = summary?.completedIssueCount ?? input.status?.completed.length ?? 0;
  const readyIssueCount = summary?.readyIssueCount ?? input.status?.ready.length ?? 0;
  const activeIssueCount = summary?.activeIssueCount ?? input.status?.active.length ?? 0;
  const blockedIssueCount = summary?.blockedIssueCount ?? input.status?.blocked.length ?? 0;
  const activeWorkerCount = summary?.activeWorkerCount ?? 0;

  return {
    totalIssueCount,
    completedIssueCount,
    readyIssueCount,
    activeIssueCount,
    blockedIssueCount,
    internalBlockedIssueCount: input.status?.blockedBreakdown?.internal.length ?? 0,
    externalBlockedIssueCount: input.status?.blockedBreakdown?.external.length ?? 0,
    unknownBlockedIssueCount: input.status?.blockedBreakdown?.unknown.length ?? 0,
    activeWorkerCount,
    isComplete: isEpicCoordinationComplete(summary),
  };
}

export function deriveCoordinationLoadState(input: {
  readonly validationError: string | null;
  readonly statusError: string | null;
}): EpicCoordinationLoadStateResult {
  const failures = [
    input.validationError === null
      ? null
      : { source: "validation" as const, message: input.validationError },
    input.statusError === null ? null : { source: "status" as const, message: input.statusError },
  ].filter(
    (
      value,
    ): value is {
      readonly source: "validation" | "status";
      readonly message: string;
    } => value !== null,
  );

  if (failures.length === 0) {
    return {
      coordinationLoadState: "ready",
      coordinationLoadDetail: null,
    };
  }

  return {
    coordinationLoadState: failures.some((failure) =>
      isEpicRunCoordinatorFetchTimeoutMessage(failure.message),
    )
      ? "timeout"
      : "error",
    coordinationLoadDetail: describeEpicRunCoordinatorFetchFailure({
      failures,
      stale: false,
    }),
  };
}

export function deriveCoordinationValidationState(input: {
  readonly coordinationLoadState: BeadsCoordinatorLoadState;
  readonly validation: Pick<BeadsEpicCoordinationValidation, "valid"> | null;
}): BeadsCoordinatorValidationState {
  if (input.coordinationLoadState !== "ready" || input.validation === null) {
    return "unknown";
  }

  return input.validation.valid ? "valid" : "invalid";
}

export function deriveCoordinationState(input: {
  readonly coordinationLoadState: BeadsCoordinatorLoadState;
  readonly status:
    | (Pick<BeadsEpicCoordinationStatus, "active" | "blocked"> &
        Partial<Pick<BeadsEpicCoordinationStatus, "blockedBreakdown">>)
    | null;
  readonly progress: Pick<EpicCoordinationProgressState, "isComplete">;
}): BeadsCoordinatorState {
  if (input.coordinationLoadState !== "ready" || input.status === null) {
    return "unknown";
  }

  if (input.progress.isComplete) {
    return "completed";
  }

  const externalBlockedCount = input.status.blockedBreakdown?.external.length ?? 0;
  const unknownBlockedCount = input.status.blockedBreakdown?.unknown.length ?? 0;
  if (externalBlockedCount > 0 || unknownBlockedCount > 0) {
    return "blocked";
  }

  if (input.status.active.length > 0) {
    return "in_progress";
  }

  return "not_started";
}
