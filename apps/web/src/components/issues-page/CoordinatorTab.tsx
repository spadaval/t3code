import type {
  BeadsEpicRunSupport,
  BeadsProjectCoordinatorSnapshot,
  OrchestrationEpicIssueExecution,
  OrchestrationEpicRun,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

import { resolveDefaultModelSelection } from "~/modelSelection";
import {
  buildCoordinatorRunEntries,
  describeCoordinatorActionCopy,
  partitionCoordinatorRunEntries,
  selectCoordinatorRunEntry,
  type CoordinatorRunEntry,
} from "~/lib/epicCoordinatorUi";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useProjectById } from "~/storeSelectors";
import { DEFAULT_RUNTIME_MODE } from "~/types";
import { deriveCoordinatorEventLog } from "~/lib/coordinatorEventLog";
import {
  type CoordinatorActionInput,
  getCoordinatorActionBusyKey,
  getCoordinatorPrimaryActionInput,
  useEpicCoordinatorActionRunner,
} from "~/hooks/useEpicCoordinatorActionRunner";
import { WorkGraph } from "./WorkGraph";
import { CoordinatorEventLogCompact } from "./CoordinatorEventLog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { ErrorDisplay } from "../shared/ErrorDisplay";

type CoordinatorTabProps = {
  cwd: string;
  projectId: ProjectId | null;
  coordinationSupport: BeadsEpicRunSupport | null;
  coordinationSupportPending: boolean;
  coordinationSupportError: Error | null;
  snapshot: BeadsProjectCoordinatorSnapshot | null;
  snapshotPending: boolean;
  snapshotError: Error | null;
  selectedEpicId: string | null;
  selectedRunId: string | null;
  onSelectEpic: (epicId: string | null) => void;
  onSelectRun: (input: { epicId: string; runId: string | null }) => void;
  onOpenEpicIssue: (epicId: string) => void;
  onOpenThread: (threadId: ThreadId) => void;
};

function formatRunStatus(status: OrchestrationEpicRun["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
  }
}

function formatExecutionStatus(status: OrchestrationEpicIssueExecution["status"]): string {
  switch (status) {
    case "launching":
      return "Launching";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
  }
}

function runStatusBadgeVariant(
  status: OrchestrationEpicRun["status"],
): "success" | "error" | "warning" | "info" | "secondary" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "stopped":
      return "warning";
    case "pending":
    case "running":
    case "stopping":
      return "info";
  }
}

function executionStatusBadgeVariant(
  status: OrchestrationEpicIssueExecution["status"],
): "success" | "error" | "warning" | "info" | "secondary" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "stopped":
      return "warning";
    case "launching":
    case "running":
    case "stopping":
      return "info";
  }
}

function buildCoordinatorActions(input: { entry: CoordinatorRunEntry }): CoordinatorActionInput[] {
  const primaryAction = input.entry.epic.primaryAction;
  const defaultAction = getCoordinatorPrimaryActionInput(input.entry.epic);

  switch (primaryAction.kind) {
    case "stop_epic_run":
      return defaultAction ? [defaultAction] : [];
    case "refresh_epic_status":
      return defaultAction ? [defaultAction] : [];
    case "open_coordinator":
      return input.entry.epic.projectConflict && defaultAction ? [defaultAction] : [];
    case "start_epic_run":
      return input.entry.run.status === "failed" || input.entry.run.status === "stopped"
        ? defaultAction
          ? [defaultAction]
          : []
        : [];
    default:
      return [];
  }
}

export function CoordinatorTab(props: CoordinatorTabProps) {
  const project = useProjectById(props.projectId);
  const entries = useMemo(
    () => buildCoordinatorRunEntries(props.snapshot?.epics ?? []),
    [props.snapshot?.epics],
  );
  const sections = useMemo(() => partitionCoordinatorRunEntries(entries), [entries]);
  const selectedEntry = useMemo(
    () =>
      selectCoordinatorRunEntry({
        entries,
        epicId: props.selectedEpicId,
        runId: props.selectedRunId,
      }),
    [entries, props.selectedEpicId, props.selectedRunId],
  );

  const coordinatorActions = useEpicCoordinatorActionRunner({
    cwd: props.cwd,
    projectId: props.projectId,
    modelSelection: project ? resolveDefaultModelSelection(project.defaultModelSelection) : null,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    onOpenThread: props.onOpenThread,
    onOpenCoordinator: props.onSelectRun,
  });

  if (props.coordinationSupportPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (props.coordinationSupportError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorDisplay error={props.coordinationSupportError} variant="minimal" />
      </div>
    );
  }

  if (props.coordinationSupport?.supported === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Coordinator is unavailable for this backend.
        </p>
        {props.coordinationSupport.reason ? (
          <p className="text-xs text-muted-foreground/70">{props.coordinationSupport.reason}</p>
        ) : null}
      </div>
    );
  }

  if (props.snapshotPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (props.snapshotError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <ErrorDisplay error={props.snapshotError} variant="minimal" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">No coordinator output yet.</p>
        <p className="text-xs text-muted-foreground/70">
          Start epic work from the Issues tab to populate run output here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r border-border">
        <ScrollArea>
          <div className="space-y-4 p-3">
            <CoordinatorRunSection
              label="Active"
              entries={sections.active}
              emptyText="No active runs."
              selectedRunId={selectedEntry?.run.runId ?? null}
              onSelectRun={props.onSelectRun}
            />
            <CoordinatorRunSection
              label="Needs Intervention"
              entries={sections.needsIntervention}
              emptyText="Nothing needs intervention."
              selectedRunId={selectedEntry?.run.runId ?? null}
              onSelectRun={props.onSelectRun}
            />
            <CoordinatorRunSection
              label="History"
              entries={sections.history}
              emptyText="No completed or stopped runs."
              selectedRunId={selectedEntry?.run.runId ?? null}
              onSelectRun={props.onSelectRun}
              defaultCollapsed={sections.history.length > 4}
            />
          </div>
        </ScrollArea>
      </div>

      <div className="min-w-0 flex-1">
        {selectedEntry ? (
          <ScrollArea>
            <CoordinatorRunDetail
              cwd={props.cwd}
              entry={selectedEntry}
              busyActionKey={coordinatorActions.busyActionKey}
              onOpenEpicIssue={props.onOpenEpicIssue}
              onOpenThread={props.onOpenThread}
              onRunAction={(action) => void coordinatorActions.runAction(action)}
            />
          </ScrollArea>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a run to inspect output.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CoordinatorRunSection(props: {
  label: string;
  entries: readonly CoordinatorRunEntry[];
  emptyText: string;
  selectedRunId: string | null;
  onSelectRun: (input: { epicId: string; runId: string | null }) => void;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(props.defaultCollapsed ?? false);

  return (
    <section className="space-y-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {props.label}
        </h3>
        <span className="text-xs text-muted-foreground/60">({props.entries.length})</span>
      </button>
      {!collapsed &&
        (props.entries.length > 0 ? (
          <div className="space-y-1">
            {props.entries.map((entry) => (
              <CoordinatorRunRow
                key={entry.key}
                entry={entry}
                selected={entry.run.runId === props.selectedRunId}
                onSelect={() =>
                  props.onSelectRun({
                    epicId: entry.epic.epicId,
                    runId: entry.run.runId,
                  })
                }
              />
            ))}
          </div>
        ) : (
          <p className="pl-5 text-xs text-muted-foreground">{props.emptyText}</p>
        ))}
    </section>
  );
}

function CoordinatorRunRow(props: {
  entry: CoordinatorRunEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
        props.selected ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-muted/40",
      )}
      onClick={props.onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {props.entry.epic.epicTitle}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {props.entry.epic.epicId}
          </div>
        </div>
        <Badge variant={runStatusBadgeVariant(props.entry.run.status)} size="sm">
          {formatRunStatus(props.entry.run.status)}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{formatRelativeTimeLabel(props.entry.run.updatedAt)}</span>
        {props.entry.summary ? (
          <span className="truncate text-right">{props.entry.summary}</span>
        ) : null}
      </div>
      {props.entry.failureMessage ? (
        <div className="truncate text-xs text-destructive">{props.entry.failureMessage}</div>
      ) : null}
    </button>
  );
}

function CoordinatorRunDetail(props: {
  cwd: string;
  entry: CoordinatorRunEntry;
  busyActionKey: string | null;
  onOpenEpicIssue: (epicId: string) => void;
  onOpenThread: (threadId: ThreadId) => void;
  onRunAction: (action: CoordinatorActionInput) => void;
}) {
  const runExecutions = useMemo(
    () =>
      props.entry.epic.executions
        .filter((execution) => execution.runId === props.entry.run.runId)
        .toSorted(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            right.requestedAt.localeCompare(left.requestedAt) ||
            right.sequenceNumber - left.sequenceNumber,
        ),
    [props.entry.epic.executions, props.entry.run.runId],
  );
  const eventLog = useMemo(
    () => deriveCoordinatorEventLog([props.entry.run], runExecutions),
    [props.entry.run, runExecutions],
  );
  const actions = useMemo(() => buildCoordinatorActions({ entry: props.entry }), [props.entry]);

  return (
    <div className="space-y-6 p-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                {props.entry.epic.epicTitle}
              </h2>
              <EpicIssueLink
                epicId={props.entry.epic.epicId}
                onOpenEpicIssue={props.onOpenEpicIssue}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={runStatusBadgeVariant(props.entry.run.status)} size="sm">
                {formatRunStatus(props.entry.run.status)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Requested {formatRelativeTimeLabel(props.entry.run.requestedAt)}
              </span>
              <span className="text-sm text-muted-foreground">
                Updated {formatRelativeTimeLabel(props.entry.run.updatedAt)}
              </span>
            </div>
            {props.entry.summary ? (
              <p className="text-sm text-muted-foreground">{props.entry.summary}</p>
            ) : null}
          </div>
          {actions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {actions.map((action) => {
                const busy = props.busyActionKey === getCoordinatorActionBusyKey(action);
                const copy = describeCoordinatorActionCopy({
                  surface: "coordinator",
                  action:
                    action.kind === "stop_epic_run"
                      ? {
                          kind: "stop_epic_run",
                          label: "Stop run",
                          busyLabel: "Stopping...",
                        }
                      : action.kind === "refresh_epic_status"
                        ? {
                            kind: "refresh_epic_status",
                            label: "Refresh status",
                            busyLabel: "Refreshing...",
                          }
                        : action.kind === "start_epic_run"
                          ? {
                              kind: "start_epic_run",
                              label: "Start epic",
                              busyLabel: "Starting...",
                            }
                          : {
                              kind: "open_coordinator",
                              label: "Open output",
                              busyLabel: "Opening...",
                            },
                  epic: props.entry.epic,
                  selectedRun: props.entry.run,
                });
                return (
                  <Button
                    key={getCoordinatorActionBusyKey(action)}
                    size="sm"
                    variant={
                      action.kind === "refresh_epic_status" || action.kind === "open_coordinator"
                        ? "outline"
                        : action.kind === "stop_epic_run"
                          ? "destructive-outline"
                          : "default"
                    }
                    disabled={busy}
                    onClick={() => props.onRunAction(action)}
                    className="gap-1.5"
                  >
                    {busy ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : action.kind === "stop_epic_run" ? (
                      <XIcon className="size-3.5" />
                    ) : action.kind === "refresh_epic_status" ? (
                      <RefreshCwIcon className="size-3.5" />
                    ) : action.kind === "start_epic_run" ? (
                      <PlayIcon className="size-3.5" />
                    ) : (
                      <ExternalLinkIcon className="size-3.5" />
                    )}
                    {busy ? copy.busyLabel : copy.label}
                  </Button>
                );
              })}
            </div>
          ) : null}
        </div>

        {props.entry.run.failureContext?.message ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            {props.entry.run.failureContext.message}
          </div>
        ) : null}

        {props.entry.epic.trackerLoadDetail &&
        props.entry.epic.primaryAction.kind === "refresh_epic_status" ? (
          <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5 text-sm text-foreground">
            {props.entry.epic.trackerLoadDetail}
          </div>
        ) : null}
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Run Timeline</h3>
        <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-3">
          <CoordinatorEventLogCompact entries={eventLog} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Executions</h3>
        {runExecutions.length > 0 ? (
          <div className="space-y-2">
            {runExecutions.map((execution) => (
              <div
                key={execution.executionId}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      #{execution.sequenceNumber}
                    </span>
                    <span className="text-sm font-medium text-foreground">{execution.issueId}</span>
                    <Badge variant={executionStatusBadgeVariant(execution.status)} size="sm">
                      {formatExecutionStatus(execution.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Updated {formatRelativeTimeLabel(execution.updatedAt)}
                  </div>
                  {execution.failureContext?.message ? (
                    <div className="mt-2 text-sm text-destructive">
                      {execution.failureContext.message}
                    </div>
                  ) : null}
                </div>
                {execution.workerThreadId ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => props.onOpenThread(execution.workerThreadId!)}
                  >
                    Open thread
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No issue executions recorded for this run.
          </p>
        )}
      </section>

      <WorkGraph cwd={props.cwd} epic={props.entry.epic} onOpenThread={props.onOpenThread} />
    </div>
  );
}

function EpicIssueLink(props: { epicId: string; onOpenEpicIssue: (epicId: string) => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center rounded-md border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      onClick={() => props.onOpenEpicIssue(props.epicId)}
      aria-label={`Open epic ${props.epicId} in issues tab`}
    >
      {props.epicId}
    </button>
  );
}
