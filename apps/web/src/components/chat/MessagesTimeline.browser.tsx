import "../../index.css";

import { EnvironmentId } from "@t3tools/contracts";
import { createRef } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const scrollToEndSpy = vi.fn();
const getStateSpy = vi.fn(() => ({ isAtEnd: true }));

vi.mock("@legendapp/list/react", async () => {
  const React = await import("react");

  function LegendList(props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode;
    ListFooterComponent?: React.ReactNode;
    ref?: React.Ref<LegendListRef>;
  }) {
    React.useImperativeHandle(
      props.ref,
      () =>
        ({
          scrollToEnd: scrollToEndSpy,
          getState: getStateSpy,
        }) as unknown as LegendListRef,
    );

    return (
      <div data-testid="legend-list">
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  }

  return { LegendList };
});

import { MessagesTimeline } from "./MessagesTimeline";
import { useUiStateStore } from "~/uiStateStore";

const MESSAGE_CREATED_AT = "2026-04-13T12:00:00.000Z";

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnId: null,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    completionDividerBeforeEntryId: null,
    completionSummary: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: vi.fn(),
    revertTurnCountByUserMessageId: new Map(),
    onRevertUserMessage: vi.fn(),
    onOpenBeadsIssue: vi.fn(),
    isRevertingCheckpoint: false,
    onImageExpand: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment-local"),
    markdownCwd: undefined,
    resolvedTheme: "dark" as const,
    timestampFormat: "24-hour" as const,
    workspaceRoot: undefined,
    onIsAtEndChange: vi.fn(),
  };
}

function buildLongUserMessageText(tail = "deep hidden detail only after expand") {
  return Array.from({ length: 9 }, (_, index) =>
    index === 8 ? tail : `Line ${index + 1}: ${"verbose prompt content ".repeat(8).trim()}`,
  ).join("\n");
}

function buildUserTimelineEntry(text: string) {
  return {
    id: "entry-1",
    kind: "message" as const,
    createdAt: MESSAGE_CREATED_AT,
    message: {
      id: "message-1" as never,
      role: "user" as const,
      text,
      createdAt: MESSAGE_CREATED_AT,
      streaming: false,
    },
  };
}

function buildSubagentTimelineEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "subagent-run-1",
    kind: "subagent-run" as const,
    createdAt: MESSAGE_CREATED_AT,
    subagentRun: {
      id: "subagent-run-1",
      threadId: "thread-1",
      turnId: "turn-1",
      parentItemId: "item-1",
      provider: "codex",
      title: "Implement nested panel",
      description: "Subagent implementation task",
      prompt: "Please inspect the current timeline and add the panel.",
      agentType: "implementation",
      model: "gpt-5-codex",
      reasoningEffort: "high",
      config: { sandboxMode: "workspace-write" },
      status: "completed",
      startedAt: "2026-04-13T12:00:00.000Z",
      completedAt: "2026-04-13T12:00:10.000Z",
      updatedAt: "2026-04-13T12:00:10.000Z",
      entries: [
        {
          id: "entry-a",
          runId: "subagent-run-1",
          kind: "assistant",
          title: "Analysis",
          text: "Found the timeline row shape.",
          payload: null,
          createdAt: "2026-04-13T12:00:02.000Z",
        },
        {
          id: "entry-b",
          runId: "subagent-run-1",
          kind: "result",
          title: "Result",
          text: "A very long result ".repeat(30),
          payload: null,
          createdAt: "2026-04-13T12:00:03.000Z",
        },
      ],
      ...overrides,
    } as never,
  };
}

describe("MessagesTimeline", () => {
  afterEach(() => {
    scrollToEndSpy.mockReset();
    getStateSpy.mockClear();
    useUiStateStore.setState({
      ...useUiStateStore.getState(),
      threadSubagentExpandedById: {},
    });
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders activity rows instead of the empty placeholder when a thread has non-message timeline data", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          {
            id: "work-1",
            kind: "work",
            createdAt: "2026-04-13T12:00:00.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-04-13T12:00:00.000Z",
              label: "thinking",
              detail: "Inspecting repository state",
              tone: "thinking",
            },
          },
        ]}
      />,
    );

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .not.toBeInTheDocument();
      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("snaps to the bottom when timeline rows appear after an initially empty render", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const props = buildProps();
    const screen = await render(<MessagesTimeline {...props} timelineEntries={[]} />);

    try {
      await expect
        .element(page.getByText("Send a message to start the conversation."))
        .toBeVisible();

      await screen.rerender(
        <MessagesTimeline
          {...props}
          timelineEntries={[
            {
              id: "work-1",
              kind: "work",
              createdAt: "2026-04-13T12:00:00.000Z",
              entry: {
                id: "work-1",
                createdAt: "2026-04-13T12:00:00.000Z",
                label: "thinking",
                detail: "Inspecting repository state",
                tone: "thinking",
              },
            },
          ]}
        />,
      );

      await expect.element(page.getByText("Thinking - Inspecting repository state")).toBeVisible();
      expect(props.onIsAtEndChange).toHaveBeenCalledWith(true);
      expect(scrollToEndSpy).toHaveBeenCalledWith({ animated: false });
      expect(requestAnimationFrameSpy).toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("starts long user messages collapsed by default", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    try {
      const toggle = page.getByRole("button", { name: "Show full message" });
      await expect.element(toggle).toBeVisible();
      await expect.element(toggle).toHaveAttribute("aria-expanded", "false");

      const messageBody = document.querySelector(
        "[data-user-message-body='true']",
      ) as HTMLDivElement | null;
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("true");
      expect(messageBody?.className).toContain("max-h-44");
      expect(messageBody?.className).toContain("overflow-hidden");
      expect(messageBody?.getAttribute("data-user-message-fade")).toBe("true");
      expect(messageBody?.style.maskImage).toContain("linear-gradient");
    } finally {
      await screen.unmount();
    }
  });

  it("expands and re-collapses long user messages from the toggle", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText())]}
      />,
    );

    try {
      const expandButton = page.getByRole("button", { name: "Show full message" });
      await expect.element(expandButton).toBeVisible();

      expect(document.body.textContent ?? "").toContain("deep hidden detail only after expand");

      await expandButton.click();

      const collapseButton = page.getByRole("button", { name: "Show less" });
      await expect.element(collapseButton).toBeVisible();
      await expect.element(collapseButton).toHaveAttribute("aria-expanded", "true");

      let messageBody = document.querySelector("[data-user-message-body='true']");
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("false");
      expect(messageBody?.className).not.toContain("max-h-44");
      expect(messageBody?.getAttribute("data-user-message-fade")).toBe("false");
      expect((messageBody as HTMLDivElement | null)?.style.maskImage ?? "").toBe("");

      await collapseButton.click();

      await expect.element(page.getByRole("button", { name: "Show full message" })).toBeVisible();
      messageBody = document.querySelector("[data-user-message-body='true']");
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("true");
      expect(messageBody?.className).toContain("max-h-44");
      expect(messageBody?.getAttribute("data-user-message-fade")).toBe("true");
      expect((messageBody as HTMLDivElement | null)?.style.maskImage).toContain("linear-gradient");
    } finally {
      await screen.unmount();
    }
  });

  it("starts the newest long user prompt collapsed", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[buildUserTimelineEntry(buildLongUserMessageText("latest long prompt"))]}
      />,
    );

    try {
      await expect.element(page.getByRole("button", { name: "Show full message" })).toBeVisible();

      const messageBody = document.querySelector("[data-user-message-body='true']");
      expect(messageBody?.getAttribute("data-user-message-collapsed")).toBe("true");
    } finally {
      await screen.unmount();
    }
  });

  it("collapses completed subagent panels by default and expands from the header button", async () => {
    const screen = await render(
      <MessagesTimeline {...buildProps()} timelineEntries={[buildSubagentTimelineEntry()]} />,
    );

    try {
      const expandButton = page.getByRole("button", { name: "Expand subagent subagent-run-1" });
      await expect.element(expandButton).toBeVisible();
      await expect.element(expandButton).toHaveAttribute("aria-expanded", "false");
      await expect.element(page.getByText("Found the timeline row shape.")).not.toBeInTheDocument();

      await expandButton.click();

      await expect
        .element(page.getByRole("button", { name: "Collapse subagent subagent-run-1" }))
        .toHaveAttribute("aria-expanded", "true");
      await expect
        .element(page.getByText("Please inspect the current timeline and add the panel."))
        .toBeVisible();
      await expect.element(page.getByText("Found the timeline row shape.")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("uses persisted subagent toggles instead of status defaults", async () => {
    useUiStateStore
      .getState()
      .setThreadSubagentExpanded("environment-local:thread-1", "subagent-run-1", true);

    const screen = await render(
      <MessagesTimeline {...buildProps()} timelineEntries={[buildSubagentTimelineEntry()]} />,
    );

    try {
      await expect
        .element(page.getByRole("button", { name: "Collapse subagent subagent-run-1" }))
        .toHaveAttribute("aria-expanded", "true");
      await expect.element(page.getByText("Found the timeline row shape.")).toBeVisible();

      await page.getByRole("button", { name: "Collapse subagent subagent-run-1" }).click();
      expect(
        useUiStateStore.getState().threadSubagentExpandedById["environment-local:thread-1"]?.[
          "subagent-run-1"
        ],
      ).toBe(false);
    } finally {
      await screen.unmount();
    }
  });

  it("defaults active empty subagent panels open with an empty-state row", async () => {
    const screen = await render(
      <MessagesTimeline
        {...buildProps()}
        timelineEntries={[
          buildSubagentTimelineEntry({
            status: "running",
            completedAt: null,
            entries: [],
          }),
        ]}
      />,
    );

    try {
      await expect
        .element(page.getByRole("button", { name: "Collapse subagent subagent-run-1" }))
        .toHaveAttribute("aria-expanded", "true");
      await expect
        .element(page.getByText("Waiting for attributed subagent output..."))
        .toBeVisible();
    } finally {
      await screen.unmount();
    }
  });
});
