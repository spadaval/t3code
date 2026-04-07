import { ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { listIssueLinkedThreads, type IssueThreadCandidate } from "./issueThreads";

function makeThread(overrides: Partial<IssueThreadCandidate>): IssueThreadCandidate {
  return {
    id: ThreadId.makeUnsafe("thread-default"),
    projectId: ProjectId.makeUnsafe("project-default"),
    title: "Thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    issueLink: null,
    ...overrides,
  };
}

describe("listIssueLinkedThreads", () => {
  it("returns only threads linked to the selected issue in the same project", () => {
    const projectId = ProjectId.makeUnsafe("project-1");

    const threads = [
      makeThread({
        id: ThreadId.makeUnsafe("thread-1"),
        projectId,
        issueLink: { issueId: "ISS-1" },
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-2"),
        projectId,
        issueLink: { issueId: "ISS-2" },
      }),
      makeThread({
        id: ThreadId.makeUnsafe("thread-3"),
        projectId: ProjectId.makeUnsafe("project-2"),
        issueLink: { issueId: "ISS-1" },
      }),
    ];

    expect(listIssueLinkedThreads({ threads, projectId, issueId: "ISS-1" })).toEqual([threads[0]]);
  });

  it("sorts active threads before archived threads, then by most recently updated", () => {
    const projectId = ProjectId.makeUnsafe("project-1");

    const activeOlder = makeThread({
      id: ThreadId.makeUnsafe("thread-active-older"),
      projectId,
      updatedAt: "2026-01-02T00:00:00.000Z",
      issueLink: { issueId: "ISS-1" },
    });
    const activeNewer = makeThread({
      id: ThreadId.makeUnsafe("thread-active-newer"),
      projectId,
      updatedAt: "2026-01-03T00:00:00.000Z",
      issueLink: { issueId: "ISS-1" },
    });
    const archivedNewest = makeThread({
      id: ThreadId.makeUnsafe("thread-archived"),
      projectId,
      archivedAt: "2026-01-04T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z",
      issueLink: { issueId: "ISS-1" },
    });

    expect(
      listIssueLinkedThreads({
        threads: [activeOlder, archivedNewest, activeNewer],
        projectId,
        issueId: "ISS-1",
      }),
    ).toEqual([activeNewer, activeOlder, archivedNewest]);
  });

  it("returns an empty list when the project or issue is unavailable", () => {
    const threads = [makeThread({ issueLink: { issueId: "ISS-1" } })];

    expect(
      listIssueLinkedThreads({
        threads,
        projectId: null,
        issueId: "ISS-1",
      }),
    ).toEqual([]);
    expect(
      listIssueLinkedThreads({
        threads,
        projectId: ProjectId.makeUnsafe("project-1"),
        issueId: null,
      }),
    ).toEqual([]);
  });
});
