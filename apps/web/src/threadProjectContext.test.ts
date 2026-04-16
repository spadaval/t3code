import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveThreadProjectContext } from "./threadProjectContext";
import type { DraftThreadState } from "./composerDraftStore";
import type { Project, Thread } from "./types";

const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const THREAD_ID = ThreadId.makeUnsafe("thread-1");

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    environmentId: "env-1" as Project["environmentId"],
    id: PROJECT_ID,
    name: "t3code",
    cwd: "/repo",
    defaultModelSelection: null,
    scripts: [],
    ...overrides,
  } as Project;
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: THREAD_ID,
    environmentId: "env-1" as Thread["environmentId"],
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: {
      provider: "codex",
      model: "gpt-5-codex",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-08T00:00:00Z",
    archivedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    issueLink: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  } as Thread;
}

function makeDraftThread(overrides: Partial<DraftThreadState> = {}): DraftThreadState {
  return {
    threadId: THREAD_ID,
    environmentId: "env-1" as DraftThreadState["environmentId"],
    projectId: PROJECT_ID,
    createdAt: "2026-04-08T00:00:00Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    ...overrides,
  } as DraftThreadState;
}

describe("resolveThreadProjectContext", () => {
  it("prefers the persisted thread project when both thread types are present", () => {
    const project = makeProject();
    const persistedThread = makeThread();
    const draftThread = makeDraftThread({
      projectId: ProjectId.makeUnsafe("project-draft"),
    });

    expect(
      resolveThreadProjectContext({
        thread: persistedThread,
        draftThread,
        project,
      }),
    ).toEqual({
      thread: persistedThread,
      draftThread,
      projectId: PROJECT_ID,
      project,
    });
  });

  it("falls back to the draft thread project when the server thread is missing", () => {
    const project = makeProject();
    const draftThread = makeDraftThread();

    expect(
      resolveThreadProjectContext({
        thread: undefined,
        draftThread,
        project,
      }),
    ).toEqual({
      thread: undefined,
      draftThread,
      projectId: PROJECT_ID,
      project,
    });
  });

  it("returns a null project id when neither persisted nor draft thread exists", () => {
    expect(
      resolveThreadProjectContext({
        thread: undefined,
        draftThread: null,
        project: undefined,
      }),
    ).toEqual({
      thread: undefined,
      draftThread: null,
      projectId: null,
      project: undefined,
    });
  });
});
