import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  HammerIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  Settings2Icon,
  TerminalSquareIcon,
} from "lucide-react";
import { formatElapsed } from "../../session-logic";
import { type SubagentEntry, type SubagentRun } from "../../types";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";

interface SubagentPanelProps {
  routeThreadKey: string;
  run: SubagentRun;
}

export const SubagentPanel = memo(function SubagentPanel({
  routeThreadKey,
  run,
}: SubagentPanelProps) {
  const explicitExpanded = useUiStateStore(
    (store) => store.threadSubagentExpandedById[routeThreadKey]?.[run.id],
  );
  const setExpanded = useUiStateStore((store) => store.setThreadSubagentExpanded);
  const defaultExpanded = run.status === "running";
  const isExpanded = explicitExpanded ?? defaultExpanded;
  const duration = useSubagentDuration(run);
  const attributedEntries = run.entries.filter((entry) => entry.text.trim().length > 0);
  const detailChips = buildSubagentDetailChips(run, duration);
  const showActiveEmptyState = run.status === "running" && run.entries.length === 0;
  const ToggleIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;
  const StatusIcon = subagentStatusIcon(run.status);

  return (
    <section
      className="overflow-hidden rounded-xl border border-border/70 bg-card/50"
      data-subagent-panel="true"
      data-subagent-run-id={run.id}
      data-subagent-expanded={isExpanded ? "true" : "false"}
    >
      <div className="flex min-w-0 items-start gap-2 px-2.5 py-2">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="mt-0.5 shrink-0"
          aria-label={isExpanded ? `Collapse subagent ${run.id}` : `Expand subagent ${run.id}`}
          aria-expanded={isExpanded}
          onClick={() => setExpanded(routeThreadKey, run.id, !isExpanded)}
        >
          <ToggleIcon className="size-3.5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase leading-4 tracking-[0.12em]",
                subagentStatusClass(run.status),
              )}
            >
              <StatusIcon className={cn("size-3", run.status === "running" && "animate-spin")} />
              {run.status}
            </span>
            {detailChips.map((chip) => (
              <SubagentChip key={chip}>{chip}</SubagentChip>
            ))}
          </div>
          <p className="mt-1 truncate text-xs font-medium text-foreground/80">
            {run.title ?? run.description ?? "Subagent run"}
          </p>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-1.5 border-t border-border/55 px-3 py-2.5">
          <div
            className="flex min-w-0 flex-wrap items-center gap-1"
            data-subagent-detail-chips="true"
          >
            {detailChips.map((chip) => (
              <SubagentChip key={`expanded:${chip}`}>{chip}</SubagentChip>
            ))}
          </div>
          {run.prompt && run.prompt.trim().length > 0 ? (
            <div className="ml-auto max-w-[88%] min-w-0 rounded-xl rounded-br-sm border border-border bg-secondary px-3 py-2 text-xs leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground">
              {run.prompt}
            </div>
          ) : null}
          {attributedEntries.map((entry) => (
            <SubagentEntryRow key={entry.id} entry={entry} />
          ))}
          {showActiveEmptyState ? (
            <p className="px-1 py-1 text-[11px] text-muted-foreground/55">
              Waiting for attributed subagent output...
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
});

function SubagentChip({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 max-w-full rounded-md border border-border/65 bg-background/50 px-1.5 py-0.5 text-[10px] leading-4 text-muted-foreground/75 break-words [overflow-wrap:anywhere]">
      {children}
    </span>
  );
}

function SubagentEntryRow({ entry }: { entry: SubagentEntry }) {
  const EntryIcon = subagentEntryIcon(entry.kind);
  return (
    <div
      className={cn(
        "flex min-w-0 gap-2 rounded-lg px-2 py-1.5",
        entry.kind === "assistant" ? "bg-background/30" : "bg-background/15",
      )}
      data-subagent-entry-kind={entry.kind}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground/55">
        <EntryIcon className="size-3" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase leading-4 tracking-[0.12em] text-muted-foreground/60">
          {entry.title ?? entry.kind}
        </p>
        <p
          className={cn(
            "text-xs leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
            entry.kind === "error" ? "text-destructive" : "text-foreground/78",
          )}
        >
          {entry.text}
        </p>
      </div>
    </div>
  );
}

function useSubagentDuration(run: SubagentRun): string | null {
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (run.status !== "running") {
      return undefined;
    }
    const intervalId = window.setInterval(() => setNowIso(new Date().toISOString()), 1000);
    return () => window.clearInterval(intervalId);
  }, [run.status, run.startedAt]);

  return useMemo(
    () =>
      formatElapsed(
        run.startedAt,
        run.completedAt ?? (run.status === "running" ? nowIso : undefined),
      ),
    [nowIso, run.completedAt, run.startedAt, run.status],
  );
}

function buildSubagentDetailChips(run: SubagentRun, duration: string | null): string[] {
  return [
    duration ?? "duration unknown",
    run.provider,
    run.model,
    run.agentType,
    run.reasoningEffort ? `reasoning ${run.reasoningEffort}` : null,
    ...buildConfigChips(run.config),
  ].filter((chip): chip is string => Boolean(chip));
}

function buildConfigChips(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [];
  }

  return Object.entries(config)
    .flatMap(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return [`${key}: ${String(value)}`];
      }
      return [];
    })
    .slice(0, 3);
}

function subagentStatusIcon(status: SubagentRun["status"]) {
  switch (status) {
    case "running":
      return LoaderCircleIcon;
    case "completed":
      return CheckCircle2Icon;
    case "failed":
      return CircleAlertIcon;
    case "cancelled":
      return CircleSlashIcon;
  }
}

function subagentStatusClass(status: SubagentRun["status"]): string {
  switch (status) {
    case "running":
      return "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "completed":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "border-destructive/25 bg-destructive/10 text-destructive";
    case "cancelled":
      return "border-muted-foreground/20 bg-muted/35 text-muted-foreground";
  }
}

function subagentEntryIcon(kind: SubagentEntry["kind"]) {
  switch (kind) {
    case "assistant":
      return BotIcon;
    case "tool":
      return HammerIcon;
    case "result":
      return TerminalSquareIcon;
    case "error":
      return CircleAlertIcon;
    case "system":
      return Settings2Icon;
    default:
      return MessageSquareIcon;
  }
}
