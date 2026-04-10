import type { BeadsIssueDependency, BeadsIssueRelationSummary } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  GitBranchIcon,
  LinkIcon,
  OctagonAlertIcon,
  TimerIcon,
} from "lucide-react";

import { buildIssueRelationshipModel, type IssueRelationshipTone } from "~/lib/issueRelationships";
import { cn } from "~/lib/utils";
import {
  formatPriorityDisplay,
  formatStatusDisplay,
  getPriorityVariant,
  getStatusVariant,
} from "~/lib/issueConstants";
import { StatusIndicator } from "../shared/StatusIndicator";
import { IssueTypeIcon } from "./IssueCard";

function toneClasses(tone: IssueRelationshipTone) {
  switch (tone) {
    case "structure":
      return {
        text: "text-violet-600 dark:text-violet-400",
        chip: "border-violet-500/20 bg-violet-500/8 text-violet-700 dark:text-violet-300",
      };
    case "blocked":
      return {
        text: "text-destructive",
        chip: "border-destructive/20 bg-destructive/8 text-destructive",
      };
    case "prerequisite":
      return {
        text: "text-amber-600 dark:text-amber-400",
        chip: "border-amber-500/20 bg-amber-500/8 text-amber-700 dark:text-amber-300",
      };
    case "downstream":
      return {
        text: "text-sky-600 dark:text-sky-400",
        chip: "border-sky-500/20 bg-sky-500/8 text-sky-700 dark:text-sky-300",
      };
    default:
      return {
        text: "text-muted-foreground",
        chip: "border-border bg-muted/30 text-muted-foreground",
      };
  }
}

function toneIcon(tone: IssueRelationshipTone, className?: string) {
  switch (tone) {
    case "structure":
      return <GitBranchIcon className={cn("size-3.5", className)} />;
    case "blocked":
      return <OctagonAlertIcon className={cn("size-3.5", className)} />;
    case "prerequisite":
      return <TimerIcon className={cn("size-3.5", className)} />;
    case "downstream":
      return <ArrowRightIcon className={cn("size-3.5", className)} />;
    default:
      return <LinkIcon className={cn("size-3.5", className)} />;
  }
}

export function IssueParentLink({
  parent,
  onClick,
  className,
}: {
  parent: BeadsIssueRelationSummary | null;
  onClick?: ((issueId: string) => void) | undefined;
  className?: string;
}) {
  if (!parent) {
    return null;
  }

  const classes = toneClasses("structure");
  const content = (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-xs",
        classes.chip,
        className,
      )}
    >
      {toneIcon("structure", classes.text)}
      <span className="font-medium uppercase tracking-[0.14em]">Parent</span>
      <ChevronRightIcon className="size-3 opacity-60" />
      <span className="truncate text-foreground">{parent.title}</span>
      <span className="shrink-0 text-muted-foreground">#{parent.id}</span>
    </div>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button
      type="button"
      onClick={() => onClick(parent.id)}
      className="max-w-full text-left transition-opacity hover:opacity-100"
    >
      {content}
    </button>
  );
}

export function IssueRelationshipSummaryBar(props: {
  parent: BeadsIssueRelationSummary | null;
  subIssues: readonly BeadsIssueRelationSummary[];
  dependencies: readonly BeadsIssueDependency[];
  dependents?: readonly BeadsIssueRelationSummary[] | undefined;
  className?: string;
}) {
  const model = buildIssueRelationshipModel({
    parent: props.parent,
    children: props.subIssues,
    dependencies: props.dependencies,
    dependents: props.dependents,
  });

  if (model.summary.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap gap-2", props.className)}>
      {model.summary.map((item) => {
        const classes = toneClasses(item.tone);
        return (
          <div
            key={item.key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              classes.chip,
            )}
          >
            {toneIcon(item.tone, classes.text)}
            <span>{item.label}</span>
            <span className="font-medium">{item.count}</span>
          </div>
        );
      })}
    </div>
  );
}

export function IssueRelationshipsSection(props: {
  parent: BeadsIssueRelationSummary | null;
  subIssues: readonly BeadsIssueRelationSummary[];
  dependencies: readonly BeadsIssueDependency[];
  dependents?: readonly BeadsIssueRelationSummary[] | undefined;
  onIssueSelect?: ((issueId: string) => void) | undefined;
  showEmptyStates?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const model = buildIssueRelationshipModel({
    parent: props.parent,
    children: props.subIssues,
    dependencies: props.dependencies,
    dependents: props.dependents,
  });

  if (model.totalSectionItemCount === 0 && !props.showEmptyStates) {
    return null;
  }

  return (
    <div className={cn("space-y-4", props.className)}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Relationships
      </h3>
      <div className="space-y-4">
        {model.sections.map((section) => {
          if (section.items.length === 0 && !props.showEmptyStates) {
            return null;
          }

          const classes = toneClasses(section.tone);
          return (
            <div key={section.key} className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                {toneIcon(section.tone, classes.text)}
                <span>{section.label}</span>
                <span className="text-muted-foreground">{section.items.length}</span>
              </div>

              {section.items.length > 0 ? (
                <div className={cn("space-y-2", props.compact && "space-y-1.5")}>
                  {section.items.map((item) => (
                    <RelationshipItem
                      key={`${section.key}:${item.id}`}
                      item={item}
                      onClick={props.onIssueSelect}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground">
                  {section.emptyLabel}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RelationshipItem({
  item,
  onClick,
}: {
  item: ReturnType<typeof buildIssueRelationshipModel>["sections"][number]["items"][number];
  onClick?: ((issueId: string) => void) | undefined;
}) {
  const priorityLabel = formatPriorityDisplay(item.priority);
  const content = (
    <div className="w-full rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:bg-muted/35">
      <div className="flex items-start gap-2">
        <IssueTypeIcon issueType={item.issueType} className="mt-0.5 size-3.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">#{item.id}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusIndicator variant={getStatusVariant(item.status)} size="sm">
              {formatStatusDisplay(item.status)}
            </StatusIndicator>
            {priorityLabel ? (
              <StatusIndicator
                variant={getPriorityVariant(item.priority)}
                size="sm"
                showDot={false}
              >
                {priorityLabel}
              </StatusIndicator>
            ) : null}
          </div>
          {item.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!onClick) {
    return content;
  }

  return (
    <button type="button" onClick={() => onClick(item.id)} className="w-full">
      {content}
    </button>
  );
}
