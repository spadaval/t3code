import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { getIssuePaneState, useIssuePaneStore } from "./issuePaneStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");

describe("issuePaneStore", () => {
  beforeEach(() => {
    useIssuePaneStore.setState({
      byThreadId: {},
      setSelectedIssueId: useIssuePaneStore.getState().setSelectedIssueId,
      setSearch: useIssuePaneStore.getState().setSearch,
      setScope: useIssuePaneStore.getState().setScope,
      resetThreadState: useIssuePaneStore.getState().resetThreadState,
    });
  });

  it("defaults each thread to the lightweight sidebar issue state", () => {
    expect(getIssuePaneState(THREAD_A)).toEqual({
      selectedIssueId: null,
      search: "",
      scope: "active",
    });
  });

  it("stores thread selections independently", () => {
    const store = useIssuePaneStore.getState();
    store.setSelectedIssueId(THREAD_A, "TASK-1");
    store.setSelectedIssueId(THREAD_B, "TASK-2");

    expect(getIssuePaneState(THREAD_A).selectedIssueId).toBe("TASK-1");
    expect(getIssuePaneState(THREAD_B).selectedIssueId).toBe("TASK-2");
  });

  it("stores search and scope independently per thread", () => {
    const store = useIssuePaneStore.getState();
    store.setSearch(THREAD_A, "parser");
    store.setScope(THREAD_A, "closed");

    expect(getIssuePaneState(THREAD_A)).toMatchObject({
      search: "parser",
      scope: "closed",
    });
  });

  it("can reset a thread state back to defaults", () => {
    const store = useIssuePaneStore.getState();
    store.setSelectedIssueId(THREAD_A, "TASK-1");
    store.setSearch(THREAD_A, "parser");
    store.resetThreadState(THREAD_A);

    expect(getIssuePaneState(THREAD_A)).toEqual({
      selectedIssueId: null,
      search: "",
      scope: "active",
    });
  });
});
