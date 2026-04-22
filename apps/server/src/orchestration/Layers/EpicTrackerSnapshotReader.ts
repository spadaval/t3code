import { Effect, Layer } from "effect";

import { BeadsTrackerService } from "../../beads/Services/BeadsTrackerService.ts";
import {
  EpicCoordinationSnapshotReader,
  type EpicCoordinationSnapshot,
} from "../Services/EpicTrackerSnapshotReader.ts";

const makeEpicCoordinationSnapshotReader = Effect.gen(function* () {
  const beadsTracker = yield* BeadsTrackerService;

  const readSnapshot = (input: { readonly cwd: string; readonly epicIssueId: string }) =>
    Effect.all(
      [
        beadsTracker.validateEpicCoordination({
          cwd: input.cwd,
          epicIssueId: input.epicIssueId,
        }),
        beadsTracker.getEpicCoordinationStatus({
          cwd: input.cwd,
          epicIssueId: input.epicIssueId,
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(
        ([validation, status]) =>
          ({
            validation,
            status,
          }) satisfies EpicCoordinationSnapshot,
      ),
    );

  return {
    readSnapshot,
  } as const;
});

export const EpicCoordinationSnapshotReaderLive = Layer.effect(
  EpicCoordinationSnapshotReader,
  makeEpicCoordinationSnapshotReader,
);
