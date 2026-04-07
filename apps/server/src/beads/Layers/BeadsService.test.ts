import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { afterEach, expect, vi } from "vitest";

vi.mock("../../processRunner", () => ({
  runProcess: vi.fn(),
}));

import { runProcess } from "../../processRunner";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { BeadsService } from "../Services/BeadsService.ts";
import { BeadsServiceLive } from "./BeadsService.ts";

const mockedRunProcess = vi.mocked(runProcess);
const mockedGetReadModel = vi.fn(() =>
  Effect.succeed({
    snapshotSequence: 0,
    updatedAt: new Date().toISOString(),
    planImplementationLaunches: [],
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

const layer = it.layer(BeadsServiceLive.pipe(Layer.provide(orchestrationEngineLayer)));

afterEach(() => {
  mockedRunProcess.mockReset();
  mockedGetReadModel.mockReset();
  mockedDispatch.mockReset();
  mockedGetReadModel.mockImplementation(() =>
    Effect.succeed({
      snapshotSequence: 0,
      updatedAt: new Date().toISOString(),
      planImplementationLaunches: [],
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
  it.effect("serializes bd access per repository", () =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      let activeCalls = 0;
      let maxActiveCalls = 0;

      mockedRunProcess.mockImplementation(async (_command, args) => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          const action = args[0];
          if (action === "show") {
            return {
              stdout: JSON.stringify([
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
              ]),
              stderr: "",
              code: 0,
              signal: null,
              timedOut: false,
            };
          }

          if (action === "comments" || action === "history") {
            return {
              stdout: "[]",
              stderr: "",
              code: 0,
              signal: null,
              timedOut: false,
            };
          }

          throw new Error(`Unexpected bd args: ${args.join(" ")}`);
        } finally {
          activeCalls -= 1;
        }
      });

      const beads = yield* BeadsService;
      const [left, right] = yield* Effect.all(
        [
          beads.getIssue({ cwd: "/repo", issueId: "ISS-1" }),
          beads.getIssue({ cwd: "/repo", issueId: "ISS-1" }),
        ],
        { concurrency: "unbounded" },
      );

      assert.equal(left.id, "ISS-1");
      assert.equal(right.id, "ISS-1");
      expect(mockedRunProcess).toHaveBeenCalledTimes(6);
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

  it.effect("starts epic implementation planning in a tracker-only linked thread", () =>
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
        title: "EPIC-1: Epic coordination (Plan implementation)",
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
            "create or repair the epic swarm required for implementation",
          ),
        },
      });
      expect((dispatchedCommands[1] as { message: { text: string } }).message.text).toContain(
        "Do not implement application code, and do not create a worktree unless tracker-only recovery is impossible.",
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
