import type { BeadsIssueSummary } from "@t3tools/contracts";
import { type ReactNode } from "react";
import {
  BugIcon,
  CheckSquare2Icon,
  CircleDotIcon,
  LightbulbIcon,
  ScaleIcon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import {
  getStatusVariant,
  getPriorityVariant,
  type IssueStatusVariant,
} from "~/lib/issueConstants";
import { formatShortTimestamp } from "~/timestampFormat";
import { useSettings } from "~/hooks/useSettings";

// ---------------------------------------------------------------------------
// Issue-type icon config (restored from old design)
// ---------------------------------------------------------------------------

const ISSUE_TYPE_ICON_CONFIG: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  bug: { icon: BugIcon, className: "text-red-500" },
  feature: { icon: LightbulbIcon, className: "text-green-500" },
  task: { icon: CheckSquare2Icon, className: "text-blue-500" },
  epic: { icon: ZapIcon, className: "text-purple-500" },
  chore: { icon: WrenchIcon, className: "text-muted-foreground" },
  decision: { icon: ScaleIcon, className: "text-amber-500" },
};

const DEFAULT_ISSUE_TYPE_ICON = { icon: CircleDotIcon, className: "text-muted-foreground" };

export function IssueTypeIcon({ issueType, className }: { issueType: string; className?: string }) {
  const config = ISSUE_TYPE_ICON_CONFIG[issueType.toLowerCase()] ?? DEFAULT_ISSUE_TYPE_ICON;
  const Icon = config.icon;
  return <Icon className={cn("size-4 shrink-0", config.className, className)} />;
}

// ---------------------------------------------------------------------------
// Semantic helpers
// ---------------------------------------------------------------------------

const SEMANTIC_TEXT_COLOR: Record<IssueStatusVariant, string> = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  info: "text-info-foreground",
  error: "text-destructive-foreground",
  secondary: "text-muted-foreground",
  primary: "text-foreground",
};

// ---------------------------------------------------------------------------
// IssueCard props
// ---------------------------------------------------------------------------

export interface IssueCardProps {
  issue: BeadsIssueSummary;
  className?: string;
  selected?: boolean;
  focused?: boolean;
  onClick?: () => void;
  onLabelClick?: ((label: string) => void) | undefined;
  showPriority?: boolean;
  showLabels?: boolean;
  compact?: boolean;
  actions?: ReactNode;
}

/**
 * IssueCard — Minimal, icon-driven issue row.
 *
 * Design goals (merged from old + new):
 * - Issue-type icon as primary visual anchor (old design)
 * - Dense row layout: title + inline metadata on one line (old design)
 * - Semantic color for status/priority as text, not badges (old design)
 * - Keyboard focus & label support (new design)
 * - No scale transforms, no shadows, no border-l accents
 */
export function IssueCard({
  issue,
  className,
  selected = false,
  focused = false,
  onClick,
  onLabelClick,
  showPriority = true,
  showLabels = true,
  compact = false,
  actions,
}: IssueCardProps) {
  const settings = useSettings();
  const statusClass = SEMANTIC_TEXT_COLOR[getStatusVariant(issue.status)];
  const priorityClass =
    issue.priority !== null ? SEMANTIC_TEXT_COLOR[getPriorityVariant(issue.priority)] : null;

  return (
    <button
      type="button"
      className={cn(
        "w-full border-b border-border/50 px-4 py-2.5 text-left transition-colors",
        "hover:bg-muted/30",
        selected && "bg-muted/50",
        focused && "ring-1 ring-ring ring-inset bg-muted/40",
        onClick && "cursor-pointer",
        compact && "py-2 px-3",
        className,
      )}
      onClick={onClick}
      tabIndex={focused ? 0 : -1}
      aria-label={`Select issue: ${issue.title}`}
    >
      {/* Row 1: Icon + Title + Timestamp */}
      <div className="flex items-center gap-2">
        <IssueTypeIcon issueType={issue.issueType} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{issue.title}</p>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatShortTimestamp(issue.updatedAt, settings.timestampFormat)}
        </span>
        {actions && (
          <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions}
          </div>
        )}
      </div>

      {/* Row 2: ID · Status · Priority · Labels */}
      <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-6 text-xs text-muted-foreground">
        <span>{issue.id}</span>
        <span className="opacity-40">&middot;</span>
        <span className={statusClass}>{issue.status.replace(/_/g, " ")}</span>
        {showPriority && priorityClass !== null && (
          <>
            <span className="opacity-40">&middot;</span>
            <span className={priorityClass}>P{issue.priority}</span>
          </>
        )}
        {showLabels && issue.labels.length > 0 && (
          <>
            <span className="opacity-40">&middot;</span>
            {issue.labels.slice(0, 3).map((label) =>
              onLabelClick ? (
                <button
                  key={label}
                  type="button"
                  className="text-muted-foreground/80 cursor-pointer hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLabelClick(label);
                  }}
                >
                  {label}
                </button>
              ) : (
                <span key={label} className="text-muted-foreground/80">
                  {label}
                </span>
              ),
            )}
            {issue.labels.length > 3 && (
              <span className="text-muted-foreground/60">+{issue.labels.length - 3}</span>
            )}
          </>
        )}
      </div>
    </button>
  );
}

// Convenience variants
export const CompactIssueCard = (props: Omit<IssueCardProps, "compact">) => (
  <IssueCard {...props} compact />
);

export const EpicIssueCard = (props: IssueCardProps) => (
  <IssueCard {...props} className={cn("pl-8", props.className)} />
);
