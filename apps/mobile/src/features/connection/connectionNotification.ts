import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";

import type { WorkspaceEnvironment } from "../../state/workspaceModel";

export interface ConnectionNotificationContent {
  readonly title: string;
  readonly text: string;
}

type NotificationThread = Pick<
  EnvironmentThreadShell,
  "title" | "runtime" | "hasPendingApprovals" | "hasPendingUserInput" | "pendingSubagentRequest"
>;

function needsYou(thread: NotificationThread): boolean {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null
  );
}

function connectionTitle(environments: ReadonlyArray<WorkspaceEnvironment>): string {
  const enabled = environments.filter((environment) => environment.isEnabled);
  const connected = enabled.filter((environment) => environment.connectionState === "connected");
  if (connected.length === enabled.length) {
    return connected.length === 1
      ? `Connected to ${connected[0]!.environmentLabel}`
      : `Connected to ${connected.length} environments`;
  }
  const waiting = enabled.find((environment) => environment.connectionState !== "connected");
  return `Reconnecting to ${waiting!.environmentLabel}`;
}

/** What the ongoing Android notification shows, or null when nothing is paired. */
export function connectionNotificationContent(
  environments: ReadonlyArray<WorkspaceEnvironment>,
  threads: ReadonlyArray<NotificationThread>,
): ConnectionNotificationContent | null {
  if (!environments.some((environment) => environment.isEnabled)) return null;
  const waiting = threads.filter(needsYou);
  const running = threads.filter(
    (thread) => !needsYou(thread) && threadRuntimeIsActive(thread.runtime),
  );
  const counts = [
    waiting.length > 0 ? `${waiting.length} need${waiting.length === 1 ? "s" : ""} you` : null,
    running.length > 0 ? `${running.length} running` : null,
  ].filter((part) => part !== null);
  const lines = [
    counts.length === 0 ? "No agents running" : counts.join(" · "),
    ...waiting.slice(0, 2).map((thread) => `Needs you: ${thread.title}`),
    ...running
      .slice(0, 3 - Math.min(waiting.length, 2))
      .map((thread) => `Running: ${thread.title}`),
  ];
  return { title: connectionTitle(environments), text: lines.join("\n") };
}
