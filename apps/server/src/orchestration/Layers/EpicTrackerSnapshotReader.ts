import { Effect, Layer } from "effect";

import { BeadsError } from "@t3tools/contracts";
import { BeadsTrackerService } from "../../beads/Services/BeadsTrackerService.ts";
import {
  EpicCoordinationSnapshotReader,
  type EpicCoordinationSnapshot,
} from "../Services/EpicTrackerSnapshotReader.ts";

const makeEpicCoordinationSnapshotReader = Effect.gen(function* () {
  const beadsTracker = yield* BeadsTrackerService;

  const readSnapshot = (input: { readonly cwd: string; readonly epicIssueId: string }) =>
    beadsTracker.loadEpicCoordinationState(input).pipe(
      Effect.flatMap((state) => {
        if (!state.validation || !state.status) {
          return Effect.fail(
            new BeadsError({
              message:
                state.validationError ?? state.statusError ?? "Failed to load epic workflow.",
            }),
          );
        }
        return Effect.succeed({
          validation: state.validation,
          status: state.status,
        } satisfies EpicCoordinationSnapshot);
      }),
    );

  return {
    readSnapshot,
  } as const;
});

export const EpicCoordinationSnapshotReaderLive = Layer.effect(
  EpicCoordinationSnapshotReader,
  makeEpicCoordinationSnapshotReader,
);
