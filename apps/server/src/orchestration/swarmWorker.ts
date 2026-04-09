import type {
  BeadsIssueSummary,
  OrchestrationSwarmSchedulerMode,
  OrchestrationSwarmWorkspaceMode,
  OrchestrationThreadIssueLink,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
} from "@t3tools/contracts";
import path from "node:path";

export function buildSwarmIssueLink(input: {
  issue: BeadsIssueSummary;
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

export function buildSwarmWorkerThreadTitle(issue: BeadsIssueSummary): string {
  return `${issue.id}: ${issue.title} (Swarm worker)`;
}

export function buildSwarmWorkerPrompt(input: {
  issueId: string;
  issueTitle: string;
  epicIssueId: string;
  runId: SwarmRunId;
  executionId: SwarmTaskExecutionId;
  schedulerMode: OrchestrationSwarmSchedulerMode;
  workspaceMode: OrchestrationSwarmWorkspaceMode;
  sequenceNumber: number;
}): string {
  const sections = [
    "## Assignment",
    "",
    `You are a swarm worker implementing issue ${input.issueId}: ${input.issueTitle}`,
    `This issue belongs to epic ${input.epicIssueId}.`,
    "",
    "## Getting started",
    "",
    `Run \`bd show ${input.issueId}\` to read the full issue details, including description, notes, dependencies, and comments.`,
    "Understand the requirements thoroughly before writing any code.",
    "",
    "## Rules",
    "",
    "- Implement the issue in the shared workspace. Do NOT create a branch or worktree.",
    "- Stay focused on this issue. Do not work on unrelated changes.",
    "- Follow the project's existing patterns, conventions, and quality standards.",
    "- Commit your work with clear, descriptive commit messages.",
    "- When done, push your commits: `git pull --rebase && git push`.",
    "",
    "## Completion",
    "",
    `- When the issue is fully implemented, close it with \`bd close ${input.issueId}\`.`,
    "- Closing the issue signals the swarm coordinator that this worker has finished.",
    "- If you discover follow-up work that is out of scope, file new issues with `bd` rather than expanding the scope of this task.",
    "",
    "## Context",
    "",
    `Run: ${input.runId} | Execution: ${input.executionId} | Sequence: ${input.sequenceNumber}`,
    `Scheduler: ${input.schedulerMode} | Workspace: ${input.workspaceMode}`,
  ];

  return sections.join("\n");
}

export function buildSwarmExecutionComment(input: {
  phase: "started" | "completed" | "failed" | "cancelled";
  epicIssueId: string;
  runId: SwarmRunId;
  executionId: SwarmTaskExecutionId;
  workerThreadId: ThreadId;
  schedulerMode: OrchestrationSwarmSchedulerMode;
  workspaceMode: OrchestrationSwarmWorkspaceMode;
  reason?: string;
}): string {
  const heading =
    input.phase === "started"
      ? "Swarm worker started."
      : input.phase === "completed"
        ? "Swarm worker completed."
        : input.phase === "failed"
          ? "Swarm worker failed."
          : "Swarm worker cancelled.";

  const sections = [
    heading,
    `- epic: ${input.epicIssueId}`,
    `- run: ${input.runId}`,
    `- execution: ${input.executionId}`,
    `- workerThread: ${input.workerThreadId}`,
    `- schedulerMode: ${input.schedulerMode}`,
    `- workspaceMode: ${input.workspaceMode}`,
  ];

  if (input.reason?.trim()) {
    sections.push(`- reason: ${input.reason.trim()}`);
  }

  return sections.join("\n");
}
