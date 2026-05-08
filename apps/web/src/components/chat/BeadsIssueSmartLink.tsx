import type { BeadsIssueReferenceSummary } from "@t3tools/contracts";
import { memo, useCallback } from "react";

import {
  formatIssueTypeDisplay,
  formatStatusDisplay,
  isIssueDoneStatus,
} from "~/lib/issueConstants";
import { cn } from "~/lib/utils";
import { IssueTypeIcon } from "../issue/IssueCard";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface BeadsIssueSmartLinkProps {
  issue: BeadsIssueReferenceSummary;
  onOpenIssue: (issueId: string) => void;
}

export const BeadsIssueSmartLink = memo(function BeadsIssueSmartLink({
  issue,
  onOpenIssue,
}: BeadsIssueSmartLinkProps) {
  const handleOpen = useCallback(() => {
    onOpenIssue(issue.id);
  }, [issue.id, onOpenIssue]);
  const typeLabel = formatIssueTypeDisplay(issue.issueType);
  const statusLabel = formatStatusDisplay(issue.status);
  const done = isIssueDoneStatus(issue.status);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "relative top-[2px] inline-flex max-w-[min(28rem,100%)] items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-1.5 py-0.5 align-baseline text-xs leading-none text-foreground/85 transition-colors",
              "hover:border-border hover:bg-muted/55 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              done && "text-muted-foreground/75",
            )}
            aria-label={`Open issue ${issue.id}: ${issue.title}`}
            onClick={handleOpen}
          >
            <IssueTypeIcon issueType={issue.issueType} className="size-3.5" />
            <span className="shrink-0 font-mono text-[11px] font-medium">{issue.id}</span>
            <span className="text-muted-foreground/45">·</span>
            <span className={cn("min-w-0 truncate", done && "line-through")}>{issue.title}</span>
            <span className="hidden shrink-0 text-muted-foreground/70 sm:inline">
              {typeLabel} · {statusLabel}
            </span>
          </button>
        }
      />
      <TooltipPopup side="top" className="max-w-[min(32rem,calc(100vw-2rem))] text-xs">
        <div className="space-y-1">
          <div className="font-medium text-foreground">{issue.title}</div>
          <div className="text-muted-foreground">
            {issue.id} · {typeLabel} · {statusLabel}
          </div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
});
