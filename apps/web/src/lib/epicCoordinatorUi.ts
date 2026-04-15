import type { BeadsCoordinatorEpicSnapshot, OrchestrationEpicRun } from "@t3tools/contracts";

export type CoordinatorRunSection = "active" | "needsIntervention" | "history";

export interface CoordinatorOutputTarget {
  readonly epicId: string;
  readonly runId: OrchestrationEpicRun["runId"] | null;
}

export interface CoordinatorActionCopy {
  readonly label: string;
  readonly busyLabel: string;
}

export interface CoordinatorRunEntry {
  readonly key: string;
  readonly section: CoordinatorRunSection;
  readonly epic: BeadsCoordinatorEpicSnapshot;
  readonly run: OrchestrationEpicRun;
  readonly summary: string | null;
  readonly failureMessage: string | null;
}

function compareRunsByRecency(left: OrchestrationEpicRun, right: OrchestrationEpicRun): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.requestedAt.localeCompare(left.requestedAt) ||
    right.runId.localeCompare(left.runId)
  );
}

export function getLatestEpicRun(epic: BeadsCoordinatorEpicSnapshot): OrchestrationEpicRun | null {
  return [...epic.runs].toSorted(compareRunsByRecency)[0] ?? null;
}

export function getActiveEpicRun(epic: BeadsCoordinatorEpicSnapshot): OrchestrationEpicRun | null {
  if (epic.activeRunId) {
    return epic.runs.find((run) => run.runId === epic.activeRunId) ?? null;
  }

  return (
    epic.runs.find(
      (run) => run.status === "pending" || run.status === "running" || run.status === "stopping",
    ) ?? null
  );
}

export function resolveEpicOutputTarget(
  epic: BeadsCoordinatorEpicSnapshot,
): CoordinatorOutputTarget | null {
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
  epic: BeadsCoordinatorEpicSnapshot,
): CoordinatorOutputTarget | null {
  if (epic.projectConflict) {
    return {
      epicId: epic.projectConflict.run.epicIssueId,
      runId: epic.projectConflict.run.runId,
    };
  }

  return resolveEpicOutputTarget(epic);
}

function summarizeRun(
  epic: BeadsCoordinatorEpicSnapshot,
  run: OrchestrationEpicRun,
): string | null {
  const { progress } = epic;

  if (run.status === "failed") {
    return run.failureContext?.message ?? null;
  }

  if (run.status === "running" || run.status === "pending" || run.status === "stopping") {
    if (progress.activeWorkerCount > 0) {
      return `${progress.activeWorkerCount} worker${progress.activeWorkerCount === 1 ? "" : "s"} active`;
    }
    if (progress.activeIssueCount > 0) {
      return `${progress.activeIssueCount} active issue${progress.activeIssueCount === 1 ? "" : "s"}`;
    }
  }

  if (progress.totalIssueCount > 0) {
    return `${progress.completedIssueCount}/${progress.totalIssueCount} issues done`;
  }

  return null;
}

export function buildCoordinatorRunEntries(
  epics: readonly BeadsCoordinatorEpicSnapshot[],
): CoordinatorRunEntry[] {
  const active: CoordinatorRunEntry[] = [];
  const needsIntervention: CoordinatorRunEntry[] = [];
  const history: CoordinatorRunEntry[] = [];

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
          summary: summarizeRun(epic, run),
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
            summary: summarizeRun(epic, run),
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
        summary: summarizeRun(epic, run),
        failureMessage: run.failureContext?.message ?? null,
      });
    }
  }

  active.sort((left, right) => compareRunsByRecency(left.run, right.run));
  needsIntervention.sort((left, right) => compareRunsByRecency(left.run, right.run));
  history.sort((left, right) => compareRunsByRecency(left.run, right.run));

  return [...active, ...needsIntervention, ...history];
}

export function partitionCoordinatorRunEntries(entries: readonly CoordinatorRunEntry[]): {
  readonly active: readonly CoordinatorRunEntry[];
  readonly needsIntervention: readonly CoordinatorRunEntry[];
  readonly history: readonly CoordinatorRunEntry[];
} {
  return {
    active: entries.filter((entry) => entry.section === "active"),
    needsIntervention: entries.filter((entry) => entry.section === "needsIntervention"),
    history: entries.filter((entry) => entry.section === "history"),
  };
}

function pickPreferredEpicRun(entries: readonly CoordinatorRunEntry[]): CoordinatorRunEntry | null {
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

export function selectCoordinatorRunEntry(input: {
  readonly entries: readonly CoordinatorRunEntry[];
  readonly runId?: string | null;
  readonly epicId?: string | null;
}): CoordinatorRunEntry | null {
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

type PrimaryActionLike = Pick<
  BeadsCoordinatorEpicSnapshot["primaryAction"],
  "kind" | "label" | "busyLabel"
>;

export function describeCoordinatorActionCopy(input: {
  readonly surface: "issues" | "coordinator";
  readonly action: PrimaryActionLike;
  readonly epic: Pick<BeadsCoordinatorEpicSnapshot, "projectConflict">;
  readonly selectedRun?: Pick<OrchestrationEpicRun, "status"> | null;
}): CoordinatorActionCopy {
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
    case "open_coordinator":
      if (input.surface === "issues") {
        return {
          label: input.epic.projectConflict ? "View active run" : "Open output",
          busyLabel: "Opening...",
        };
      }
      return {
        label: input.epic.projectConflict ? "Open conflicting run" : "Open output",
        busyLabel: "Opening...",
      };
    default:
      return {
        label: input.action.label,
        busyLabel: input.action.busyLabel,
      };
  }
}
