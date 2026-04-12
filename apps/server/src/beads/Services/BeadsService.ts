import type {
  BeadsContext,
  BeadsCommentIssueInput,
  BeadsCreateIssueInput,
  BeadsEpicIssueSummaries,
  BeadsEpicIssueSummariesInput,
  BeadsEpicIssueInput,
  BeadsEpicTrackerDetail,
  BeadsEpicTrackerDetailInput,
  BeadsGetContextInput,
  BeadsGetIssueInput,
  BeadsGetIssuesInput,
  BeadsGetIssuesResult,
  BeadsGetSessionActivityInput,
  BeadsGetSessionActivityResult,
  BeadsGetEpicRunSupportInput,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsProjectRunSummary,
  BeadsProjectRunSummaryInput,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsStartBacklogGroomingInput,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
  BeadsStartWorkflowResult,
  BeadsEpicTrackerStatus,
  BeadsEpicTrackerSummary,
  BeadsEpicRunSupport,
  BeadsEpicRunValidation,
  BeadsUpdateIssueInput,
  BeadsIssueSummary,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { BeadsError } from "@t3tools/contracts";

export interface BeadsServiceShape {
  readonly queryIssues: (
    input: BeadsQueryIssuesInput,
  ) => Effect.Effect<BeadsQueryIssuesResult, BeadsError>;
  readonly getIssue: (input: BeadsGetIssueInput) => Effect.Effect<BeadsIssueDetail, BeadsError>;
  readonly getIssues: (
    input: BeadsGetIssuesInput,
  ) => Effect.Effect<BeadsGetIssuesResult, BeadsError>;
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
  readonly getEpicRunSupport: (
    input: BeadsGetEpicRunSupportInput,
  ) => Effect.Effect<BeadsEpicRunSupport, BeadsError>;
  readonly getIssueGraph: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsIssueGraph, BeadsError>;
  readonly getEpicTrackerSummary: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsEpicTrackerSummary | null, BeadsError>;
  readonly validateEpicRun: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsEpicRunValidation, BeadsError>;
  readonly getEpicTrackerStatus: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsEpicTrackerStatus, BeadsError>;
  readonly getProjectRunSummary: (
    input: BeadsProjectRunSummaryInput,
  ) => Effect.Effect<BeadsProjectRunSummary, BeadsError>;
  readonly getEpicIssueSummaries: (
    input: BeadsEpicIssueSummariesInput,
  ) => Effect.Effect<BeadsEpicIssueSummaries, BeadsError>;
  readonly getEpicTrackerDetail: (
    input: BeadsEpicTrackerDetailInput,
  ) => Effect.Effect<BeadsEpicTrackerDetail, BeadsError>;
  readonly getSessionActivity: (
    input: BeadsGetSessionActivityInput,
  ) => Effect.Effect<BeadsGetSessionActivityResult, BeadsError>;
  readonly startWorkflow: (
    input: BeadsStartWorkflowInput,
  ) => Effect.Effect<BeadsStartWorkflowResult, BeadsError>;
  readonly startBacklogGrooming: (
    input: BeadsStartBacklogGroomingInput,
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

export class BeadsService extends Context.Service<BeadsService, BeadsServiceShape>()(
  "t3/beads/Services/BeadsService",
) {}
