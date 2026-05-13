import type {
  BeadsEpicCoordinationStatus,
  BeadsEpicCoordinationValidation,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

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
