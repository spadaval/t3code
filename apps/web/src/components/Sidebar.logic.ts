import * as React from "react";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import type { OrchestrationEpicIssueExecution, OrchestrationEpicRun } from "@t3tools/contracts";
import {
  getThreadSortTimestamp,
  sortThreads,
  toSortableTimestamp,
  type ThreadSortInput,
} from "../lib/threadSort";
import {
  compareRunsByRecency,
  isActiveRunStatus,
  summarizeExecution,
} from "../lib/epicRunPresentation";
import type { SidebarThreadSummary, Thread } from "../types";
import { cn } from "../lib/utils";
import { deriveRunningSessionStallState, isLatestTurnSettled } from "../session-logic";
import type { ThreadId } from "@t3tools/contracts";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 100;
// Visible sidebar rows are prewarmed into the thread-detail cache so opening a
// nearby thread usually reuses an already-hot subscription.
export const SIDEBAR_THREAD_PREWARM_LIMIT = 10;
export type SidebarNewThreadEnvMode = "local" | "worktree";
type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

export type ThreadTraversalDirection = "previous" | "next";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Stalled"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 6,
  "Awaiting Input": 5,
  Stalled: 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  SidebarThreadSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "updatedAt"
> & {
  lastVisitedAt?: string | undefined;
};

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveSidebarNewThreadSeedContext(input: {
  projectId: string;
  defaultEnvMode: SidebarNewThreadEnvMode;
  activeThread?: {
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
  } | null;
  activeDraftThread?: {
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
    envMode: SidebarNewThreadEnvMode;
  } | null;
}): {
  branch?: string | null;
  worktreePath?: string | null;
  envMode: SidebarNewThreadEnvMode;
} {
  if (input.defaultEnvMode === "worktree") {
    return {
      envMode: "worktree",
    };
  }

  if (input.activeDraftThread?.projectId === input.projectId) {
    return {
      branch: input.activeDraftThread.branch,
      worktreePath: input.activeDraftThread.worktreePath,
      envMode: input.activeDraftThread.envMode,
    };
  }

  if (input.activeThread?.projectId === input.projectId) {
    return {
      branch: input.activeThread.branch,
      worktreePath: input.activeThread.worktreePath,
      envMode: input.activeThread.worktreePath ? "worktree" : "local",
    };
  }

  return {
    envMode: input.defaultEnvMode,
  };
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
}): TItem[] {
  const { getId, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const itemsById = new Map(items.map((item) => [getId(item), item] as const));
  const preferredIdSet = new Set(preferredIds);
  const emittedPreferredIds = new Set<TId>();
  const ordered = preferredIds.flatMap((id) => {
    if (emittedPreferredIds.has(id)) {
      return [];
    }
    const item = itemsById.get(id);
    if (!item) {
      return [];
    }
    emittedPreferredIds.add(id);
    return [item];
  });
  const remaining = items.filter((item) => !preferredIdSet.has(getId(item)));
  return [...ordered, ...remaining];
}

export interface SidebarEpicExecutionRow {
  readonly issueId: string;
  /** Human-readable title of the issue, if available from the beads API. */
  readonly issueTitle: string | null;
  readonly executionId: OrchestrationEpicIssueExecution["executionId"];
  readonly workerThreadId: OrchestrationEpicIssueExecution["workerThreadId"];
  readonly status: OrchestrationEpicIssueExecution["status"];
  readonly summary: string | null;
  readonly isGhost: boolean;
  readonly updatedAt: OrchestrationEpicIssueExecution["updatedAt"];
  /** True when this row comes from the most recent active/failed run for the epic. */
  readonly isCurrentAttempt: boolean;
}

export interface SidebarIssueFirstRunGroup {
  readonly epicIssueId: string;
  readonly epicTitle: string;
  readonly epicIssueStatus: string | null;
  readonly isClosedByIssueStatus: boolean;
  /** Rows from the current run (most recent active/failed), sorted by updatedAt DESC. */
  readonly currentRows: readonly SidebarEpicExecutionRow[];
  /** Rows from previous runs, deduplicated by issueId (latest wins), sorted by updatedAt DESC. */
  readonly previousRows: readonly SidebarEpicExecutionRow[];
  /** previousRows beyond the preview limit — shown via show-more. */
  readonly overflowRows: readonly SidebarEpicExecutionRow[];
  readonly latestRun: OrchestrationEpicRun | null;
  readonly latestExecutionUpdatedAt: string | null;
}

export interface SidebarProjectFeedThreadItem {
  readonly kind: "thread";
  readonly thread: SidebarThreadSummary;
}

export interface SidebarProjectFeedEpicItem {
  readonly kind: "epic";
  readonly group: SidebarIssueFirstRunGroup;
}

export type SidebarProjectFeedItem = SidebarProjectFeedThreadItem | SidebarProjectFeedEpicItem;

export function buildSidebarRunSummaryEpics(input: {
  readonly runs: readonly OrchestrationEpicRun[];
  readonly executions: readonly OrchestrationEpicIssueExecution[];
  readonly epicTitleByIssueId?: ReadonlyMap<string, string>;
  readonly issueTitleByIssueId?: ReadonlyMap<string, string>;
  readonly epicIssueStatusById?: ReadonlyMap<string, string>;
}): Array<{
  epicIssueId: string;
  epicTitle: string;
  epicIssueStatus: string | null;
  runs: readonly OrchestrationEpicRun[];
  executions: readonly OrchestrationEpicIssueExecution[];
  issueTitleByIssueId: ReadonlyMap<string, string>;
}> {
  const runsByEpicIssueId = new Map<string, OrchestrationEpicRun[]>();
  for (const run of input.runs) {
    const existing = runsByEpicIssueId.get(run.epicIssueId);
    if (existing) {
      existing.push(run);
    } else {
      runsByEpicIssueId.set(run.epicIssueId, [run]);
    }
  }

  const executionsByRunId = new Map<
    OrchestrationEpicRun["runId"],
    OrchestrationEpicIssueExecution[]
  >();
  for (const execution of input.executions) {
    const existing = executionsByRunId.get(execution.runId);
    if (existing) {
      existing.push(execution);
    } else {
      executionsByRunId.set(execution.runId, [execution]);
    }
  }

  return [...runsByEpicIssueId.entries()]
    .map(([epicIssueId, runs]) => ({
      epicIssueId,
      epicTitle: input.epicTitleByIssueId?.get(epicIssueId) ?? epicIssueId,
      epicIssueStatus: input.epicIssueStatusById?.get(epicIssueId) ?? null,
      runs: [...runs].toSorted(compareRunsByRecency),
      executions: runs.flatMap((run) => executionsByRunId.get(run.runId) ?? []),
      issueTitleByIssueId: input.issueTitleByIssueId ?? new Map<string, string>(),
    }))
    .toSorted((left, right) => compareRunsByRecency(left.runs[0]!, right.runs[0]!));
}

export function deriveIssueFirstSidebarRunGroups(input: {
  readonly epics: readonly {
    epicIssueId: string;
    epicTitle: string;
    epicIssueStatus: string | null;
    runs: readonly OrchestrationEpicRun[];
    executions: readonly OrchestrationEpicIssueExecution[];
    issueTitleByIssueId?: ReadonlyMap<string, string>;
  }[];
  readonly previewLimit?: number;
}): SidebarIssueFirstRunGroup[] {
  const previewLimit = input.previewLimit ?? 6;

  return input.epics
    .filter((epic) => epic.runs.length > 0)
    .map((epic) => {
      const sortedRuns = [...epic.runs].toSorted(compareRunsByRecency);
      const currentRun =
        sortedRuns.find((run) => isActiveRunStatus(run.status) || run.status === "failed") ??
        sortedRuns[0] ??
        null;
      const previousRuns = sortedRuns.filter((run) => run !== currentRun);

      const toRow = (
        execution: OrchestrationEpicIssueExecution,
        isCurrentAttempt: boolean,
      ): SidebarEpicExecutionRow => ({
        issueId: execution.issueId,
        issueTitle: epic.issueTitleByIssueId?.get(execution.issueId) ?? null,
        executionId: execution.executionId,
        workerThreadId: execution.workerThreadId,
        status: execution.status,
        summary: summarizeExecution(execution),
        isGhost: execution.workerThreadId === null,
        updatedAt: execution.updatedAt,
        isCurrentAttempt,
      });

      // Current rows: all executions from the current run, sorted by updatedAt DESC.
      const currentRows = currentRun
        ? epic.executions
            .filter((e) => e.runId === currentRun.runId)
            .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((e) => toRow(e, true))
        : [];

      // Previous rows: latest execution per issueId across all non-current runs,
      // sorted by updatedAt DESC, capped at previewLimit with overflow.
      const latestByIssueId = new Map<string, OrchestrationEpicIssueExecution>();
      for (const run of previousRuns) {
        for (const execution of epic.executions) {
          if (execution.runId !== run.runId) continue;
          const existing = latestByIssueId.get(execution.issueId);
          if (!existing || execution.updatedAt > existing.updatedAt) {
            latestByIssueId.set(execution.issueId, execution);
          }
        }
      }
      const allPreviousRows = [...latestByIssueId.values()]
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((e) => toRow(e, false));
      const previousRows = allPreviousRows.slice(0, previewLimit);
      const overflowRows = allPreviousRows.slice(previewLimit);
      const latestExecutionUpdatedAt = epic.executions.reduce<string | null>(
        (latest, execution) =>
          latest === null || execution.updatedAt > latest ? execution.updatedAt : latest,
        null,
      );

      return {
        epicIssueId: epic.epicIssueId,
        epicTitle: epic.epicTitle,
        epicIssueStatus: epic.epicIssueStatus,
        isClosedByIssueStatus: epic.epicIssueStatus === "closed",
        currentRows,
        previousRows,
        overflowRows,
        latestRun: sortedRuns[0] ?? null,
        latestExecutionUpdatedAt,
      } satisfies SidebarIssueFirstRunGroup;
    })
    .toSorted((left, right) => {
      const leftLatest = left.latestExecutionUpdatedAt ?? left.latestRun?.updatedAt ?? "";
      const rightLatest = right.latestExecutionUpdatedAt ?? right.latestRun?.updatedAt ?? "";
      return (
        rightLatest.localeCompare(leftLatest) || right.epicIssueId.localeCompare(left.epicIssueId)
      );
    });
}

export function getVisibleRowsForEpicGroup(input: {
  group: SidebarIssueFirstRunGroup;
  activeThreadId?: ThreadId | null | undefined;
  isPreviousRowsExpanded: boolean;
}): {
  currentRows: SidebarEpicExecutionRow[];
  previousRows: SidebarEpicExecutionRow[];
  overflowRows: SidebarEpicExecutionRow[];
} {
  const { group, activeThreadId, isPreviousRowsExpanded } = input;

  const currentRows = [...group.currentRows];

  if (isPreviousRowsExpanded) {
    return {
      currentRows,
      previousRows: [...group.previousRows, ...group.overflowRows],
      overflowRows: [],
    };
  }

  const activeOverflowRow =
    activeThreadId != null
      ? (group.overflowRows.find((row) => row.workerThreadId === activeThreadId) ?? null)
      : null;

  const previousRows = activeOverflowRow
    ? [...group.previousRows, activeOverflowRow]
    : [...group.previousRows];
  const overflowRows = activeOverflowRow
    ? group.overflowRows.filter((row) => row !== activeOverflowRow)
    : [...group.overflowRows];

  return {
    currentRows,
    previousRows,
    overflowRows,
  };
}

export function getEpicGroupExecutionThreadIds(group: SidebarIssueFirstRunGroup): ThreadId[] {
  const threadIds = new Set<ThreadId>();
  for (const row of [...group.currentRows, ...group.previousRows, ...group.overflowRows]) {
    if (row.workerThreadId) {
      threadIds.add(row.workerThreadId);
    }
  }
  return [...threadIds];
}

function getEpicGroupSortTimestamp(input: {
  group: SidebarIssueFirstRunGroup;
  threadSortOrder: SidebarThreadSortOrder;
  threadById: ReadonlyMap<ThreadId, SidebarThreadSummary>;
}): number {
  const threadTimestamps = getEpicGroupExecutionThreadIds(input.group)
    .map((threadId) => input.threadById.get(threadId))
    .flatMap((thread) => (thread ? [getThreadSortTimestamp(thread, input.threadSortOrder)] : []));
  if (threadTimestamps.length > 0) {
    return Math.max(...threadTimestamps);
  }

  if (input.threadSortOrder === "created_at") {
    return toSortableTimestamp(input.group.latestRun?.requestedAt) ?? Number.NEGATIVE_INFINITY;
  }

  return (
    toSortableTimestamp(input.group.latestExecutionUpdatedAt ?? input.group.latestRun?.updatedAt) ??
    Number.NEGATIVE_INFINITY
  );
}

function sidebarProjectFeedItemContainsThread(
  item: SidebarProjectFeedItem,
  activeThreadId: ThreadId | null,
): boolean {
  if (activeThreadId === null) {
    return false;
  }
  return item.kind === "thread"
    ? item.thread.id === activeThreadId
    : getEpicGroupExecutionThreadIds(item.group).includes(activeThreadId);
}

export function getSidebarProjectFeedItemThreadIds(item: SidebarProjectFeedItem): ThreadId[] {
  return item.kind === "thread" ? [item.thread.id] : getEpicGroupExecutionThreadIds(item.group);
}

export function isSidebarEpicGroupExpanded(input: {
  group: SidebarIssueFirstRunGroup;
  epicKey: string;
  epicGroupExpandedById: Readonly<Record<string, boolean>>;
  activeThreadId: ThreadId | null;
}): boolean {
  if (
    input.activeThreadId !== null &&
    getEpicGroupExecutionThreadIds(input.group).includes(input.activeThreadId)
  ) {
    return true;
  }
  return input.epicGroupExpandedById[input.epicKey] ?? !input.group.isClosedByIssueStatus;
}

export function buildSidebarProjectFeed(input: {
  groups: readonly SidebarIssueFirstRunGroup[];
  threads: readonly SidebarThreadSummary[];
  threadSortOrder: SidebarThreadSortOrder;
  threadById: ReadonlyMap<ThreadId, SidebarThreadSummary>;
}): SidebarProjectFeedItem[] {
  const items: SidebarProjectFeedItem[] = [
    ...input.threads.map((thread) => ({ kind: "thread", thread }) as const),
    ...input.groups.map((group) => ({ kind: "epic", group }) as const),
  ];

  return items.toSorted((left, right) => {
    const rightTimestamp =
      right.kind === "thread"
        ? getThreadSortTimestamp(right.thread, input.threadSortOrder)
        : getEpicGroupSortTimestamp({
            group: right.group,
            threadSortOrder: input.threadSortOrder,
            threadById: input.threadById,
          });
    const leftTimestamp =
      left.kind === "thread"
        ? getThreadSortTimestamp(left.thread, input.threadSortOrder)
        : getEpicGroupSortTimestamp({
            group: left.group,
            threadSortOrder: input.threadSortOrder,
            threadById: input.threadById,
          });
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) {
      return byTimestamp;
    }

    if (left.kind !== right.kind) {
      return left.kind === "thread" ? -1 : 1;
    }

    if (left.kind === "thread" && right.kind === "thread") {
      return right.thread.id.localeCompare(left.thread.id);
    }

    if (left.kind === "epic" && right.kind === "epic") {
      if (left.group.latestRun && right.group.latestRun) {
        const byRunRecency = compareRunsByRecency(left.group.latestRun, right.group.latestRun);
        if (byRunRecency !== 0) {
          return byRunRecency;
        }
      }
      return right.group.epicIssueId.localeCompare(left.group.epicIssueId);
    }

    return 0;
  });
}

export function getVisibleSidebarProjectFeed(input: {
  items: readonly SidebarProjectFeedItem[];
  activeThreadId: ThreadId | null;
  projectExpanded: boolean;
  isFeedExpanded: boolean;
  previewLimit: number;
}): {
  activeItem: SidebarProjectFeedItem | null;
  hasOverflowingItems: boolean;
  hiddenItems: SidebarProjectFeedItem[];
  renderedItems: SidebarProjectFeedItem[];
  showEmptyState: boolean;
  shouldShowFeedPanel: boolean;
} {
  const activeItem =
    input.items.find((item) => sidebarProjectFeedItemContainsThread(item, input.activeThreadId)) ??
    null;

  if (!input.projectExpanded) {
    return {
      activeItem,
      hasOverflowingItems: false,
      hiddenItems: activeItem
        ? input.items.filter((item) => item !== activeItem)
        : [...input.items],
      renderedItems: activeItem ? [activeItem] : [],
      showEmptyState: false,
      shouldShowFeedPanel: activeItem !== null,
    };
  }

  const hasOverflowingItems = input.items.length > input.previewLimit;
  const previewItems =
    input.isFeedExpanded || !hasOverflowingItems
      ? [...input.items]
      : input.items.slice(0, input.previewLimit);
  const renderedSet =
    activeItem && !previewItems.includes(activeItem)
      ? new Set<SidebarProjectFeedItem>([...previewItems, activeItem])
      : new Set<SidebarProjectFeedItem>(previewItems);
  const renderedItems = input.items.filter((item) => renderedSet.has(item));
  const hiddenItems = input.items.filter((item) => !renderedSet.has(item));

  return {
    activeItem,
    hasOverflowingItems,
    hiddenItems,
    renderedItems,
    showEmptyState: input.items.length === 0,
    shouldShowFeedPanel: true,
  };
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    shouldShowThreadPanel?: boolean;
    renderedThreadIds: readonly TThreadId[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowThreadPanel === false ? [] : renderedProject.renderedThreadIds,
  );
}

export function getSidebarThreadIdsToPrewarm<TThreadId>(
  visibleThreadIds: readonly TThreadId[],
  limit = SIDEBAR_THREAD_PREWARM_LIMIT,
): TThreadId[] {
  return visibleThreadIds.slice(0, Math.max(0, limit));
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  now?: string | number | Date;
}): ThreadStatusPill | null {
  const { thread } = input;

  if (thread.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (thread.hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  const stalledSession = deriveRunningSessionStallState({
    session: thread.session,
    latestTurn: thread.latestTurn,
    ...(thread.updatedAt ? { activities: [{ createdAt: thread.updatedAt }] } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  if (stalledSession) {
    return {
      label: "Stalled",
      colorClass: "text-rose-600 dark:text-rose-300/90",
      dotClass: "bg-rose-500 dark:bg-rose-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getVisibleThreadsForProject<T extends Pick<Thread, "id">>(input: {
  threads: readonly T[];
  activeThreadId: T["id"] | undefined;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: T[];
  hiddenThreads: T[];
} {
  const { activeThreadId, isThreadListExpanded, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads || isThreadListExpanded) {
    return {
      hasHiddenThreads,
      hiddenThreads: [],
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    hiddenThreads: threads.filter((thread) => !visibleThreadIds.has(thread.id)),
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}
export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly ThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
