import { Effect, Layer } from "effect";

import { BeadsTrackerService } from "../../beads/Services/BeadsTrackerService.ts";
import {
  EpicTrackerSnapshotReader,
  type EpicTrackerSnapshot,
} from "../Services/EpicTrackerSnapshotReader.ts";

const makeEpicTrackerSnapshotReader = Effect.gen(function* () {
  const beadsTracker = yield* BeadsTrackerService;

  const readSnapshot = (input: { readonly cwd: string; readonly epicIssueId: string }) =>
    Effect.all(
      [
        beadsTracker.getEpicRunSupport({ cwd: input.cwd }),
        beadsTracker.validateEpicRun({
          cwd: input.cwd,
          epicIssueId: input.epicIssueId,
        }),
        beadsTracker.getEpicTrackerStatus({
          cwd: input.cwd,
          epicIssueId: input.epicIssueId,
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map(
        ([support, validation, status]) =>
          ({
            support,
            validation,
            status,
          }) satisfies EpicTrackerSnapshot,
      ),
    );

  return {
    readSnapshot,
  } as const;
});

export const EpicTrackerSnapshotReaderLive = Layer.effect(
  EpicTrackerSnapshotReader,
  makeEpicTrackerSnapshotReader,
);
