import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { beadsQueryKeys } from "../lib/beadsReactQuery";

const { openInPreferredEditorMock, readLocalApiMock } = vi.hoisted(() => ({
  openInPreferredEditorMock: vi.fn(async () => "vscode"),
  readLocalApiMock: vi.fn(() => ({
    server: { getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })) },
    shell: { openInEditor: vi.fn(async () => undefined) },
  })),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorMock,
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import ChatMarkdown from "./ChatMarkdown";

function renderWithQueryClient(element: ReactElement, queryClient = new QueryClient()) {
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe("ChatMarkdown", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("rewrites file uri hrefs into direct paths before rendering", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await renderWithQueryClient(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath})`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), filePath);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps line anchors working after rewriting file uri hrefs", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await renderWithQueryClient(
      <ChatMarkdown text={`[PermissionRule.ts:1](file://${filePath}#L1)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), `${filePath}:1`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("shows column information inline when present", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await renderWithQueryClient(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath}#L1C7)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1:C7" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1:7`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          `${filePath}:1:7`,
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("disambiguates duplicate file basenames inline", async () => {
    const firstPath = "/Users/yashsingh/p/t3code/apps/web/src/components/chat/MessagesTimeline.tsx";
    const secondPath = "/Users/yashsingh/p/t3code/apps/web/src/components/MessagesTimeline.tsx";
    const screen = await renderWithQueryClient(
      <ChatMarkdown
        text={`See [MessagesTimeline.tsx](file://${firstPath}) and [MessagesTimeline.tsx](file://${secondPath}).`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · components/chat" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · src/components" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps normal web links unchanged", async () => {
    const screen = await renderWithQueryClient(
      <ChatMarkdown text="[OpenAI](https://openai.com/docs)" cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "OpenAI" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", "https://openai.com/docs");
      await expect.element(link).toHaveAttribute("target", "_blank");
    } finally {
      await screen.unmount();
    }
  });

  it("keeps missing beads issue metadata as plain text", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(beadsQueryKeys.context({ cwd: "/repo/project" }), {
      beadsDir: "/repo/project/.beads",
      repoRoot: "/repo/project",
      cwdRepoRoot: "/repo/project",
      isRedirected: false,
      isWorktree: false,
      backend: {
        kind: "dolt",
        doltMode: "server",
        database: "repo",
        projectId: "t3code",
        role: "maintainer",
        bdVersion: "1.0.0",
      },
    });
    queryClient.setQueryData(beadsQueryKeys.issueRefs("/repo/project", ["t3code-missing"]), {
      issues: [],
      missingIssueIds: ["t3code-missing"],
      loadErrors: [],
    });

    const screen = await renderWithQueryClient(
      <ChatMarkdown text="See t3code-missing." cwd="/repo/project" enableBeadsIssueLinks />,
      queryClient,
    );

    try {
      await expect.element(page.getByText("See t3code-missing.")).toBeInTheDocument();
      await expect.element(page.getByRole("button")).not.toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("does not transform beads issue ids inside code blocks", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(beadsQueryKeys.context({ cwd: "/repo/project" }), {
      beadsDir: "/repo/project/.beads",
      repoRoot: "/repo/project",
      cwdRepoRoot: "/repo/project",
      isRedirected: false,
      isWorktree: false,
      backend: {
        kind: "dolt",
        doltMode: "server",
        database: "repo",
        projectId: "t3code",
        role: "maintainer",
        bdVersion: "1.0.0",
      },
    });
    queryClient.setQueryData(beadsQueryKeys.issueRefs("/repo/project", ["t3code-dci"]), {
      issues: [
        {
          id: "t3code-dci",
          title: "Merge nightly",
          status: "open",
          issueType: "task",
        },
      ],
      missingIssueIds: [],
      loadErrors: [],
    });

    const screen = await renderWithQueryClient(
      <ChatMarkdown text="`t3code-dci`" cwd="/repo/project" enableBeadsIssueLinks />,
      queryClient,
    );

    try {
      await expect.element(page.getByText("t3code-dci")).toBeInTheDocument();
      await expect.element(page.getByRole("button")).not.toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });
});
