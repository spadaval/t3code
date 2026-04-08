import type { BeadsIssueSummary, BeadsSwarmSummary, ThreadId } from "@t3tools/contracts";
import { type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { IssueListPanel } from "./issue/IssueListPanel";
import type { IssuePaneScope } from "~/issuePaneStore";

export interface NewIssuesPanelProps {
  className?: string;
  threadId: ThreadId;

  // Issue data
  issues?: readonly BeadsIssueSummary[];
  selectedIssueId?: string | null;

  // Coordinator summary (for tab indicator only)
  swarms?: readonly BeadsSwarmSummary[];

  // State
  activeTab?: "issues" | "coordinator";
  searchValue?: string;
  scopeFilter?: IssuePaneScope;
  loading?: boolean;
  error?: string | null;

  // Event handlers
  onTabChange?: (tab: "issues" | "coordinator") => void;
  onIssueSelect?: (issueId: string) => void;
  onSearchChange?: (search: string) => void;
  onScopeChange?: (scope: IssuePaneScope) => void;
  onLabelClick?: (label: string) => void;

  // Panel actions
  actions?: ReactNode;
}

/**
 * NewIssuesPanel - Thin wrapper for issue listing with coordinator tab nav.
 *
 * The coordinator tab rendering is handled by the production IssuesPanel.tsx
 * which wires the full CoordinatorPanel component with all required backend
 * data and action callbacks. This component only manages tab switching and
 * the issue list view.
 */
export function NewIssuesPanel({
  className,
  threadId,
  issues = [],
  selectedIssueId,
  swarms = [],
  activeTab = "issues",
  searchValue = "",
  scopeFilter = "active",
  loading = false,
  error = null,
  onTabChange,
  onIssueSelect,
  onSearchChange,
  onScopeChange,
  onLabelClick,
  actions,
}: NewIssuesPanelProps) {
  const coordinatorActiveCount = swarms.reduce((sum, swarm) => sum + swarm.activeWorkerCount, 0);

  const handleTabChange = (tab: "issues" | "coordinator") => {
    onTabChange?.(tab);
  };

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-background border-r border-border",
        "animate-fade-in",
        "md:border-r sm:border-r-0",
        className,
      )}
    >
      {activeTab === "issues" ? (
        <IssueListPanel
          threadId={threadId}
          issues={issues}
          selectedIssueId={selectedIssueId}
          searchValue={searchValue}
          scopeFilter={scopeFilter}
          loading={loading}
          error={error}
          onIssueSelect={onIssueSelect}
          onSearchChange={onSearchChange}
          onScopeChange={onScopeChange}
          onLabelClick={onLabelClick}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          coordinatorActiveCount={coordinatorActiveCount}
          actions={actions}
          className="flex-1"
        />
      ) : (
        <div className="flex-1 px-4 py-6 text-sm text-muted-foreground">
          Coordinator view is available in the full IssuesPanel.
        </div>
      )}
    </div>
  );
}

export function IssuesPanelMigration(props: NewIssuesPanelProps) {
  return <NewIssuesPanel {...props} />;
}

export type { NewIssuesPanelProps as IssuesPanelProps };
