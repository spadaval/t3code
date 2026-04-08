import type {
  BeadsIssueDependency,
  BeadsIssueDetail,
  BeadsIssueSummary,
  OrchestrationSwarmSchedulerMode,
  OrchestrationSwarmWorkspaceMode,
  OrchestrationThreadIssueLink,
  SwarmRunId,
  SwarmTaskExecutionId,
  ThreadId,
} from "@t3tools/contracts";
import path from "node:path";

function formatDependencies(dependencies: ReadonlyArray<BeadsIssueDependency>): string {
  if (dependencies.length === 0) {
    return "None";
  }

  return dependencies
    .map((dependency) => `- ${dependency.id}: ${dependency.title} [${dependency.status}]`)
    .join("\n");
}

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
  issue: BeadsIssueDetail;
  epicIssueId: string;
  runId: SwarmRunId;
  executionId: SwarmTaskExecutionId;
  schedulerMode: OrchestrationSwarmSchedulerMode;
  workspaceMode: OrchestrationSwarmWorkspaceMode;
  sequenceNumber: number;
}): string {
  const sections = [
    `Epic: ${input.epicIssueId}`,
    `Run: ${input.runId}`,
    `Execution: ${input.executionId}`,
    `Sequence: ${input.sequenceNumber}`,
    `Scheduler mode: ${input.schedulerMode}`,
    `Workspace mode: ${input.workspaceMode}`,
    "",
    `Issue: ${input.issue.id}`,
    `Title: ${input.issue.title}`,
    `Status: ${input.issue.status}`,
    `Priority: ${input.issue.priority === null ? "unset" : `P${input.issue.priority}`}`,
    "",
    "Description:",
    input.issue.description?.trim().length ? input.issue.description : "None",
    "",
    "Notes:",
    input.issue.notes?.trim().length ? input.issue.notes : "None",
    "",
    "Labels:",
    input.issue.labels.length > 0 ? input.issue.labels.join(", ") : "None",
    "",
    "Dependencies:",
    formatDependencies(input.issue.dependencies),
    "",
    "Implement this issue in the shared workspace.",
    "When the issue is fully complete, close the Beads issue yourself to signal completion.",
    "Do not create a branch or worktree for this swarm worker.",
    "Keep Beads tracking aligned with the code work and summarize any follow-up items that should be recorded back into the tracker.",
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
