import type {
  BeadsEpicWorkflowSnapshot,
  BeadsEpicCommand,
  OrchestrationEpicRun,
} from "@t3tools/contracts";

import {
  compareRunsByRecency,
  getActiveRun,
  getLatestRun,
  summarizeRun,
} from "./epicRunPresentation";

export type EpicWorkflowRunSection = "active" | "needsIntervention" | "history";

export interface EpicWorkflowOutputTarget {
  readonly epicId: string;
  readonly runId: OrchestrationEpicRun["runId"] | null;
}

export interface EpicWorkflowActionCopy {
  readonly label: string;
  readonly busyLabel: string;
}

export interface EpicWorkflowRunEntry {
  readonly key: string;
  readonly section: EpicWorkflowRunSection;
  readonly epic: BeadsEpicWorkflowSnapshot;
  readonly run: OrchestrationEpicRun;
  readonly summary: string | null;
  readonly failureMessage: string | null;
}

export function getLatestEpicRun(epic: BeadsEpicWorkflowSnapshot): OrchestrationEpicRun | null {
  return getLatestRun(epic.runs);
}

export function getActiveEpicRun(epic: BeadsEpicWorkflowSnapshot): OrchestrationEpicRun | null {
  return getActiveRun({
    runs: epic.runs,
    activeRunId: epic.activeRunId,
  });
}

export function resolveEpicOutputTarget(
  epic: BeadsEpicWorkflowSnapshot,
): EpicWorkflowOutputTarget | null {
  const targetRun = getActiveEpicRun(epic) ?? getLatestEpicRun(epic);
  if (!targetRun) {
    return null;
  }

  return {
    epicId: epic.epicId,
    runId: targetRun.runId,
  };
}

export function resolvePrimaryActionOutputTarget(
  epic: BeadsEpicWorkflowSnapshot,
): EpicWorkflowOutputTarget | null {
  if (epic.projectConflict) {
    return {
      epicId: epic.projectConflict.run.epicIssueId,
      runId: epic.projectConflict.run.runId,
    };
  }

  return resolveEpicOutputTarget(epic);
}

export function canStartEpicRunDirectly(
  epic: Pick<
    BeadsEpicWorkflowSnapshot,
    | "activeRunId"
    | "coordinationLoadState"
    | "coordinationState"
    | "progress"
    | "projectConflict"
    | "status"
    | "validationState"
  >,
): boolean {
  return (
    epic.coordinationLoadState === "ready" &&
    epic.validationState === "valid" &&
    epic.coordinationState !== "completed" &&
    epic.projectConflict === null &&
    epic.activeRunId === null &&
    epic.progress.readyIssueCount > 0
  );
}

export function buildEpicWorkflowRunEntries(
  epics: readonly BeadsEpicWorkflowSnapshot[],
): EpicWorkflowRunEntry[] {
  const active: EpicWorkflowRunEntry[] = [];
  const needsIntervention: EpicWorkflowRunEntry[] = [];
  const history: EpicWorkflowRunEntry[] = [];

  for (const epic of epics) {
    if (epic.runs.length === 0) {
      continue;
    }

    const latestRun = getLatestEpicRun(epic);

    for (const run of epic.runs) {
      if (run.status === "pending" || run.status === "running" || run.status === "stopping") {
        active.push({
          key: `${epic.epicId}:${run.runId}`,
          section: "active",
          epic,
          run,
          summary: summarizeRun({ run, progress: epic.progress }),
          failureMessage: run.failureContext?.message ?? null,
        });
        continue;
      }

      if (run.status === "failed") {
        if (latestRun?.runId === run.runId) {
          needsIntervention.push({
            key: `${epic.epicId}:${run.runId}`,
            section: "needsIntervention",
            epic,
            run,
            summary: summarizeRun({ run, progress: epic.progress }),
            failureMessage: run.failureContext?.message ?? null,
          });
        }
        continue;
      }

      history.push({
        key: `${epic.epicId}:${run.runId}`,
        section: "history",
        epic,
        run,
        summary: summarizeRun({ run, progress: epic.progress }),
        failureMessage: run.failureContext?.message ?? null,
      });
    }
  }

  active.sort((left, right) => compareRunsByRecency(left.run, right.run));
  needsIntervention.sort((left, right) => compareRunsByRecency(left.run, right.run));
  history.sort((left, right) => compareRunsByRecency(left.run, right.run));

  return [...active, ...needsIntervention, ...history];
}

export function partitionEpicWorkflowRunEntries(entries: readonly EpicWorkflowRunEntry[]): {
  readonly active: readonly EpicWorkflowRunEntry[];
  readonly needsIntervention: readonly EpicWorkflowRunEntry[];
  readonly history: readonly EpicWorkflowRunEntry[];
} {
  return {
    active: entries.filter((entry) => entry.section === "active"),
    needsIntervention: entries.filter((entry) => entry.section === "needsIntervention"),
    history: entries.filter((entry) => entry.section === "history"),
  };
}

function pickPreferredEpicRun(
  entries: readonly EpicWorkflowRunEntry[],
): EpicWorkflowRunEntry | null {
  const active = entries.find((entry) => entry.section === "active");
  if (active) {
    return active;
  }

  const failed = entries.find((entry) => entry.section === "needsIntervention");
  if (failed) {
    return failed;
  }

  return entries[0] ?? null;
}

export function selectEpicWorkflowRunEntry(input: {
  readonly entries: readonly EpicWorkflowRunEntry[];
  readonly runId?: string | null;
  readonly epicId?: string | null;
}): EpicWorkflowRunEntry | null {
  if (input.runId) {
    const exactRun = input.entries.find((entry) => entry.run.runId === input.runId);
    if (exactRun) {
      return exactRun;
    }
  }

  if (input.epicId) {
    const epicEntries = input.entries.filter((entry) => entry.epic.epicId === input.epicId);
    const preferredEpicRun = pickPreferredEpicRun(epicEntries);
    if (preferredEpicRun) {
      return preferredEpicRun;
    }
  }

  return pickPreferredEpicRun(input.entries);
}

type CommandLike = Pick<BeadsEpicCommand, "kind" | "label" | "busyLabel">;

export function describeEpicWorkflowActionCopy(input: {
  readonly surface: "issues" | "coordinator";
  readonly action: CommandLike;
  readonly epic: Pick<BeadsEpicWorkflowSnapshot, "projectConflict">;
  readonly selectedRun?: Pick<OrchestrationEpicRun, "status"> | null;
}): EpicWorkflowActionCopy {
  switch (input.action.kind) {
    case "open_coordination_prep_thread":
      return {
        label: "Open prep thread",
        busyLabel: "Opening...",
      };
    case "refresh_epic_status":
      return {
        label: "Refresh status",
        busyLabel: "Refreshing...",
      };
    case "start_epic_run":
      if (
        input.surface === "coordinator" &&
        (input.selectedRun?.status === "failed" || input.selectedRun?.status === "stopped")
      ) {
        return {
          label: "Retry run",
          busyLabel: "Retrying...",
        };
      }
      return {
        label: "Start epic",
        busyLabel: "Starting...",
      };
    case "stop_epic_run":
      return {
        label: "Stop run",
        busyLabel: "Stopping...",
      };
    default:
      return {
        label: input.action.label,
        busyLabel: input.action.busyLabel,
      };
  }
}

export type CoordinatorRunSection = EpicWorkflowRunSection;
export type CoordinatorOutputTarget = EpicWorkflowOutputTarget;
export type CoordinatorActionCopy = EpicWorkflowActionCopy;
export type CoordinatorRunEntry = EpicWorkflowRunEntry;

export const buildCoordinatorRunEntries = buildEpicWorkflowRunEntries;
export const partitionCoordinatorRunEntries = partitionEpicWorkflowRunEntries;
export const selectCoordinatorRunEntry = selectEpicWorkflowRunEntry;
export const describeCoordinatorActionCopy = describeEpicWorkflowActionCopy;
