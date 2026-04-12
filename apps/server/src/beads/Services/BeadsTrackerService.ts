import type {
  BeadsCommentIssueInput,
  BeadsContext,
  BeadsCreateIssueInput,
  BeadsEpicIssueSummaries,
  BeadsEpicIssueInput,
  BeadsGetContextInput,
  BeadsGetIssueInput,
  BeadsGetEpicRunSupportInput,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueSummary,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsEpicTrackerStatus,
  BeadsEpicTrackerSummary,
  BeadsEpicRunSupport,
  BeadsEpicRunValidation,
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
  readonly initializeEpicTracker: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsEpicTrackerSummary, BeadsError>;
  readonly loadEpicCoordinatorTrackerState: (input: {
    cwd: string;
    epicIssueId: string;
    support: BeadsEpicRunSupport;
    issueSummary?: BeadsIssueSummary | null;
    trackerSummary?: BeadsEpicTrackerSummary | null;
  }) => Effect.Effect<
    {
      readonly issueSummary: BeadsIssueSummary | null;
      readonly validation: BeadsEpicRunValidation | null;
      readonly status: BeadsEpicTrackerStatus | null;
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
