import type {
  BeadsContext,
  BeadsCommentIssueInput,
  BeadsCreateIssueInput,
  BeadsEpicIssueSummaries,
  BeadsEpicIssueSummariesInput,
  BeadsEpicIssueInput,
  OrchestrationEpicWorkflowDetail,
  OrchestrationEpicWorkflowDetailInput,
  BeadsGetContextInput,
  BeadsGetIssueInput,
  BeadsGetIssuesInput,
  BeadsGetIssuesResult,
  BeadsResolveIssueRefsInput,
  BeadsResolveIssueRefsResult,
  BeadsGetSessionActivityInput,
  BeadsGetSessionActivityResult,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsStartBacklogGroomingInput,
  BeadsStartEpicPlannedRefineInput,
  BeadsStartEpicQuickRefineInput,
  BeadsStartEpicCoordinationPrepInput,
  BeadsStartWorkflowInput,
  BeadsStartWorkflowResult,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
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
  readonly resolveIssueRefs: (
    input: BeadsResolveIssueRefsInput,
  ) => Effect.Effect<BeadsResolveIssueRefsResult, BeadsError>;
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
  readonly getIssueGraph: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsIssueGraph, BeadsError>;
  readonly validateEpicCoordination: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsEpicCoordinationValidation, BeadsError>;
  readonly getEpicCoordinationStatus: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsEpicCoordinationStatus, BeadsError>;
  readonly getEpicIssueSummaries: (
    input: BeadsEpicIssueSummariesInput,
  ) => Effect.Effect<BeadsEpicIssueSummaries, BeadsError>;
  readonly getEpicWorkflowDetail: (
    input: OrchestrationEpicWorkflowDetailInput,
  ) => Effect.Effect<OrchestrationEpicWorkflowDetail, BeadsError>;
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
