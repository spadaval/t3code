import type {
  BeadsCommentIssueInput,
  BeadsContext,
  BeadsEpicIssueInput,
  BeadsGetContextInput,
  BeadsGetIssueInput,
  BeadsGetSwarmSupportInput,
  BeadsIssueDetail,
  BeadsIssueGraph,
  BeadsIssueSummary,
  BeadsListSwarmsInput,
  BeadsListSwarmsResult,
  BeadsQueryIssuesInput,
  BeadsQueryIssuesResult,
  BeadsSwarmStatus,
  BeadsSwarmSummary,
  BeadsSwarmSupport,
  BeadsSwarmValidation,
  BeadsUpdateIssueInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { BeadsError } from "@t3tools/contracts";

export interface BeadsTrackerServiceShape {
  readonly queryIssues: (
    input: BeadsQueryIssuesInput,
  ) => Effect.Effect<BeadsQueryIssuesResult, BeadsError>;
  readonly getIssue: (input: BeadsGetIssueInput) => Effect.Effect<BeadsIssueDetail, BeadsError>;
  readonly updateIssue: (
    input: BeadsUpdateIssueInput,
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
  readonly createEpicSwarm: (
    input: BeadsEpicIssueInput,
  ) => Effect.Effect<BeadsSwarmSummary, BeadsError>;
}

export class BeadsTrackerService extends ServiceMap.Service<
  BeadsTrackerService,
  BeadsTrackerServiceShape
>()("t3/beads/Services/BeadsTrackerService") {}
