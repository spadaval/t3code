import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { getIssuePaneState, useIssuePaneStore } from "./issuePaneStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");

describe("issuePaneStore", () => {
  beforeEach(() => {
    useIssuePaneStore.setState({
      byThreadId: {},
      setActivePanelTab: useIssuePaneStore.getState().setActivePanelTab,
      setSelectedIssueId: useIssuePaneStore.getState().setSelectedIssueId,
      setSearch: useIssuePaneStore.getState().setSearch,
      setScope: useIssuePaneStore.getState().setScope,
    });
  });

  it("defaults each thread to the issues panel tab", () => {
    expect(getIssuePaneState(THREAD_A)).toMatchObject({
      activePanelTab: "issues",
      selectedIssueId: null,
      search: "",
      scope: "active",
    });
  });

  it("stores active panel tabs independently per thread", () => {
    const store = useIssuePaneStore.getState();
    store.setActivePanelTab(THREAD_A, "coordinator");
    store.setActivePanelTab(THREAD_B, "issues");

    expect(getIssuePaneState(THREAD_A).activePanelTab).toBe("coordinator");
    expect(getIssuePaneState(THREAD_B).activePanelTab).toBe("issues");
  });

  it("does not clear the selected issue when switching top-level tabs", () => {
    const store = useIssuePaneStore.getState();
    store.setSelectedIssueId(THREAD_A, "beads-123");
    store.setActivePanelTab(THREAD_A, "coordinator");

    expect(getIssuePaneState(THREAD_A)).toMatchObject({
      activePanelTab: "coordinator",
      selectedIssueId: "beads-123",
    });
  });
});
