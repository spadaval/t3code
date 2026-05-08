import type {
  BeadsIssueDetail,
  BeadsIssueSummary,
  BeadsIssueWorkflowKind,
  ModelSelection,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  ArrowUpRightIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlayIcon,
  WandSparklesIcon,
} from "lucide-react";

import {
  beadsStartBacklogGroomingMutationOptions,
  beadsStartEpicPlannedRefineMutationOptions,
  beadsStartEpicQuickRefineMutationOptions,
  beadsStartWorkflowMutationOptions,
} from "~/lib/beadsReactQuery";
import { describeEpicWorkflowActionCopy } from "~/lib/epicCoordinatorUi";
import { isEpicIssueType } from "~/issuePanel";
import { useEpicSnapshot } from "~/hooks/useEpicSnapshot";
import {
  getEpicCommandInput,
  getEpicWorkflowActionBusyKey,
  useEpicWorkflowActionRunner,
} from "~/hooks/useEpicCoordinatorActionRunner";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";

type WorkflowIssue =
  | Pick<BeadsIssueDetail, "id" | "issueType">
  | Pick<BeadsIssueSummary, "id" | "issueType">;

const WORKFLOW_OPTIONS: { value: BeadsIssueWorkflowKind; label: string; description: string }[] = [
  { value: "solve", label: "Solve", description: "Implement the issue" },
  { value: "refine", label: "Refine", description: "Break down and clarify" },
  { value: "continue", label: "Continue", description: "Resume prior work" },
  { value: "plan-implementation", label: "Plan", description: "Create implementation plan" },
] as const;

function describeWorkflowStartError(workflow: BeadsIssueWorkflowKind): string {
  switch (workflow) {
    case "solve":
      return "Unable to start work";
    case "refine":
      return "Unable to start refinement";
    case "continue":
      return "Unable to continue work";
    case "plan-implementation":
      return "Unable to start planning";
  }
}

function renderOpenThreadLabel(count: number, singularLabel: string): string {
  if (count <= 0) {
    return singularLabel;
  }

  return count === 1 ? singularLabel : `${singularLabel} (${count})`;
}

export function useIssueWorkflowLaunchers(input: {
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const queryClient = useQueryClient();
  const startWorkflowMutation = useMutation(beadsStartWorkflowMutationOptions({ queryClient }));
  const startBacklogGroomingMutation = useMutation(
    beadsStartBacklogGroomingMutationOptions({ queryClient }),
  );
  const startEpicQuickRefineMutation = useMutation(
    beadsStartEpicQuickRefineMutationOptions({ queryClient }),
  );
  const startEpicPlannedRefineMutation = useMutation(
    beadsStartEpicPlannedRefineMutationOptions({ queryClient }),
  );

  const openWorkflowResult = useCallback(
    (result: { readonly threadId: ThreadId; readonly created: boolean }, title: string) => {
      if (!result.created) {
        toastManager.add({
          type: "info",
          title,
          description: "An existing linked thread was reused for this issue.",
        });
      }

      input.onOpenThread(result.threadId);
    },
    [input],
  );

  const startIssueWorkflow = useCallback(
    async (issueId: string, workflow: BeadsIssueWorkflowKind) => {
      try {
        const result = await startWorkflowMutation.mutateAsync({
          cwd: input.cwd,
          projectId: input.projectId,
          issueId,
          workflow,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
        });

        openWorkflowResult(result, "Reused linked thread");
      } catch (error) {
        toastManager.add({
          type: "error",
          title: describeWorkflowStartError(workflow),
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [input, openWorkflowResult, startWorkflowMutation],
  );

  const startBacklogGrooming = useCallback(async () => {
    try {
      const result = await startBacklogGroomingMutation.mutateAsync({
        cwd: input.cwd,
        projectId: input.projectId,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
      });

      input.onOpenThread(result.threadId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to start backlog grooming",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
      });
    }
  }, [input, startBacklogGroomingMutation]);

  const startEpicQuickRefine = useCallback(
    async (epicIssueId: string) => {
      try {
        const result = await startEpicQuickRefineMutation.mutateAsync({
          cwd: input.cwd,
          projectId: input.projectId,
          epicIssueId,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
        });

        openWorkflowResult(result, "Reused linked thread");
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to start quick refine",
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [input, openWorkflowResult, startEpicQuickRefineMutation],
  );

  const startEpicPlannedRefine = useCallback(
    async (epicIssueId: string) => {
      try {
        const result = await startEpicPlannedRefineMutation.mutateAsync({
          cwd: input.cwd,
          projectId: input.projectId,
          epicIssueId,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
        });

        openWorkflowResult(result, "Reused linked thread");
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Unable to start planned refine",
          description: error instanceof Error ? error.message : "An unknown error occurred.",
        });
      }
    },
    [input, openWorkflowResult, startEpicPlannedRefineMutation],
  );

  return {
    startIssueWorkflow,
    startBacklogGrooming,
    startEpicQuickRefine,
    startEpicPlannedRefine,
    startWorkflowMutation,
    startBacklogGroomingMutation,
    startEpicQuickRefineMutation,
    startEpicPlannedRefineMutation,
  };
}

export type IssueWorkflowLaunchers = ReturnType<typeof useIssueWorkflowLaunchers>;

export function IssueWorkflowActions(props: {
  readonly issue: WorkflowIssue;
  readonly cwd: string;
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly linkedThreadCount: number;
  readonly linkedThreadLabel: string;
  readonly launchers: IssueWorkflowLaunchers;
  readonly onOpenLinkedThread: () => void;
  readonly onOpenInTracker: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly showEpicLaunchActions?: boolean;
}) {
  const isEpic = isEpicIssueType(props.issue.issueType);
  const shouldShowEpicLaunchActions = props.showEpicLaunchActions ?? true;
  const shouldLoadEpicActions = isEpic && shouldShowEpicLaunchActions;
  const epicSnapshotQuery = useEpicSnapshot({
    cwd: props.cwd,
    projectId: props.projectId,
    issueId: props.issue.id,
    enabled: shouldLoadEpicActions,
  });
  const epicActionRunner = useEpicWorkflowActionRunner({
    cwd: props.cwd,
    projectId: props.projectId,
    modelSelection: props.modelSelection,
    runtimeMode: props.runtimeMode,
    onOpenThread: props.onOpenThread,
  });

  const epicSnapshot = epicSnapshotQuery.epic;
  const primaryCommand =
    epicSnapshot?.commands.find((command) => !command.disabled) ??
    epicSnapshot?.commands[0] ??
    null;
  const epicWorkflowActionInput = useMemo(() => {
    if (!epicSnapshot) {
      return null;
    }
    return primaryCommand ? getEpicCommandInput(epicSnapshot, primaryCommand) : null;
  }, [epicSnapshot, primaryCommand]);
  const epicWorkflowActionUnavailable = epicSnapshot !== null && epicWorkflowActionInput === null;
  const epicWorkflowBusy =
    epicWorkflowActionInput !== null &&
    epicActionRunner.busyActionKey === getEpicWorkflowActionBusyKey(epicWorkflowActionInput);
  const workflowBusy =
    props.launchers.startWorkflowMutation.isPending &&
    props.launchers.startWorkflowMutation.variables?.issueId === props.issue.id;
  const quickRefineBusy =
    props.launchers.startEpicQuickRefineMutation.isPending &&
    props.launchers.startEpicQuickRefineMutation.variables?.epicIssueId === props.issue.id;
  const plannedRefineBusy =
    props.launchers.startEpicPlannedRefineMutation.isPending &&
    props.launchers.startEpicPlannedRefineMutation.variables?.epicIssueId === props.issue.id;

  const startEpicWorkflowAction = useCallback(() => {
    if (!epicWorkflowActionInput) {
      return;
    }

    void epicActionRunner.runAction(epicWorkflowActionInput);
  }, [epicWorkflowActionInput, epicActionRunner]);

  const retryEpicWorkflowStatus = useCallback(() => {
    void epicActionRunner.runAction({
      kind: "refresh_epic_status",
      epicIssueId: props.issue.id,
    });
  }, [epicActionRunner, props.issue.id]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs" variant="outline" onClick={props.onOpenInTracker}>
        <ExternalLinkIcon className="size-3.5" />
        Open in tracker
      </Button>

      <Button
        size="xs"
        variant="outline"
        disabled={props.linkedThreadCount === 0}
        onClick={props.onOpenLinkedThread}
      >
        <ArrowUpRightIcon className="size-3.5" />
        {renderOpenThreadLabel(props.linkedThreadCount, props.linkedThreadLabel)}
      </Button>

      {isEpic && shouldShowEpicLaunchActions ? (
        <>
          <Button
            size="xs"
            disabled={quickRefineBusy}
            onClick={() => void props.launchers.startEpicQuickRefine(props.issue.id)}
          >
            {quickRefineBusy ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <WandSparklesIcon className="size-3.5" />
            )}
            Quick refine
          </Button>

          <Button
            size="xs"
            variant="outline"
            disabled={plannedRefineBusy}
            onClick={() => void props.launchers.startEpicPlannedRefine(props.issue.id)}
          >
            {plannedRefineBusy ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <WandSparklesIcon className="size-3.5" />
            )}
            Planned refine
          </Button>

          {epicSnapshotQuery.error && !epicSnapshot ? (
            <Button size="xs" variant="outline" onClick={retryEpicWorkflowStatus}>
              <ExternalLinkIcon className="size-3.5" />
              Retry epic status
            </Button>
          ) : primaryCommand && epicWorkflowActionInput ? (
            primaryCommand.disabled && primaryCommand.disabledReason ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex cursor-not-allowed" />}>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled
                    aria-label={primaryCommand.disabledReason}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    {primaryCommand.label}
                  </Button>
                </TooltipTrigger>
                <TooltipPopup side="top" className="max-w-72 whitespace-pre-wrap leading-tight">
                  {primaryCommand.disabledReason}
                </TooltipPopup>
              </Tooltip>
            ) : (
              <Button
                size="xs"
                variant={
                  epicWorkflowActionInput.kind === "refresh_epic_status" ? "outline" : "default"
                }
                disabled={epicWorkflowBusy}
                onClick={startEpicWorkflowAction}
              >
                {epicWorkflowBusy ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <PlayIcon className="size-3.5" />
                )}
                {epicWorkflowBusy
                  ? primaryCommand.busyLabel
                  : describeEpicWorkflowActionCopy({
                      surface: "issues",
                      action: primaryCommand,
                      epic: epicSnapshot ?? { projectConflict: null },
                    }).label}
              </Button>
            )
          ) : epicWorkflowActionUnavailable ? null : (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex cursor-not-allowed" />}>
                <Button size="xs" variant="outline" disabled aria-label="Checking epic status.">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Checking epic...
                </Button>
              </TooltipTrigger>
              <TooltipPopup side="top">Checking epic status.</TooltipPopup>
            </Tooltip>
          )}
        </>
      ) : !isEpic ? (
        <Select
          value=""
          onValueChange={(value) => {
            if (value) {
              void props.launchers.startIssueWorkflow(
                props.issue.id,
                value as BeadsIssueWorkflowKind,
              );
            }
          }}
          disabled={workflowBusy}
        >
          <SelectTrigger size="xs" className="w-auto min-w-[6rem]">
            <span className="flex items-center gap-1.5">
              {workflowBusy ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <PlayIcon className="size-3" />
              )}
              Start work
            </span>
          </SelectTrigger>
          <SelectPopup>
            {WORKFLOW_OPTIONS.map((workflow) => (
              <SelectItem key={workflow.value} value={workflow.value}>
                <span>
                  <span className="font-medium">{workflow.label}</span>
                  <span className="ml-2 text-muted-foreground">{workflow.description}</span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
    </div>
  );
}
