import type {
  BeadsCoordinatorEpicSnapshot,
  BeadsIssueDetail,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  ThreadId,
} from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ClockIcon,
  ExternalLinkIcon,
  HistoryIcon,
  LinkIcon,
  OctagonAlertIcon,
  PlayIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { beadsIssuesBatchOptions } from "~/lib/beadsReactQuery";
import { getDependencyTypeDef } from "~/lib/issueConstants";
import {
  buildWorkGraphData,
  type WorkGraphData,
  type WorkGraphGroup,
  type WorkGraphIssueNode,
  type WorkGraphIssueStatus,
  type WorkGraphRunSection,
} from "~/lib/workGraphData";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Badge } from "../ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatRunStatus(status: OrchestrationSwarmRun["status"]): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "running":
      return "Running";
    case "idle":
      return "Idle";
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "completed":
      return "Completed";
  }
}

function formatExecutionStatus(status: OrchestrationSwarmTaskExecution["status"]): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function runStatusBadgeVariant(
  status: OrchestrationSwarmRun["status"],
): "success" | "error" | "warning" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "error";
    case "blocked":
    case "paused":
      return "warning";
    case "running":
      return "info";
    default:
      return "neutral";
  }
}

function executionStatusBadgeVariant(
  status: OrchestrationSwarmTaskExecution["status"],
): "success" | "error" | "warning" | "info" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "error";
    case "active":
      return "info";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Status icon helper
// ---------------------------------------------------------------------------

function IssueStatusIcon(props: { status: WorkGraphIssueStatus; isActiveWorker: boolean }) {
  switch (props.status) {
    case "completed":
      return <CheckCircle2Icon className="size-3.5 text-success-foreground" />;
    case "active":
      return (
        <PlayIcon
          className={cn("size-3.5 text-info-foreground", props.isActiveWorker && "animate-pulse")}
        />
      );
    case "ready":
      return <CircleDotIcon className="size-3.5 text-muted-foreground" />;
    case "blocked":
      return <OctagonAlertIcon className="size-3.5 text-destructive" />;
  }
}

// ---------------------------------------------------------------------------
// WorkGraph (main export)
// ---------------------------------------------------------------------------

export function WorkGraph(props: {
  cwd: string;
  epic: BeadsCoordinatorEpicSnapshot;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  // Collect all issue IDs from status buckets for batch detail fetch.
  const issueIds = useMemo(() => {
    const status = props.epic.status;
    if (!status) return [];
    const ids = new Set<string>();
    for (const issue of status.completed) ids.add(issue.id);
    for (const issue of status.active) ids.add(issue.id);
    for (const issue of status.ready) ids.add(issue.id);
    for (const issue of status.blocked) ids.add(issue.id);
    return [...ids].toSorted();
  }, [props.epic.status]);

  const batchQuery = useQuery(
    beadsIssuesBatchOptions(issueIds.length > 0 ? { cwd: props.cwd, issueIds } : null),
  );

  // Build a Map<issueId, BeadsIssueDetail> from the batch result.
  const issueDetails = useMemo((): ReadonlyMap<string, BeadsIssueDetail> | undefined => {
    if (!batchQuery.data) return undefined;
    const map = new Map<string, BeadsIssueDetail>();
    for (const issue of batchQuery.data.issues) {
      map.set(issue.id, issue);
    }
    return map;
  }, [batchQuery.data]);

  const data = useMemo(
    () => buildWorkGraphData(props.epic, issueDetails),
    [props.epic, issueDetails],
  );
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());

  const toggleRow = useCallback((issueId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  if (data.sections.length === 0) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Work Graph</h3>
        <WorkGraphGlobalBar data={data} />
        <p className="text-sm text-muted-foreground">No issues tracked yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Work Graph</h3>
      <WorkGraphGlobalBar data={data} />
      <div className="space-y-4">
        {data.sections.map((section) => (
          <WorkGraphRunSectionView
            key={section.run?.runId ?? "__unscheduled"}
            section={section}
            waveCount={data.waveCount}
            onOpenThread={props.onOpenThread}
            expandedRows={expandedRows}
            onToggleRow={toggleRow}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// WorkGraphGlobalBar -- slim top bar with global stats
// ---------------------------------------------------------------------------

function WorkGraphGlobalBar(props: { data: WorkGraphData }) {
  const { runs, maxParallelism, estimatedWorkerSessions } = props.data;

  // Only show stats that aren't already in run section headers.
  const hasStats = maxParallelism !== null || estimatedWorkerSessions !== null || runs.length > 1;
  if (!hasStats) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {maxParallelism !== null ? (
        <span className="text-muted-foreground">Max parallelism: {maxParallelism}</span>
      ) : null}
      {estimatedWorkerSessions !== null ? (
        <span className="text-muted-foreground">Est. workers: {estimatedWorkerSessions}</span>
      ) : null}
      {runs.length > 1 ? (
        <RunHistoryPopover runs={runs} activeRunId={props.data.activeRun?.runId ?? null} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunHistoryPopover
// ---------------------------------------------------------------------------

function RunHistoryPopover(props: {
  runs: readonly OrchestrationSwarmRun[];
  activeRunId: OrchestrationSwarmRun["runId"] | null;
}) {
  const sorted = useMemo(
    () =>
      [...props.runs].toSorted(
        (a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.runId.localeCompare(a.runId),
      ),
    [props.runs],
  );

  return (
    <Popover>
      <PopoverTrigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <HistoryIcon className="size-3" />
        <span>{props.runs.length} runs</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto max-w-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 pr-3 font-medium">Run</th>
                <th className="pb-2 pr-3 font-medium">Mode</th>
                <th className="pb-2 pr-3 font-medium">Started</th>
                <th className="pb-2 pr-3 font-medium">Updated</th>
                <th className="pb-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {sorted.map((run) => (
                <tr key={run.runId}>
                  <td className="py-2 pr-3">
                    <Badge variant={runStatusBadgeVariant(run.status)} size="sm">
                      {formatRunStatus(run.status)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {run.runId === props.activeRunId ? "Active" : "History"}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{run.schedulerMode}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                    {run.startedAt ? formatRelativeTimeLabel(run.startedAt) : "\u2014"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                    {formatRelativeTimeLabel(run.updatedAt)}
                  </td>
                  <td className="max-w-48 truncate py-2 text-destructive">
                    {run.lastError ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// WorkGraphRunSectionView -- a run section with header + groups
// ---------------------------------------------------------------------------

function WorkGraphRunSectionView(props: {
  section: WorkGraphRunSection;
  waveCount: number;
  onOpenThread: (threadId: ThreadId) => void;
  expandedRows: ReadonlySet<string>;
  onToggleRow: (issueId: string) => void;
}) {
  const { section } = props;
  const isHistorical = section.kind === "historical";
  const [collapsed, setCollapsed] = useState(isHistorical);

  return (
    <div>
      {/* Run section header */}
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 border-b py-2 text-left",
          isHistorical ? "border-border/30" : "border-border/50",
        )}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}

        {/* Run status badge */}
        {section.run ? (
          <Badge variant={runStatusBadgeVariant(section.run.status)} size="sm">
            {formatRunStatus(section.run.status)}
          </Badge>
        ) : (
          <Badge variant="neutral" size="sm">
            Pending
          </Badge>
        )}

        {/* Section label */}
        <span
          className={cn(
            "text-xs font-medium",
            isHistorical ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {section.label}
        </span>

        {/* Summary counters */}
        <span className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <span>{section.summary.total} issues</span>
          {section.summary.completed > 0 ? <span>{section.summary.completed} done</span> : null}
          {section.summary.active > 0 ? <span>{section.summary.active} active</span> : null}
          {section.summary.failed > 0 ? (
            <span className="text-destructive/70">{section.summary.failed} failed</span>
          ) : null}
        </span>

        {/* Run timing */}
        {section.run?.startedAt ? (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground/50">
            {formatRelativeTimeLabel(section.run.startedAt)}
          </span>
        ) : null}
      </button>

      {/* Run error (shown below header when expanded) */}
      {section.run?.lastError && !collapsed ? (
        <div className="mt-1.5 rounded border border-destructive/20 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          {section.run.lastError}
        </div>
      ) : null}

      {/* Groups */}
      {!collapsed ? (
        <div className="mt-2 space-y-3">
          {section.groups.map((group) => (
            <WorkGraphGroupView
              key={group.label}
              group={group}
              sectionKind={section.kind}
              waveCount={props.waveCount}
              hasNonCompletedSiblings={section.groups.some((g) => g.kind !== "completed")}
              onOpenThread={props.onOpenThread}
              expandedRows={props.expandedRows}
              onToggleRow={props.onToggleRow}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkGraphGroupView -- a wave/completed group within a run section
// ---------------------------------------------------------------------------

function WorkGraphGroupView(props: {
  group: WorkGraphGroup;
  sectionKind: WorkGraphRunSection["kind"];
  waveCount: number;
  hasNonCompletedSiblings: boolean;
  onOpenThread: (threadId: ThreadId) => void;
  expandedRows: ReadonlySet<string>;
  onToggleRow: (issueId: string) => void;
}) {
  const { group, sectionKind, hasNonCompletedSiblings, waveCount } = props;
  const isCompleted = group.kind === "completed";

  // Auto-collapse completed groups in active sections only when there are
  // non-completed sibling groups (i.e. active work is visible elsewhere).
  const [collapsed, setCollapsed] = useState(
    isCompleted && sectionKind === "active" && hasNonCompletedSiblings,
  );

  return (
    <div>
      {/* Group header */}
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
          isCompleted ? "bg-success/5" : "bg-muted/30",
        )}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        {isCompleted ? <CheckCircle2Icon className="size-3 text-success-foreground" /> : null}
        <span
          className={cn(
            "text-xs font-medium",
            isCompleted ? "text-success-foreground" : "text-muted-foreground",
          )}
        >
          {group.label}
        </span>
        <span className="text-xs text-muted-foreground/50">({group.nodes.length})</span>

        {/* Wave dependency context */}
        {!isCompleted && group.waveIndex !== null && group.waveIndex > 0 ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
            <ArrowRightIcon className="size-2.5" />
            depends on Wave {group.waveIndex.toString()}
          </span>
        ) : null}
        {!isCompleted && group.waveIndex !== null && waveCount > 1 ? (
          <span className="text-[11px] text-muted-foreground/40">
            ({(group.waveIndex + 1).toString()}/{waveCount.toString()})
          </span>
        ) : null}

        {/* Inline status summary for wave groups */}
        {!isCompleted ? <GroupStatusSummary nodes={group.nodes} /> : null}
      </button>

      {/* Issue rows */}
      {!collapsed ? (
        <div className="mt-1 flex flex-col gap-0.5">
          {group.nodes.map((node) => (
            <WorkGraphRow
              key={node.issue.id}
              node={node}
              waveCount={waveCount}
              onOpenThread={props.onOpenThread}
              expanded={props.expandedRows.has(node.issue.id)}
              onToggle={() => props.onToggleRow(node.issue.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Compact inline summary of statuses within a group. */
function GroupStatusSummary(props: { nodes: readonly WorkGraphIssueNode[] }) {
  let active = 0;
  let blocked = 0;
  for (const node of props.nodes) {
    if (node.status === "active" || node.isActiveWorker) active++;
    else if (node.status === "blocked") blocked++;
  }

  if (active === 0 && blocked === 0) return null;

  return (
    <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground/50">
      {active > 0 ? (
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-info" />
          {active} active
        </span>
      ) : null}
      {blocked > 0 ? (
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-destructive" />
          {blocked} blocked
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// WorkGraphRow -- a full-width issue row with inline expansion
// ---------------------------------------------------------------------------

function WorkGraphRow(props: {
  node: WorkGraphIssueNode;
  waveCount: number;
  onOpenThread: (threadId: ThreadId) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { node, expanded } = props;
  const { latestExecution, isActiveWorker } = node;
  const hasFailed =
    latestExecution !== null &&
    (latestExecution.status === "failed" || latestExecution.status === "cancelled");

  return (
    <div
      className={cn(
        "rounded-md border transition-colors",
        isActiveWorker
          ? "border-info/25 bg-info/5"
          : hasFailed
            ? "border-destructive/20 bg-destructive/5"
            : "border-border/40 bg-background",
      )}
    >
      {/* Main row (clickable) */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/30"
        onClick={props.onToggle}
      >
        {/* Status icon */}
        <span className="shrink-0">
          <IssueStatusIcon status={node.status} isActiveWorker={isActiveWorker} />
        </span>

        {/* Issue ID */}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
          {node.issue.id}
        </span>

        {/* Title */}
        <span className="min-w-0 flex-1 text-xs font-medium text-foreground">
          {node.issue.title}
        </span>

        {/* Blocked-by classification badge */}
        {node.blockedBy !== null ? (
          <Badge
            variant={
              node.blockedBy === "external"
                ? "error"
                : node.blockedBy === "unknown"
                  ? "warning"
                  : "neutral"
            }
            size="sm"
          >
            <ShieldAlertIcon className="mr-0.5 size-2.5" />
            {node.blockedBy}
          </Badge>
        ) : null}

        {/* Issue type badge (if not task) */}
        {node.issue.issueType !== "task" ? (
          <Badge variant="neutral" size="sm">
            {node.issue.issueType}
          </Badge>
        ) : null}

        {/* Priority */}
        {node.issue.priority ? (
          <span className="text-[11px] text-muted-foreground">{node.issue.priority}</span>
        ) : null}

        {/* Parent ref */}
        {node.issue.parent ? (
          <span className="max-w-28 truncate text-[11px] text-muted-foreground/60">
            {node.issue.parent.title}
          </span>
        ) : null}

        {/* Execution info */}
        {latestExecution ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Badge variant={executionStatusBadgeVariant(latestExecution.status)} size="sm">
              #{latestExecution.sequenceNumber}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {formatExecutionStatus(latestExecution.status)}
            </span>
            {latestExecution.startedAt ? (
              <span className="text-[11px] tabular-nums text-muted-foreground/50">
                {formatRelativeTimeLabel(latestExecution.startedAt)}
              </span>
            ) : null}
            {latestExecution.workerThreadId ? (
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenThread(latestExecution.workerThreadId!);
                }}
              >
                <ExternalLinkIcon className="size-3" />
              </button>
            ) : null}
          </span>
        ) : null}

        {/* Expand indicator */}
        <span className="shrink-0 text-muted-foreground/40">
          {expanded ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded ? (
        <WorkGraphRowDetail
          node={node}
          waveCount={props.waveCount}
          onOpenThread={props.onOpenThread}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkGraphRowDetail -- inline expansion showing execution history + error
// ---------------------------------------------------------------------------

function WorkGraphRowDetail(props: {
  node: WorkGraphIssueNode;
  waveCount: number;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { node, waveCount } = props;
  const nonParentDeps = node.dependencies.filter(
    (dep) => getDependencyTypeDef(dep.dependencyType).category !== "parent",
  );

  return (
    <div className="space-y-2 border-t border-border/30 px-2.5 py-2">
      {/* Description snippet */}
      {node.descriptionSnippet ? (
        <p className="text-xs text-muted-foreground italic">{node.descriptionSnippet}</p>
      ) : null}

      {/* Compact context row: wave, priority, status */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {node.waveIndex !== null ? (
          <Badge variant="neutral" size="sm">
            Wave {(node.waveIndex + 1).toString()}
            {waveCount > 1 ? ` of ${waveCount.toString()}` : ""}
          </Badge>
        ) : node.status === "completed" ? (
          <Badge variant="success" size="sm">
            Completed
          </Badge>
        ) : null}
        {node.issue.priority ? (
          <Badge variant="neutral" size="sm">
            {node.issue.priority}
          </Badge>
        ) : null}
        {node.issue.issueType !== "task" ? (
          <Badge variant="neutral" size="sm">
            {node.issue.issueType}
          </Badge>
        ) : null}
        {node.blockedBy !== null ? (
          <Badge
            variant={
              node.blockedBy === "external"
                ? "error"
                : node.blockedBy === "unknown"
                  ? "warning"
                  : "neutral"
            }
            size="sm"
          >
            {node.blockedBy === "internal"
              ? "Blocked internally"
              : node.blockedBy === "external"
                ? "Blocked externally"
                : "Blocked (unknown)"}
          </Badge>
        ) : null}
      </div>

      {/* Dependencies (non-parent) */}
      {nonParentDeps.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Dependencies ({nonParentDeps.length.toString()})
          </p>
          <div className="space-y-0.5">
            {nonParentDeps.map((dep) => {
              const depDef = getDependencyTypeDef(dep.dependencyType);
              return (
                <div
                  key={`${dep.dependencyType}-${dep.id}`}
                  className="flex items-center gap-2 rounded border border-border/30 px-2 py-1 text-xs"
                >
                  <LinkIcon className={cn("size-2.5 shrink-0", depDef.colorClass)} />
                  <span className={cn("shrink-0 text-[11px] font-medium", depDef.colorClass)}>
                    {depDef.directionLabel}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
                    {dep.id}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{dep.title}</span>
                  <Badge
                    variant={
                      dep.status === "done"
                        ? "success"
                        : dep.status === "in_progress"
                          ? "info"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {dep.status}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Execution history (compact) */}
      {node.executions.length > 0 ? (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Executions ({node.executions.length.toString()})
          </p>
          <div className="space-y-1">
            {node.executions.map((exec) => (
              <div
                key={exec.executionId}
                className="flex items-center gap-2 rounded border border-border/30 px-2 py-1.5 text-xs"
              >
                <Badge variant={executionStatusBadgeVariant(exec.status)} size="sm">
                  #{exec.sequenceNumber}
                </Badge>
                <span className="text-muted-foreground">{formatExecutionStatus(exec.status)}</span>
                {exec.startedAt ? (
                  <span className="flex items-center gap-1 tabular-nums text-muted-foreground">
                    <ClockIcon className="size-2.5" />
                    {formatRelativeTimeLabel(exec.startedAt)}
                  </span>
                ) : null}
                {exec.lastError ? (
                  <span className="min-w-0 flex-1 truncate text-destructive">{exec.lastError}</span>
                ) : null}
                {exec.workerThreadId ? (
                  <button
                    type="button"
                    className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => props.onOpenThread(exec.workerThreadId!)}
                  >
                    <ExternalLinkIcon className="size-3" />
                    <span>Thread</span>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Latest error (prominent display) */}
      {node.latestExecution?.lastError ? (
        <div className="rounded border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          {node.latestExecution.lastError}
        </div>
      ) : null}
    </div>
  );
}
