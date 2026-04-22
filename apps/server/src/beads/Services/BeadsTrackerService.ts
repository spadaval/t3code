import type {
  BeadsCommentIssueInput,
  BeadsContext,
  BeadsCreateIssueInput,
  BeadsEpicIssueSummaries,
  BeadsEpicIssueInput,
  BeadsGetContextInput,
  BeadsGetIssueInput,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueSummary,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
  BeadsUpdateIssueInput,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { BeadsError } from "@t3tools/contracts";

export interface BeadsTrackerServiceShape {
  readonly queryIssues: (
    input: BeadsQueryIssuesInput,
  ) => Effect.Effect<BeadsQueryIssuesResult, BeadsError>;
  readonly listCoordinatorEpics: (input: {
    cwd: string;
  }) => Effect.Effect<ReadonlyArray<BeadsIssueSummary>, BeadsError>;
  readonly getIssueSummary: (
    input: BeadsGetIssueInput,
  ) => Effect.Effect<BeadsIssueSummary, BeadsError>;
  readonly getIssue: (input: BeadsGetIssueInput) => Effect.Effect<BeadsIssueDetail, BeadsError>;
  readonly getEpicIssueSummaries: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsEpicIssueSummaries, BeadsError>;
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
  readonly loadEpicCoordinationState: (input: {
    cwd: string;
    epicIssueId: string;
    issueSummary?: BeadsIssueSummary | null;
  }) => Effect.Effect<
    {
      readonly issueSummary: BeadsIssueSummary | null;
      readonly validation: BeadsEpicCoordinationValidation | null;
      readonly status: BeadsEpicCoordinationStatus | null;
      readonly validationError: string | null;
      readonly statusError: string | null;
    },
    never
  >;
}

export class BeadsTrackerService extends Context.Service<
  BeadsTrackerService,
  BeadsTrackerServiceShape
>()("t3/beads/Services/BeadsTrackerService") {}
