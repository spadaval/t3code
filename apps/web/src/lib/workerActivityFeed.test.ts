import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { EventId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { deriveWorkerFeedEntries } from "./workerActivityFeed";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeActivity(
  overrides: Omit<Partial<OrchestrationThreadActivity>, "id"> & {
    id: string;
    kind: string;
    summary: string;
  },
): OrchestrationThreadActivity {
  return {
    tone: "info",
    payload: null,
    turnId: null,
    createdAt: "2026-04-08T00:00:00.000Z",
    ...overrides,
    id: EventId.makeUnsafe(overrides.id),
  } as OrchestrationThreadActivity;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("deriveWorkerFeedEntries", () => {
  it("returns empty array for no activities", () => {
    expect(deriveWorkerFeedEntries([])).toEqual([]);
  });

  it("converts a basic activity to a feed entry", () => {
    const activities = [
      makeActivity({ id: "a1", kind: "turn.plan.updated", summary: "Planning step 1" }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Planning step 1");
    expect(entries[0]?.tone).toBe("info");
  });

  it("filters out context-window.updated activities", () => {
    const activities = [
      makeActivity({ id: "a1", kind: "context-window.updated", summary: "Token usage updated" }),
      makeActivity({ id: "a2", kind: "tool.completed", summary: "Read file" }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("tool.completed");
  });

  it("filters out Checkpoint captured activities", () => {
    const activities = [
      makeActivity({ id: "a1", kind: "tool.completed", summary: "Checkpoint captured" }),
      makeActivity({ id: "a2", kind: "tool.completed", summary: "Read file" }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("Read file");
  });

  it("extracts detail from payload", () => {
    const activities = [
      makeActivity({
        id: "a1",
        kind: "tool.completed",
        summary: "Ran command",
        payload: { detail: "ls -la" },
      }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries[0]?.detail).toBe("ls -la");
  });

  it("collapses tool lifecycle pairs with matching collapse keys", () => {
    const activities = [
      makeActivity({
        id: "a1",
        kind: "tool.updated",
        summary: "Running bash",
        payload: { itemType: "shell", detail: "npm test" },
        sequence: 1,
      }),
      makeActivity({
        id: "a2",
        kind: "tool.completed",
        summary: "Completed bash",
        payload: { itemType: "shell", detail: "npm test" },
        sequence: 2,
      }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    // Should collapse to a single entry (the completed one).
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("tool.completed");
  });

  it("does not collapse entries with different collapse keys", () => {
    const activities = [
      makeActivity({
        id: "a1",
        kind: "tool.updated",
        summary: "Running bash",
        payload: { itemType: "shell", detail: "npm test" },
        sequence: 1,
      }),
      makeActivity({
        id: "a2",
        kind: "tool.completed",
        summary: "Reading file",
        payload: { itemType: "file-read", detail: "src/index.ts" },
        sequence: 2,
      }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries).toHaveLength(2);
  });

  it("sorts by sequence number", () => {
    const activities = [
      makeActivity({
        id: "a2",
        kind: "tool.completed",
        summary: "Second",
        sequence: 2,
        createdAt: "2026-04-08T00:00:02.000Z",
      }),
      makeActivity({
        id: "a1",
        kind: "tool.completed",
        summary: "First",
        sequence: 1,
        createdAt: "2026-04-08T00:00:01.000Z",
      }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries[0]?.label).toBe("First");
    expect(entries[1]?.label).toBe("Second");
  });

  it("maps approval tone correctly", () => {
    const activities = [
      makeActivity({
        id: "a1",
        kind: "approval.requested",
        summary: "Approve command",
        tone: "approval",
      }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries[0]?.tone).toBe("approval");
  });

  it("preserves error tone", () => {
    const activities = [
      makeActivity({
        id: "a1",
        kind: "runtime.error",
        summary: "Process crashed",
        tone: "error",
      }),
    ];
    const entries = deriveWorkerFeedEntries(activities);
    expect(entries[0]?.tone).toBe("error");
  });
});
