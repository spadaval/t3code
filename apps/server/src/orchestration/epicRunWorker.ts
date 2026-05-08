import type {
  OrchestrationThreadIssueLink,
  EpicRunId,
  EpicIssueExecutionId,
  ThreadId,
} from "@t3tools/contracts";
import path from "node:path";

export function buildEpicRunIssueLink(input: {
  issue: {
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly priority: number | null;
  };
  cwd: string;
  linkedAt: string;
}): OrchestrationThreadIssueLink {
  return {
    issueId: input.issue.id,
    title: input.issue.title,
    status: input.issue.status,
    priority: input.issue.priority,
    repoRoot: path.resolve(input.cwd),
    linkedAt: input.linkedAt,
  };
}

export function buildEpicRunWorkerThreadTitle(issue: {
  readonly id: string;
  readonly title: string;
}): string {
  return `${issue.id}: ${issue.title} (Epic-run worker)`;
}

export function buildEpicRunWorkerPrompt(input: {
  issueId: string;
  issueTitle: string;
  epicIssueId: string;
  runId: EpicRunId;
  executionId: EpicIssueExecutionId;
  sequenceNumber: number;
}): string {
  const sections = [
    "## Assignment",
    "",
    `You are an epic-run worker implementing issue ${input.issueId}: ${input.issueTitle}`,
    `This issue belongs to epic ${input.epicIssueId}.`,
    "",
    "## Getting started",
    "",
    `Run \`bd show ${input.issueId}\` to read the full issue details, including description, notes, dependencies, and comments.`,
    "Understand the requirements thoroughly before writing any code.",
    "",
    "## Rules",
    "",
    "- Implement the issue in the assigned project workspace. Do NOT create a branch or worktree.",
    "- Stay focused on this issue. Do not work on unrelated changes.",
    "- Follow the project's existing patterns, conventions, and quality standards.",
    "- Before closing the issue, run `git status --short` to inspect the shared worktree.",
    "- Stage all uncommitted files with `git add -A`, including residual or unrelated shared-worktree changes left by earlier epic workers.",
    "- Commit all uncommitted files with a clear, descriptive commit message.",
    "- Verify `git status --short` is empty before closing the issue.",
    "- When done, push your commits: `git pull --rebase && git push`.",
    "",
    "## Completion",
    "",
    `- When the issue is fully implemented, close it with \`bd close ${input.issueId}\`.`,
    "- Closing the issue signals the epic-run coordinator that this worker has finished.",
    "- If you discover follow-up work that is out of scope, file new issues with `bd` rather than expanding the scope of this task.",
    "",
    "## Context",
    "",
    `Run: ${input.runId} | Execution: ${input.executionId} | Sequence: ${input.sequenceNumber}`,
  ];

  return sections.join("\n");
}

export function buildEpicRunExecutionComment(input: {
  phase: "started" | "completed" | "failed" | "cancelled";
  epicIssueId: string;
  runId: EpicRunId;
  executionId: EpicIssueExecutionId;
  workerThreadId: ThreadId;
  reason?: string;
}): string {
  const heading =
    input.phase === "started"
      ? "Epic-run worker started."
      : input.phase === "completed"
        ? "Epic-run worker completed."
        : input.phase === "failed"
          ? "Epic-run worker failed."
          : "Epic-run worker cancelled.";

  const sections = [
    heading,
    `- epic: ${input.epicIssueId}`,
    `- run: ${input.runId}`,
    `- execution: ${input.executionId}`,
    `- workerThread: ${input.workerThreadId}`,
  ];

  if (input.reason?.trim()) {
    sections.push(`- reason: ${input.reason.trim()}`);
  }

  return sections.join("\n");
}
