import type {
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { BeadsError } from "@t3tools/contracts";

export interface EpicCoordinationSnapshot {
  readonly validation: BeadsEpicCoordinationValidation;
  readonly status: BeadsEpicCoordinationStatus;
}

export interface EpicCoordinationSnapshotReaderShape {
  readonly readSnapshot: (input: {
    readonly cwd: string;
    readonly epicIssueId: string;
  }) => Effect.Effect<EpicCoordinationSnapshot, BeadsError>;
}

export class EpicCoordinationSnapshotReader extends Context.Service<
  EpicCoordinationSnapshotReader,
  EpicCoordinationSnapshotReaderShape
>()("t3/orchestration/Services/EpicCoordinationSnapshotReader") {}
