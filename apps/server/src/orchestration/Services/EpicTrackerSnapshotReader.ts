import type {
  BeadsEpicRunSupport,
  BeadsEpicRunValidation,
  BeadsEpicTrackerStatus,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { BeadsError } from "@t3tools/contracts";

export interface EpicTrackerSnapshot {
  readonly support: BeadsEpicRunSupport;
  readonly validation: BeadsEpicRunValidation;
  readonly status: BeadsEpicTrackerStatus;
}

export interface EpicTrackerSnapshotReaderShape {
  readonly readSnapshot: (input: {
    readonly cwd: string;
    readonly epicIssueId: string;
  }) => Effect.Effect<EpicTrackerSnapshot, BeadsError>;
}

export class EpicTrackerSnapshotReader extends Context.Service<
  EpicTrackerSnapshotReader,
  EpicTrackerSnapshotReaderShape
>()("t3/orchestration/Services/EpicTrackerSnapshotReader") {}
