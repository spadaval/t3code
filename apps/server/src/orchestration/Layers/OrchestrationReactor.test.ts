import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { PlanImplementationWorkflow } from "../Services/PlanImplementationWorkflow.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { OrchestrationReactor } from "../Services/OrchestrationReactor.ts";
import { EpicRunScheduler } from "../Services/EpicRunScheduler.ts";
import { makeOrchestrationReactor } from "./OrchestrationReactor.ts";

describe("OrchestrationReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationReactor, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("starts provider ingestion, provider command, and checkpoint reactors", async () => {
    const started: string[] = [];

    runtime = ManagedRuntime.make(
      Layer.effect(OrchestrationReactor, makeOrchestrationReactor).pipe(
        Layer.provideMerge(
          Layer.succeed(ProviderRuntimeIngestionService, {
            start: () => {
              started.push("provider-runtime-ingestion");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderCommandReactor, {
            start: () => {
              started.push("provider-command-reactor");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(CheckpointReactor, {
            start: () => {
              started.push("checkpoint-reactor");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(PlanImplementationWorkflow, {
            start: Effect.sync(() => {
              started.push("plan-implementation-workflow");
            }),
            drain: Effect.void,
            launchPlanImplementation: () => Effect.die("unused"),
            cancelPlanImplementationLaunch: () => Effect.die("unused"),
            retryPlanImplementationLaunch: () => Effect.die("unused"),
          }),
        ),
        Layer.provide(
          Layer.succeed(EpicRunScheduler, {
            start: Effect.sync(() => {
              started.push("swarm-scheduler");
            }),
            drain: Effect.void,
            startEpicRun: () => Effect.die("unused"),
            stopEpicRun: () => Effect.die("unused"),
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(OrchestrationReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

    expect(started).toEqual([
      "provider-runtime-ingestion",
      "provider-command-reactor",
      "checkpoint-reactor",
      "plan-implementation-workflow",
      "swarm-scheduler",
    ]);

    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
