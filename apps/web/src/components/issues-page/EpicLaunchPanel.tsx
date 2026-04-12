import type { ModelSelection, ProjectId, RuntimeMode, ThreadId } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Loader2Icon, PlayIcon, RefreshCwIcon, WandSparklesIcon } from "lucide-react";

import {
  beadsEpicIssueSummariesOptions,
  beadsEpicTrackerDetailOptions,
  beadsProjectRunSummaryOptions,
} from "~/lib/beadsReactQuery";
import { composeCoordinatorEpicSnapshot } from "~/lib/coordinatorSnapshots";
import { buildEpicExecutionViewData } from "~/lib/epicExecutionView";
import { describeCoordinatorActionCopy, resolveEpicOutputTarget } from "~/lib/epicCoordinatorUi";
import {
  getCoordinatorActionBusyKey,
  getCoordinatorPrimaryActionInput,
  useEpicCoordinatorActionRunner,
} from "~/hooks/useEpicCoordinatorActionRunner";
import type { IssueWorkflowLaunchers } from "../issue/IssueWorkflowActions";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

function badgeVariantForStatus(status: "info" | "success" | "warning" | "error" | "secondary") {
  return status;
}

function describeEpicLaunchState(epic: NonNullable<ReturnType<typeof useEpicSnapshot>["epic"]>) {
  const activeRun = epic.activeRunId
    ? (epic.runs.find((run) => run.runId === epic.activeRunId) ?? null)
    : null;

  if (activeRun?.status === "running" || activeRun?.status === "pending") {
    return {
      label: "Run active",
      summary:
        epic.progress.activeWorkerCount > 0
          ? `${epic.progress.activeWorkerCount} worker${epic.progress.activeWorkerCount === 1 ? "" : "s"} active`
          : `${epic.progress.completedIssueCount}/${epic.progress.totalIssueCount} issues done`,
      variant: badgeVariantForStatus("info"),
    } as const;
  }

  if (activeRun?.status === "stopping") {
    return {
      label: "Stopping",
      summary: "Stop requested for the current run.",
      variant: badgeVariantForStatus("warning"),
    } as const;
  }

  if (epic.trackerLoadState === "error" || epic.trackerLoadState === "timeout") {
    return {
      label: "Needs refresh",
      summary: epic.trackerLoadDetail ?? "Epic tracker status needs refresh.",
      variant: badgeVariantForStatus("warning"),
    } as const;
  }

  if (epic.projectConflict) {
    return {
      label: "Blocked by another run",
      summary: epic.projectConflict.message,
      variant: badgeVariantForStatus("warning"),
    } as const;
  }

  if (epic.validationState === "invalid") {
    return {
      label: "Needs prep",
      summary: epic.validationErrors[0] ?? "This epic needs preparation before it can run.",
      variant: badgeVariantForStatus("warning"),
    } as const;
  }

  if (epic.runs[0]?.status === "failed") {
    return {
      label: "Last run failed",
      summary:
        epic.runs[0].failureContext?.message ?? "Review the last failed run before retrying.",
      variant: badgeVariantForStatus("error"),
    } as const;
  }

  if (epic.trackerState === "completed") {
    return {
      label: "Tracker complete",
      summary: "All currently tracked work is complete.",
      variant: badgeVariantForStatus("success"),
    } as const;
  }

  return {
    label: "Ready",
    summary:
      epic.progress.readyIssueCount > 0
        ? `${epic.progress.readyIssueCount} issue${epic.progress.readyIssueCount === 1 ? "" : "s"} ready to launch`
        : "Tracker is ready for another run.",
    variant: badgeVariantForStatus("success"),
  } as const;
}

function useEpicSnapshot(input: { cwd: string; projectId: ProjectId; issueId: string }) {
  const projectRunSummaryQuery = useQuery(
    beadsProjectRunSummaryOptions({
      cwd: input.cwd,
      projectId: input.projectId,
    }),
  );
  const issueSummariesQuery = useQuery(
    beadsEpicIssueSummariesOptions({
      cwd: input.cwd,
      epicIssueId: input.issueId,
    }),
  );
  const trackerDetailQuery = useQuery(
    beadsEpicTrackerDetailOptions({
      cwd: input.cwd,
      projectId: input.projectId,
      epicIssueId: input.issueId,
    }),
  );
  const epic =
    trackerDetailQuery.data && issueSummariesQuery.data
      ? composeCoordinatorEpicSnapshot({
          epicIssueId: input.issueId,
          projectRunSummary: projectRunSummaryQuery.data ?? null,
          epicIssueSummaries: issueSummariesQuery.data,
          epicTrackerDetail: trackerDetailQuery.data,
        })
      : null;

  return {
    isPending:
      trackerDetailQuery.isPending ||
      issueSummariesQuery.isPending ||
      projectRunSummaryQuery.isPending,
    error: trackerDetailQuery.error ?? issueSummariesQuery.error ?? projectRunSummaryQuery.error,
    epic,
  };
}

function LaunchPreview(props: {
  executionView: ReturnType<typeof buildEpicExecutionViewData>;
  onOpenThread: (threadId: ThreadId) => void;
}) {
  const { activeExecution, predicted } = props.executionView;
  if (activeExecution === null && predicted.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Next Up
      </div>
      {activeExecution ? (
        <PreviewRow
          label="Now"
          title={activeExecution.title}
          issueId={activeExecution.issueId}
          badge={
            <Badge variant="info" size="sm">
              Running
            </Badge>
          }
          action={
            activeExecution.workerThreadId ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => props.onOpenThread(activeExecution.workerThreadId!)}
              >
                Open thread
              </Button>
            ) : null
          }
        />
      ) : null}
      {predicted.slice(0, 3).map((prediction, index) => (
        <PreviewRow
          key={`${prediction.issueId}:${prediction.waveIndex ?? "ready"}`}
          label={
            index === 0
              ? "Next likely"
              : prediction.waveIndex === null || prediction.waveIndex === 0
                ? "Also ready now"
                : `Wave ${(prediction.waveIndex + 1).toString()} advisory`
          }
          title={prediction.title}
          issueId={prediction.issueId}
          badge={
            <Badge variant={index === 0 ? "info" : "secondary"} size="sm">
              {prediction.waveIndex === null || prediction.waveIndex === 0
                ? "Ready"
                : `Wave ${(prediction.waveIndex + 1).toString()}`}
            </Badge>
          }
        />
      ))}
    </div>
  );
}

function PreviewRow(props: {
  label: string;
  title: string;
  issueId: string;
  badge: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {props.label}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{props.title}</span>
          <span className="font-mono text-xs text-muted-foreground">{props.issueId}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {props.badge}
        {props.action}
      </div>
    </div>
  );
}

export function EpicLaunchPanel(props: {
  cwd: string;
  projectId: ProjectId;
  issueId: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  launchers: IssueWorkflowLaunchers;
  onOpenThread: (threadId: ThreadId) => void;
  onOpenOutput: (input: { epicId: string; runId: string | null }) => void;
}) {
  const epicSnapshotQuery = useEpicSnapshot({
    cwd: props.cwd,
    projectId: props.projectId,
    issueId: props.issueId,
  });
  const epicActionRunner = useEpicCoordinatorActionRunner({
    cwd: props.cwd,
    projectId: props.projectId,
    modelSelection: props.modelSelection,
    runtimeMode: props.runtimeMode,
    onOpenThread: props.onOpenThread,
    onOpenCoordinator: props.onOpenOutput,
  });

  if (epicSnapshotQuery.isPending && !epicSnapshotQuery.epic) {
    return (
      <section className="rounded-xl border border-border/60 bg-muted/10 px-4 py-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Checking epic status...
        </div>
      </section>
    );
  }

  if (epicSnapshotQuery.error && !epicSnapshotQuery.epic) {
    return (
      <section className="space-y-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-4">
        <div className="text-sm font-medium text-foreground">Epic status unavailable</div>
        <p className="text-sm text-destructive">{epicSnapshotQuery.error.message}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void epicActionRunner.runAction({
              kind: "refresh_epic_status",
              epicIssueId: props.issueId,
            })
          }
        >
          <RefreshCwIcon className="size-3.5" />
          Refresh status
        </Button>
      </section>
    );
  }

  const epic = epicSnapshotQuery.epic;
  if (!epic) {
    return null;
  }

  const launchState = describeEpicLaunchState(epic);
  const primaryAction = epic.primaryAction;
  const primaryActionInput = getCoordinatorPrimaryActionInput(epic);
  const primaryActionCopy = describeCoordinatorActionCopy({
    surface: "issues",
    action: primaryAction,
    epic,
  });
  const primaryActionBusy =
    primaryActionInput !== null &&
    epicActionRunner.busyActionKey === getCoordinatorActionBusyKey(primaryActionInput);
  const quickRefineBusy =
    props.launchers.startEpicQuickRefineMutation.isPending &&
    props.launchers.startEpicQuickRefineMutation.variables?.epicIssueId === props.issueId;
  const plannedRefineBusy =
    props.launchers.startEpicPlannedRefineMutation.isPending &&
    props.launchers.startEpicPlannedRefineMutation.variables?.epicIssueId === props.issueId;
  const outputTarget = resolveEpicOutputTarget(epic);
  const executionView = buildEpicExecutionViewData(epic);
  const showOutputButton = outputTarget !== null && primaryAction.kind !== "open_coordinator";
  const trackerCounts = [
    `${epic.progress.completedIssueCount}/${epic.progress.totalIssueCount} done`,
    epic.progress.readyIssueCount > 0 ? `${epic.progress.readyIssueCount} ready` : null,
    epic.progress.activeIssueCount > 0 ? `${epic.progress.activeIssueCount} active` : null,
    epic.progress.blockedIssueCount > 0 ? `${epic.progress.blockedIssueCount} blocked` : null,
  ].filter((value): value is string => value !== null);

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-muted/10 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Epic Launch</h3>
            <Badge variant={launchState.variant} size="sm">
              {launchState.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{launchState.summary}</p>
          {trackerCounts.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {trackerCounts.map((count) => (
                <span key={count}>{count}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={quickRefineBusy}
            onClick={() => void props.launchers.startEpicQuickRefine(props.issueId)}
          >
            {quickRefineBusy ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <WandSparklesIcon className="size-3.5" />
            )}
            Quick refine
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={plannedRefineBusy}
            onClick={() => void props.launchers.startEpicPlannedRefine(props.issueId)}
          >
            {plannedRefineBusy ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <WandSparklesIcon className="size-3.5" />
            )}
            Planned refine
          </Button>
          {primaryActionInput ? (
            <Button
              size="sm"
              variant={primaryAction.kind === "refresh_epic_status" ? "outline" : "default"}
              disabled={primaryAction.disabled || primaryActionBusy}
              onClick={() => void epicActionRunner.runAction(primaryActionInput)}
            >
              {primaryActionBusy ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : primaryAction.kind === "refresh_epic_status" ? (
                <RefreshCwIcon className="size-3.5" />
              ) : (
                <PlayIcon className="size-3.5" />
              )}
              {primaryActionBusy ? primaryActionCopy.busyLabel : primaryActionCopy.label}
            </Button>
          ) : null}
          {showOutputButton ? (
            <Button size="sm" variant="outline" onClick={() => props.onOpenOutput(outputTarget)}>
              Open output
            </Button>
          ) : null}
        </div>
      </div>

      {epic.projectConflict ? (
        <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-sm text-foreground">
          {epic.projectConflict.message}
        </div>
      ) : null}

      {epic.validation &&
      (epic.validation.errors.length > 0 || epic.validation.warnings.length > 0) ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 px-3 py-3">
          {epic.validation.errors.map((message) => (
            <p key={message} className="text-sm text-destructive">
              {message}
            </p>
          ))}
          {epic.validation.warnings.map((message) => (
            <p key={message} className="text-sm text-warning-foreground">
              {message}
            </p>
          ))}
        </div>
      ) : null}

      <LaunchPreview executionView={executionView} onOpenThread={props.onOpenThread} />
    </section>
  );
}
