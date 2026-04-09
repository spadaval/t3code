import type {
  BeadsContext,
  BeadsCommentIssueInput,
  BeadsCreateIssueInput,
  BeadsEpicCoordinatorSnapshot,
  BeadsEpicCoordinatorSnapshotInput,
  BeadsEpicIssueInput,
  BeadsGetContextInput,
  BeadsGetIssueInput,
  BeadsGetSessionActivityInput,
  BeadsGetSessionActivityResult,
  BeadsGetSwarmSupportInput,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsListSwarmsInput,
  BeadsListSwarmsResult,
  BeadsProjectCoordinatorSnapshot,
  BeadsProjectCoordinatorSnapshotInput,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
  BeadsStartWorkflowResult,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  BeadsUpdateIssueInput,
  BeadsIssueSummary,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { BeadsError } from "@t3tools/contracts";

export interface BeadsServiceShape {
  readonly queryIssues: (
    input: BeadsQueryIssuesInput,
  ) => Effect.Effect<BeadsQueryIssuesResult, BeadsError>;
  readonly getIssue: (input: BeadsGetIssueInput) => Effect.Effect<BeadsIssueDetail, BeadsError>;
  readonly updateIssue: (
    input: BeadsUpdateIssueInput,
  ) => Effect.Effect<BeadsIssueSummary, BeadsError>;
  readonly createIssue: (
    input: BeadsCreateIssueInput,
  ) => Effect.Effect<BeadsIssueSummary, BeadsError>;
  readonly commentIssue: (
    input: BeadsCommentIssueInput,
  ) => Effect.Effect<BeadsIssueDetail, BeadsError>;
  readonly getContext: (input: BeadsGetContextInput) => Effect.Effect<BeadsContext, BeadsError>;
  readonly getSwarmSupport: (
    input: BeadsGetSwarmSupportInput,
  ) => Effect.Effect<BeadsSwarmSupport, BeadsError>;
  readonly getIssueGraph: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsIssueGraph, BeadsError>;
  readonly getEpicSwarm: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsSwarmSummary | null, BeadsError>;
  readonly validateEpicSwarm: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsSwarmValidation, BeadsError>;
  readonly getEpicSwarmStatus: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsSwarmStatus, BeadsError>;
  readonly listSwarms: (
    input: BeadsListSwarmsInput,
  ) => Effect.Effect<BeadsListSwarmsResult, BeadsError>;
  readonly getProjectCoordinatorSnapshot: (
    input: BeadsProjectCoordinatorSnapshotInput,
  ) => Effect.Effect<BeadsProjectCoordinatorSnapshot, BeadsError>;
  readonly getEpicCoordinatorSnapshot: (
    input: BeadsEpicCoordinatorSnapshotInput,
  ) => Effect.Effect<BeadsEpicCoordinatorSnapshot, BeadsError>;
  readonly getSessionActivity: (
    input: BeadsGetSessionActivityInput,
  ) => Effect.Effect<BeadsGetSessionActivityResult, BeadsError>;
  readonly startWorkflow: (
    input: BeadsStartWorkflowInput,
  ) => Effect.Effect<BeadsStartWorkflowResult, BeadsError>;
  readonly startEpicQuickRefine: (
    input: BeadsStartEpicQuickRefineInput,
  ) => Effect.Effect<BeadsStartWorkflowResult, BeadsError>;
  readonly startEpicPlannedRefine: (
    input: BeadsStartEpicPlannedRefineInput,
  ) => Effect.Effect<BeadsStartWorkflowResult, BeadsError>;
  readonly startEpicCoordinationPrep: (
    input: BeadsStartEpicCoordinationPrepInput,
  ) => Effect.Effect<BeadsStartWorkflowResult, BeadsError>;
}

export class BeadsService extends ServiceMap.Service<BeadsService, BeadsServiceShape>()(
  "t3/beads/Services/BeadsService",
) {}
