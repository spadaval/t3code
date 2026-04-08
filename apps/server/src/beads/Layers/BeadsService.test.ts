import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { BeadsService } from "../Services/BeadsService.ts";
import { BeadsServiceLive, BeadsTrackerServiceLive } from "./BeadsService.ts";

const mockedRunProcess = vi.mocked(runProcess);
const mockedGetReadModel = vi.fn(() =>
  Effect.succeed({
    snapshotSequence: 0,
    updatedAt: new Date().toISOString(),
    planImplementationLaunches: [],
    swarmRuns: [],
    swarmTaskExecutions: [],
    projects: [],
    threads: [],
  }),
);
const mockedDispatch = vi.fn<(command: unknown) => Effect.Effect<{ sequence: number }, never>>(
  (_: unknown) => Effect.die("dispatch was not expected in this test"),
);

const orchestrationEngineLayer = Layer.mock(OrchestrationEngineService)({
  getReadModel: () => mockedGetReadModel(),
  readEvents: () => Stream.empty,
  dispatch: (command) => mockedDispatch(command),
  streamDomainEvents: Stream.empty,
});

const layer = it.layer(
  BeadsServiceLive.pipe(
    Layer.provide(BeadsTrackerServiceLive),
    Layer.provide(orchestrationEngineLayer),
  ),
);

afterEach(() => {
  mockedRunProcess.mockReset();
  mockedGetReadModel.mockReset();
  mockedDispatch.mockReset();
  mockedGetReadModel.mockImplementation(() =>
    Effect.succeed({
      snapshotSequence: 0,
      updatedAt: new Date().toISOString(),
      planImplementationLaunches: [],
      swarmRuns: [],
      swarmTaskExecutions: [],
      projects: [],
      threads: [],
    }),
  );
  mockedDispatch.mockImplementation((_: unknown) =>
    Effect.die("dispatch was not expected in this test"),
  );
});

function successJson(value: unknown) {
  return {
    stdout: JSON.stringify(value),
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
  } as const;
}

function successStdout(stdout: string) {
  return {
    stdout,
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
  } as const;
}

function commandKey(args: readonly string[]): string {
  return args.filter((arg) => arg !== "--json").join(" ");
}

function installBdJsonMock(outputs: Record<string, unknown>) {
  mockedRunProcess.mockImplementation(async (_command, args) => {
    const key = commandKey(args);
    const output = outputs[key];
    if (output === undefined) {
      throw new Error(`Unexpected bd args: ${args.join(" ")}`);
    }
    return successJson(output);
  });
}

layer("BeadsServiceLive", (it) => {
  it.effect("serializes read-only bd access per repository in embedded mode", () =>
    Effect.gen(function* () {
      const cwd = "/repo-embedded";
      const now = new Date().toISOString();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      mockedRunProcess.mockImplementation(async (_command, args) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const action = args[0];
          if (action === "context") {
            return successJson({
              beads_dir: "/repo/.beads",
              repo_root: cwd,
              cwd_repo_root: cwd,
              is_redirected: false,
              is_worktree: false,
              backend: "dolt",
              dolt_mode: "embedded",
              database: "repo",
              project_id: "project-1",
              role: "contributor",
              bd_version: "1.0.0",
            });
          }

          if (action === "show") {
            return successJson([
              {
                id: "ISS-1",
                title: "Serialize beads access",
                description: "desc",
                notes: "notes",
                status: "open",
                priority: 1,
                issue_type: "feature",
                assignee: null,
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                labels: [],
              },
            ]);
          }

          if (action === "comments" || action === "history") {
            return successJson([]);
          }

          throw new Error(`Unexpected bd args: ${args.join(" ")}`);
        } finally {
          activeCalls -= 1;
        }
      });

      const beads = yield* BeadsService;
      const [left, right] = yield* Effect.all(
        [beads.getIssue({ cwd, issueId: "ISS-1" }), beads.getIssue({ cwd, issueId: "ISS-1" })],
        { concurrency: "unbounded" },
      );

      assert.equal(left.id, "ISS-1");
      assert.equal(right.id, "ISS-1");
      expect(mockedRunProcess).toHaveBeenCalledTimes(7);
      expect(maxActiveCalls).toBe(1);
    }),
  );

  it.effect("allows read-only bd access to run in parallel in server mode", () =>
    Effect.gen(function* () {
      const cwd = "/repo-server";
      const now = new Date().toISOString();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      mockedRunProcess.mockImplementation(async (_command, args) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const action = args[0];
          if (action === "context") {
            return successJson({
              beads_dir: "/repo/.beads",
              repo_root: cwd,
              cwd_repo_root: cwd,
              is_redirected: false,
              is_worktree: false,
              backend: "dolt",
              dolt_mode: "server",
              database: "repo",
              project_id: "project-1",
              role: "contributor",
              bd_version: "1.0.0",
            });
          }

          if (action === "show") {
            return successJson([
              {
                id: "ISS-1",
                title: "Parallel beads access",
                description: "desc",
                notes: "notes",
                status: "open",
                priority: 1,
                issue_type: "feature",
                assignee: null,
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                labels: [],
              },
            ]);
          }

          if (action === "comments" || action === "history") {
            return successJson([]);
          }

          throw new Error(`Unexpected bd args: ${args.join(" ")}`);
        } finally {
          activeCalls -= 1;
        }
      });

      const beads = yield* BeadsService;
      const [left, right] = yield* Effect.all(
        [beads.getIssue({ cwd, issueId: "ISS-1" }), beads.getIssue({ cwd, issueId: "ISS-1" })],
        { concurrency: "unbounded" },
      );

      assert.equal(left.id, "ISS-1");
      assert.equal(right.id, "ISS-1");
      expect(maxActiveCalls).toBeGreaterThan(1);
    }),
  );

  it.effect("loads issue detail when history JSON exceeds the text truncation cap", () =>
    Effect.gen(function* () {
      const cwd = "/repo-large-history";
      const now = new Date().toISOString();
      const largeHistory = Array.from({ length: 6_000 }, (_, index) => ({
        CommitHash: `commit-${index}`,
        Committer: "beads",
        CommitDate: now,
        Issue: {
          id: "ISS-1",
          title: `Large history entry ${index}`,
          status: "open",
        },
      }));
      const historyStdout = JSON.stringify(largeHistory);
      expect(Buffer.byteLength(historyStdout)).toBeGreaterThan(512 * 1024);

      mockedRunProcess.mockImplementation(async (_command, args, options) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: cwd,
            cwd_repo_root: cwd,
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          });
        }

        if (key === "show ISS-1 --long") {
          return successJson([
            {
              id: "ISS-1",
              title: "Large issue history",
              description: "desc",
              notes: "notes",
              status: "open",
              priority: 1,
              issue_type: "feature",
              assignee: null,
              owner: null,
              created_at: now,
              created_by: null,
              updated_at: now,
              labels: [],
            },
          ]);
        }

        if (key === "comments ISS-1") {
          return successJson([]);
        }

        if (key === "history ISS-1") {
          if ((options?.maxBufferBytes ?? 0) < Buffer.byteLength(historyStdout)) {
            throw new Error(
              `bd ${args.join(" ")} exceeded stdout buffer limit (${options?.maxBufferBytes ?? 0} bytes).`,
            );
          }
          return successStdout(historyStdout);
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const issue = yield* beads.getIssue({ cwd, issueId: "ISS-1" });
      const historyCall = mockedRunProcess.mock.calls.find(
        ([, args]) => commandKey(args) === "history ISS-1",
      );

      assert.equal(issue.id, "ISS-1");
      assert.equal(issue.history.length, largeHistory.length);
      expect(historyCall?.[2]).toMatchObject({
        outputMode: "error",
        maxBufferBytes: 4 * 1024 * 1024,
      });
    }),
  );

  it.effect("surfaces an explicit error when bd JSON output exceeds the capture limit", () =>
    Effect.gen(function* () {
      const cwd = "/repo-too-large-history";
      const now = new Date().toISOString();
      const oversizedHistoryStdout = JSON.stringify(
        Array.from({ length: 60_000 }, (_, index) => ({
          CommitHash: `commit-${index}`,
          Committer: "beads",
          CommitDate: now,
          Issue: {
            id: "ISS-1",
            title: `Oversized history entry ${index}`,
            status: "open",
          },
        })),
      );
      expect(Buffer.byteLength(oversizedHistoryStdout)).toBeGreaterThan(4 * 1024 * 1024);

      mockedRunProcess.mockImplementation(async (_command, args, options) => {
        const key = commandKey(args);
        if (key === "context") {
          return successJson({
            beads_dir: "/repo/.beads",
            repo_root: cwd,
            cwd_repo_root: cwd,
            is_redirected: false,
            is_worktree: false,
            backend: "dolt",
            dolt_mode: "server",
            database: "repo",
            project_id: "project-1",
            role: "contributor",
            bd_version: "1.0.0",
          });
        }

        if (key === "show ISS-1 --long") {
          return successJson([
            {
              id: "ISS-1",
              title: "Oversized issue history",
              description: "desc",
              notes: "notes",
              status: "open",
              priority: 1,
              issue_type: "feature",
              assignee: null,
              owner: null,
              created_at: now,
              created_by: null,
              updated_at: now,
              labels: [],
            },
          ]);
        }

        if (key === "comments ISS-1") {
          return successJson([]);
        }

        if (key === "history ISS-1") {
          throw new Error(
            `bd ${args.join(" ")} exceeded stdout buffer limit (${options?.maxBufferBytes ?? 0} bytes).`,
          );
        }

        throw new Error(`Unexpected bd args: ${args.join(" ")}`);
      });

      const beads = yield* BeadsService;
      const exit = yield* Effect.exit(beads.getIssue({ cwd, issueId: "ISS-1" }));
      const squashed = exit._tag === "Failure" ? Cause.squash(exit.cause) : null;
      const message = squashed instanceof Error ? squashed.message : String(squashed);

      assert.equal(exit._tag, "Failure");
      expect(message).toContain("Beads JSON output exceeded capture limit (4194304 bytes).");
    }),
  );

  it.effect("keeps write-capable bd commands serialized in server mode", () =>
    Effect.gen(function* () {
      const cwd = "/repo-server-write";
      const now = new Date().toISOString();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      mockedRunProcess.mockImplementation(async (_command, args) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const action = args[0];
          if (action === "update") {
            return successJson([
              {
                id: "ISS-1",
                title: args.at(-1) ?? "Updated issue",
                description: "desc",
                notes: "notes",
                status: "open",
                priority: 1,
                issue_type: "feature",
                assignee: null,
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                labels: [],
              },
            ]);
          }

          throw new Error(`Unexpected bd args: ${args.join(" ")}`);
        } finally {
          activeCalls -= 1;
        }
      });

      const beads = yield* BeadsService;
      const [left, right] = yield* Effect.all(
        [
          beads.updateIssue({ cwd, issueId: "ISS-1", title: "Left update" }),
          beads.updateIssue({ cwd, issueId: "ISS-1", title: "Right update" }),
        ],
        { concurrency: "unbounded" },
      );

      assert.equal(left.id, "ISS-1");
      assert.equal(right.id, "ISS-1");
      expect(mockedRunProcess).toHaveBeenCalledTimes(2);
      expect(maxActiveCalls).toBe(1);
    }),
  );

  it.effect("loads beads context and derives embedded swarm support gating", () =>
    Effect.gen(function* () {
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "embedded",
          database: "repo",
          project_id: "project-1",
          role: "contributor",
          bd_version: "1.0.0",
        },
      });

      const beads = yield* BeadsService;
      const context = yield* beads.getContext({ cwd: "/repo" });
      const support = yield* beads.getSwarmSupport({ cwd: "/repo" });
      const swarms = yield* beads.listSwarms({ cwd: "/repo" });

      assert.equal(context.backend.kind, "dolt");
      assert.equal(context.backend.doltMode, "embedded");
      assert.equal(support.supported, false);
      expect(support.reason).toContain("embedded Dolt mode");
      assert.deepStrictEqual(swarms.swarms, []);
      expect(
        mockedRunProcess.mock.calls.some(([, args]) => commandKey(args).startsWith("swarm ")),
      ).toBe(false);
    }),
  );

  it.effect("preserves parent refs when querying issues for epic grouping", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        "list --all --limit 0": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Epic description",
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
          },
          {
            id: "TASK-1",
            title: "First child",
            description: "Implements the first step",
            notes: null,
            status: "open",
            priority: 1,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            parent: "EPIC-1",
          },
          {
            id: "TASK-2",
            title: "Closed child",
            description: "Done already",
            notes: null,
            status: "closed",
            priority: 3,
            issue_type: "task",
            assignee: null,
            owner: null,
            created_at: now,
            created_by: null,
            updated_at: now,
            labels: [],
            parent: "EPIC-1",
          },
        ],
      });

      const beads = yield* BeadsService;
      const result = yield* beads.queryIssues({
        cwd: "/repo",
        sortBy: "updated",
      });

      assert.deepStrictEqual(
        result.issues.map((issue) => issue.id),
        ["EPIC-1", "TASK-1"],
      );
      assert.deepStrictEqual(result.issues[1]?.parent, {
        id: "EPIC-1",
        title: "Epic coordination",
      });
    }),
  );

  it.effect("maps epic issue graph relations from show/comments/history output", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Epic description",
            notes: "Epic notes",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            parent_id: "PARENT-1",
            parent_title: "Parent initiative",
            dependencies: [
              {
                id: "DEP-1",
                title: "Dependency",
                status: "open",
                priority: 1,
                issue_type: "task",
                owner: null,
                created_at: now,
                created_by: null,
                updated_at: now,
                dependency_type: "blocks",
              },
            ],
            dependents: [
              {
                id: "CHILD-1",
                title: "First child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: "bob",
                owner: null,
                parent_id: "EPIC-1",
                parent_title: "Epic coordination",
                dependency_type: "parent-child",
              },
              {
                id: "FOLLOW-1",
                title: "Dependent issue",
                status: "blocked",
                priority: 3,
                issue_type: "task",
                assignee: null,
                owner: null,
                dependency_type: "blocks",
              },
            ],
          },
        ],
        "show PARENT-1 --long": [
          {
            id: "PARENT-1",
            title: "Parent initiative",
            status: "open",
            priority: 1,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });

      const beads = yield* BeadsService;
      const graph = yield* beads.getIssueGraph({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.equal(graph.epic.id, "EPIC-1");
      assert.equal(graph.parent?.id, "PARENT-1");
      assert.deepStrictEqual(
        graph.children.map((issue) => issue.id),
        ["CHILD-1"],
      );
      assert.deepStrictEqual(
        graph.dependencies.map((issue) => issue.id),
        ["DEP-1"],
      );
      assert.deepStrictEqual(
        graph.dependents.map((issue) => issue.id),
        ["FOLLOW-1"],
      );
    }),
  );

  it.effect("maps swarm summary, validation, and status when swarm support is enabled", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
        "swarm list": {
          swarms: [
            {
              swarm_id: "SWARM-1",
              epic_id: "EPIC-1",
              epic_title: "Epic coordination",
              total_issue_count: 4,
              completed_issue_count: 1,
              active_issue_count: 1,
              ready_issue_count: 1,
              blocked_issue_count: 1,
              active_worker_count: 1,
            },
          ],
        },
        "swarm validate EPIC-1": {
          valid: true,
          errors: [],
          warnings: ["One dependency chain is longer than the others."],
          ready_fronts: [
            [
              {
                id: "READY-1",
                title: "Ready child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: null,
              },
            ],
          ],
          estimated_worker_sessions: 2,
          max_parallelism: 3,
        },
        "swarm status EPIC-1": {
          completed: [
            {
              id: "DONE-1",
              title: "Completed child",
              status: "closed",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          active: [
            {
              id: "ACTIVE-1",
              title: "Active child",
              status: "in_progress",
              priority: 1,
              issue_type: "task",
              assignee: "bob",
              owner: null,
            },
          ],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
              status: "blocked",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
        },
      });

      const beads = yield* BeadsService;
      const swarm = yield* beads.getEpicSwarm({ cwd: "/repo", epicIssueId: "EPIC-1" });
      const validation = yield* beads.validateEpicSwarm({ cwd: "/repo", epicIssueId: "EPIC-1" });
      const status = yield* beads.getEpicSwarmStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.equal(swarm?.swarmId, "SWARM-1");
      assert.equal(validation.valid, true);
      assert.equal(validation.swarm?.epicId, "EPIC-1");
      assert.equal(validation.maxParallelism, 3);
      assert.deepStrictEqual(
        validation.readyFronts.map((front) => front.map((issue) => issue.id)),
        [["READY-1"]],
      );
      assert.deepStrictEqual(
        status.completed.map((issue) => issue.id),
        ["DONE-1"],
      );
      assert.deepStrictEqual(
        status.active.map((issue) => issue.id),
        ["ACTIVE-1"],
      );
      assert.deepStrictEqual(
        status.ready.map((issue) => issue.id),
        ["READY-1"],
      );
      assert.deepStrictEqual(
        status.blocked.map((issue) => issue.id),
        ["BLOCKED-1"],
      );
    }),
  );

  it.effect("maps current bd swarm JSON field names without zeroing summary counts", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependencies: [],
            dependents: [],
          },
        ],
        "swarm list": {
          swarms: [
            {
              id: "SWARM-1",
              title: "Swarm: Epic coordination",
              epic_id: "EPIC-1",
              epic_title: "Epic coordination",
              status: "open",
              coordinator: "",
              total_issues: 13,
              completed_issues: 5,
              active_issues: 0,
              progress_percent: 38.46153846153847,
            },
          ],
        },
        "swarm validate EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          total_issues: 13,
          closed_issues: 5,
          ready_fronts: [
            {
              wave: 0,
              issues: ["READY-1", "READY-2"],
              titles: ["Ready child 1", "Ready child 2"],
            },
          ],
          max_parallelism: 6,
          estimated_sessions: 13,
          warnings: null,
          errors: null,
          swarmable: true,
        },
        "swarm status EPIC-1": {
          epic_id: "EPIC-1",
          epic_title: "Epic coordination",
          total_issues: 13,
          completed: [
            {
              id: "DONE-1",
              title: "Completed child",
              status: "closed",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child 1",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
              status: "blocked",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          active_count: 0,
          ready_count: 1,
          blocked_count: 1,
        },
      });

      const beads = yield* BeadsService;
      const swarms = yield* beads.listSwarms({ cwd: "/repo" });
      const validation = yield* beads.validateEpicSwarm({ cwd: "/repo", epicIssueId: "EPIC-1" });
      const status = yield* beads.getEpicSwarmStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.deepStrictEqual(swarms.swarms, [
        {
          swarmId: "SWARM-1",
          epicId: "EPIC-1",
          epicTitle: "Epic coordination",
          totalIssueCount: 13,
          completedIssueCount: 5,
          activeIssueCount: 0,
          readyIssueCount: 0,
          blockedIssueCount: 0,
          activeWorkerCount: 0,
        },
      ]);
      assert.equal(validation.swarm?.totalIssueCount, 13);
      assert.equal(validation.swarm?.completedIssueCount, 5);
      assert.equal(validation.maxParallelism, 6);
      assert.equal(validation.estimatedWorkerSessions, 13);
      assert.deepStrictEqual(
        validation.readyFronts.map((front) => front.map((issue) => issue.id)),
        [["READY-1", "READY-2"]],
      );
      assert.equal(status.swarm?.totalIssueCount, 13);
      assert.equal(status.swarm?.completedIssueCount, 1);
      assert.equal(status.swarm?.readyIssueCount, 1);
      assert.equal(status.swarm?.blockedIssueCount, 1);
    }),
  );

  it.effect("hydrates sparse swarm status entries from epic child records", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "shared",
          database: "repo",
          project_id: "project-1",
          role: "contributor",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Track epic swarm progress",
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: [],
            dependents: [
              {
                id: "READY-1",
                title: "Ready child",
                status: "open",
                priority: 2,
                issue_type: "task",
                assignee: null,
                owner: "alice",
                dependency_type: "parent-child",
              },
              {
                id: "BLOCKED-1",
                title: "Blocked child",
                status: "blocked",
                priority: 1,
                issue_type: "task",
                assignee: null,
                owner: "bob",
                dependency_type: "parent-child",
              },
            ],
            dependencies: [],
          },
        ],
        "swarm list": {
          swarms: [],
        },
        "swarm status EPIC-1": {
          completed: [],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
            },
          ],
        },
      });

      const beads = yield* BeadsService;
      const status = yield* beads.getEpicSwarmStatus({ cwd: "/repo", epicIssueId: "EPIC-1" });

      assert.deepStrictEqual(status.ready, [
        {
          id: "READY-1",
          title: "Ready child",
          status: "open",
          priority: 2,
          issueType: "task",
          assignee: null,
          owner: "alice",
          parent: null,
        },
      ]);
      assert.deepStrictEqual(status.blocked, [
        {
          id: "BLOCKED-1",
          title: "Blocked child",
          status: "blocked",
          priority: 1,
          issueType: "task",
          assignee: null,
          owner: "bob",
          parent: null,
        },
      ]);
    }),
  );

  it.effect("starts epic quick refine in a default-mode linked thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Break this into tasks",
            notes: "Coordinate across workers",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            dependencies: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startEpicQuickRefine({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "EPIC-1: Epic coordination (Quick refine)",
        interactionMode: "default",
        issueLink: {
          issueId: "EPIC-1",
          title: "Epic coordination",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "default",
      });
    }),
  );

  it.effect("starts epic planned refine in a plan-mode linked thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Break this into tasks",
            notes: "Coordinate across workers",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            dependencies: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startEpicPlannedRefine({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "EPIC-1: Epic coordination (Planned refine)",
        interactionMode: "plan",
        issueLink: {
          issueId: "EPIC-1",
          title: "Epic coordination",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "plan",
      });
    }),
  );

  it.effect("starts planned implementation in a plan-mode linked thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        "show TASK-1 --long": [
          {
            id: "TASK-1",
            title: "Implement settings persistence",
            description: "Persist the selected settings values.",
            notes: "Avoid regressions during reconnect.",
            status: "open",
            priority: 2,
            issue_type: "task",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["settings"],
            dependencies: [],
          },
        ],
        "comments TASK-1": [],
        "history TASK-1": [],
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startWorkflow({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        issueId: "TASK-1",
        workflow: "plan-implementation",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "TASK-1: Implement settings persistence (Planned implementation)",
        interactionMode: "plan",
        issueLink: {
          issueId: "TASK-1",
          title: "Implement settings persistence",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "plan",
        message: {
          text: expect.stringContaining("Produce a concrete implementation plan for this issue."),
        },
      });
      const messageText = (dispatchedCommands[1] as { message: { text: string } }).message.text;
      expect(messageText).toContain("Do not implement code yet.");
      expect(messageText).toContain("acceptance criteria");
    }),
  );

  it.effect("starts missing-swarm planning in a tracker-only linked thread", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Break this into tasks",
            notes: "Coordinate across workers",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            dependencies: [],
            dependents: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
        "swarm list": {
          swarms: [],
        },
        "swarm validate EPIC-1": {
          valid: false,
          errors: ["Epic is missing a swarm."],
          warnings: [],
          ready_fronts: [],
          estimated_worker_sessions: 0,
          max_parallelism: 0,
        },
        "swarm status EPIC-1": {
          completed: [],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [],
        },
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startEpicPlanImplementation({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands).toHaveLength(2);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "EPIC-1: Epic coordination (Create swarm)",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        issueLink: {
          issueId: "EPIC-1",
          title: "Epic coordination",
          status: "open",
          priority: 2,
        },
      });
      expect(dispatchedCommands[1]).toMatchObject({
        type: "thread.turn.start",
        threadId: (dispatchedCommands[0] as { threadId: ThreadId }).threadId,
        interactionMode: "default",
        message: {
          text: expect.stringContaining(
            "Use bd to create the epic swarm required for implementation",
          ),
        },
      });
      const messageText = (dispatchedCommands[1] as { message: { text: string } }).message.text;
      expect(messageText).toContain(
        "Do not describe this as a repair task because no swarm exists yet.",
      );
      expect(messageText).toContain(
        "Do not implement application code, and do not create a worktree unless tracker-only recovery is impossible.",
      );
    }),
  );

  it.effect("starts swarm repair planning when an invalid swarm already exists", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const dispatchedCommands: unknown[] = [];

      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "server",
          database: "repo",
          project_id: "project-1",
          role: "maintainer",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: "Break this into tasks",
            notes: "Coordinate across workers",
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: now,
            created_by: "alice",
            updated_at: now,
            labels: ["coordinator"],
            dependencies: [],
            dependents: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
        "swarm list": {
          swarms: [
            {
              swarm_id: "swarm-1",
              epic_id: "EPIC-1",
              epic_title: "Epic coordination",
              total_issue_count: 3,
              completed_issue_count: 0,
              active_issue_count: 0,
              ready_issue_count: 1,
              blocked_issue_count: 2,
              active_worker_count: 0,
            },
          ],
        },
        "swarm validate EPIC-1": {
          valid: false,
          swarm: {
            swarm_id: "swarm-1",
            epic_id: "EPIC-1",
            epic_title: "Epic coordination",
            total_issue_count: 3,
            completed_issue_count: 0,
            active_issue_count: 0,
            ready_issue_count: 1,
            blocked_issue_count: 2,
            active_worker_count: 0,
          },
          errors: ["Blocked issue graph is inconsistent."],
          warnings: [],
          ready_fronts: [],
          estimated_worker_sessions: 0,
          max_parallelism: 0,
        },
        "swarm status EPIC-1": {
          swarm: {
            swarm_id: "swarm-1",
            epic_id: "EPIC-1",
            epic_title: "Epic coordination",
            total_issue_count: 3,
            completed_issue_count: 0,
            active_issue_count: 0,
            ready_issue_count: 1,
            blocked_issue_count: 2,
            active_worker_count: 0,
          },
          completed: [],
          active: [],
          ready: [
            {
              id: "READY-1",
              title: "Ready child",
              status: "open",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
          blocked: [
            {
              id: "BLOCKED-1",
              title: "Blocked child",
              status: "blocked",
              priority: 2,
              issue_type: "task",
              assignee: null,
              owner: null,
            },
          ],
        },
      });
      mockedDispatch.mockImplementation((command: unknown) => {
        dispatchedCommands.push(command);
        return Effect.succeed({ sequence: dispatchedCommands.length });
      });

      const beads = yield* BeadsService;
      const result = yield* beads.startEpicPlanImplementation({
        cwd: "/repo",
        projectId: ProjectId.makeUnsafe("project-1"),
        epicIssueId: "EPIC-1",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        runtimeMode: "full-access",
      });

      assert.equal(result.created, true);
      expect(dispatchedCommands[0]).toMatchObject({
        type: "thread.create",
        title: "EPIC-1: Epic coordination (Repair swarm)",
      });
      const messageText = (dispatchedCommands[1] as { message: { text: string } }).message.text;
      expect(messageText).toContain(
        "Use bd to repair the existing epic swarm required for implementation",
      );
      expect(messageText).toContain(
        "Repair the current swarm instead of creating a replacement unless recovery is impossible.",
      );
    }),
  );

  it.effect("rejects epic implementation planning when swarm support is unavailable", () =>
    Effect.gen(function* () {
      installBdJsonMock({
        context: {
          beads_dir: "/repo/.beads",
          repo_root: "/repo",
          cwd_repo_root: "/repo",
          is_redirected: false,
          is_worktree: false,
          backend: "dolt",
          dolt_mode: "embedded",
          database: "repo",
          project_id: "project-1",
          role: "contributor",
          bd_version: "1.0.0",
        },
        "show EPIC-1 --long": [
          {
            id: "EPIC-1",
            title: "Epic coordination",
            description: null,
            notes: null,
            status: "open",
            priority: 2,
            issue_type: "epic",
            assignee: null,
            owner: "alice",
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: "alice",
            updated_at: "2026-01-01T00:00:00.000Z",
            labels: [],
            dependencies: [],
          },
        ],
        "comments EPIC-1": [],
        "history EPIC-1": [],
      });

      const beads = yield* BeadsService;
      const exit = yield* beads
        .startEpicPlanImplementation({
          cwd: "/repo",
          projectId: ProjectId.makeUnsafe("project-1"),
          epicIssueId: "EPIC-1",
          modelSelection: { provider: "codex", model: "gpt-5-codex" },
          runtimeMode: "full-access",
        })
        .pipe(Effect.exit);

      assert.strictEqual(exit._tag, "Failure");
      expect(mockedDispatch).not.toHaveBeenCalled();
    }),
  );
});
