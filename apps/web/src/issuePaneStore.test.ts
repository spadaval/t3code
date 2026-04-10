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
      setShowClosed: useIssuePaneStore.getState().setShowClosed,
      setSortBy: useIssuePaneStore.getState().setSortBy,
      resetThreadState: useIssuePaneStore.getState().resetThreadState,
    });
  });

  it("defaults each thread to the lightweight sidebar issue state", () => {
    expect(getIssuePaneState(THREAD_A)).toEqual({
      selectedIssueId: null,
      search: "",
      showClosed: false,
      sortBy: "updated",
    });
  });

  it("stores thread selections independently", () => {
    const store = useIssuePaneStore.getState();
    store.setSelectedIssueId(THREAD_A, "TASK-1");
    store.setSelectedIssueId(THREAD_B, "TASK-2");

    expect(getIssuePaneState(THREAD_A).selectedIssueId).toBe("TASK-1");
    expect(getIssuePaneState(THREAD_B).selectedIssueId).toBe("TASK-2");
  });

  it("stores search, closed visibility, and sort independently per thread", () => {
    const store = useIssuePaneStore.getState();
    store.setSearch(THREAD_A, "parser");
    store.setShowClosed(THREAD_A, true);
    store.setSortBy(THREAD_A, "created");

    expect(getIssuePaneState(THREAD_A)).toMatchObject({
      search: "parser",
      showClosed: true,
      sortBy: "created",
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
      showClosed: false,
      sortBy: "updated",
    });
  });
});
