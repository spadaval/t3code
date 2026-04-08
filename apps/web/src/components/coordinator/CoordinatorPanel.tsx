import type {
  BeadsSwarmSummary,
  BeadsCoordinatorEpicSnapshot,
  OrchestrationSwarmRun,
} from "@t3tools/contracts";
import { useMemo, useState, useCallback } from "react";
import {
  PlayIcon,
  RefreshCwIcon,
  AlertCircleIcon,
  Clock3Icon,
  PauseIcon,
  Loader2Icon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { StatusIndicator } from "../shared/StatusIndicator";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export interface CoordinatorPanelProps {
  className?: string;
  swarms?: readonly BeadsSwarmSummary[];
  epics?: readonly BeadsCoordinatorEpicSnapshot[];
  swarmRuns?: readonly OrchestrationSwarmRun[];
  onStartSwarm?: (epicId: string) => void;
  onPauseSwarm?: (epicId: string) => void;
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
  // Enhanced interaction props
  refreshing?: boolean;
  operationInProgress?: string | null; // epicId of swarm being started/paused
  showDetailedStatus?: boolean;
}

interface SwarmCardProps {
  swarm: BeadsSwarmSummary;
  onStart?: () => void;
  onPause?: () => void;
  loading?: boolean;
  operationInProgress?: boolean;
}

interface EpicCoordinatorCardProps {
  epic: BeadsCoordinatorEpicSnapshot;
  onAction?: (action: string) => void;
  loading?: boolean;
}

/**
 * CoordinatorPanel - Enhanced swarm coordination interface with real-time status
 *
 * Features:
 * - Real-time status indicators for active swarms
 * - Loading states for swarm operations
 * - Enhanced error handling with retry options
 * - Optimistic UI updates with loading indicators
 * - Keyboard navigation and accessibility
 *
 * Replaces the complex coordinator logic from IssuesPanel.tsx with a focused,
 * action-oriented interface for managing swarm execution.
 */
export function CoordinatorPanel({
  className,
  swarms = [],
  epics = [],
  swarmRuns = [],
  onStartSwarm,
  onPauseSwarm,
  onRefresh,
  loading = false,
  error = null,
  refreshing = false,
  operationInProgress = null,
  showDetailedStatus = false,
}: CoordinatorPanelProps) {
  const [retryAttempts, setRetryAttempts] = useState(0);

  const coordinatorSummary = useMemo(() => {
    const runningSwarms = swarms.filter((s) => s.activeWorkerCount > 0);
    const readySwarms = swarms.filter((s) => s.activeWorkerCount === 0 && s.readyIssueCount > 0);
    const totalActiveWorkers = runningSwarms.reduce((sum, s) => sum + s.activeWorkerCount, 0);
    const totalReadyIssues = readySwarms.reduce((sum, s) => sum + s.readyIssueCount, 0);

    return {
      runningSwarms,
      readySwarms,
      totalActiveWorkers,
      totalReadyIssues,
      hasActivity: runningSwarms.length > 0 || readySwarms.length > 0,
    };
  }, [swarms]);

  const handleRetry = useCallback(() => {
    setRetryAttempts((prev) => prev + 1);
    onRefresh?.();
  }, [onRefresh]);

  const handleStartSwarm = useCallback(
    (epicId: string) => {
      if (operationInProgress) return;
      onStartSwarm?.(epicId);
    },
    [operationInProgress, onStartSwarm],
  );

  const handlePauseSwarm = useCallback(
    (epicId: string) => {
      if (operationInProgress) return;
      onPauseSwarm?.(epicId);
    },
    [operationInProgress, onPauseSwarm],
  );

  if (loading) {
    return (
      <div className={cn("space-y-4 p-4", className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-16 bg-muted/50 rounded">
            <div className="p-4 space-y-2">
              <div className="w-48 h-4 bg-muted rounded" />
              <div className="w-32 h-3 bg-muted rounded" />
            </div>
          </div>
          <div className="h-32 bg-muted/50 rounded">
            <div className="p-4 space-y-3">
              <div className="w-40 h-4 bg-muted rounded" />
              <div className="space-y-2">
                <div className="w-full h-3 bg-muted rounded" />
                <div className="w-3/4 h-3 bg-muted rounded" />
              </div>
            </div>
          </div>
          <div className="h-24 bg-muted/50 rounded">
            <div className="p-4 space-y-2">
              <div className="w-32 h-4 bg-muted rounded" />
              <div className="w-full h-3 bg-muted rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("p-4", className)}>
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertCircleIcon className="size-4" />
            <span className="font-medium">Coordinator Error</span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">{error}</p>
          {retryAttempts > 0 && (
            <p className="text-xs text-muted-foreground mb-3">
              Retry attempt {retryAttempts} - Still encountering issues?
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={refreshing}
              className="flex items-center gap-1"
            >
              {refreshing ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3" />
              )}
              Retry
            </Button>
            {retryAttempts > 2 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRetryAttempts(0)}
                className="text-xs"
              >
                Reset
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Status Overview */}
      <CoordinatorHeader
        summary={coordinatorSummary}
        onRefresh={onRefresh}
        refreshing={refreshing}
        showDetailedStatus={showDetailedStatus}
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Active Swarms */}
        {coordinatorSummary.runningSwarms.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <StatusIndicator variant="warning" size="sm" pulse>
                Active Swarms
              </StatusIndicator>
              <span className="text-xs text-muted-foreground">
                {coordinatorSummary.totalActiveWorkers} worker
                {coordinatorSummary.totalActiveWorkers !== 1 ? "s" : ""} running
              </span>
            </div>
            <div className="space-y-2">
              {coordinatorSummary.runningSwarms.map((swarm) => (
                <SwarmCard
                  key={swarm.swarmId}
                  swarm={swarm}
                  onPause={() => handlePauseSwarm(swarm.epicId)}
                  loading={refreshing}
                  operationInProgress={operationInProgress === swarm.epicId}
                />
              ))}
            </div>
          </section>
        )}

        {/* Ready to Start */}
        {coordinatorSummary.readySwarms.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <StatusIndicator variant="success" size="sm">
                Ready to Start
              </StatusIndicator>
              <span className="text-xs text-muted-foreground">
                {coordinatorSummary.totalReadyIssues} issue
                {coordinatorSummary.totalReadyIssues !== 1 ? "s" : ""} ready
              </span>
            </div>
            <div className="space-y-2">
              {coordinatorSummary.readySwarms.map((swarm) => (
                <SwarmCard
                  key={swarm.swarmId}
                  swarm={swarm}
                  onStart={() => handleStartSwarm(swarm.epicId)}
                  loading={refreshing}
                  operationInProgress={operationInProgress === swarm.epicId}
                />
              ))}
            </div>
          </section>
        )}

        {/* Epic Coordination Status */}
        {epics.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <StatusIndicator variant="info" size="sm">
                Epic Status
              </StatusIndicator>
              <span className="text-xs text-muted-foreground">
                {epics.length} epic{epics.length !== 1 ? "s" : ""} tracked
              </span>
            </div>
            <div className="space-y-2">
              {epics.slice(0, showDetailedStatus ? epics.length : 5).map((epic) => (
                <EpicCoordinatorCard
                  key={epic.epicId}
                  epic={epic}
                  loading={refreshing}
                  onAction={(action) => console.log("Epic action:", action, epic.epicId)}
                />
              ))}
              {!showDetailedStatus && epics.length > 5 && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                    +{epics.length - 5} more epics
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Enhanced Empty State */}
        {!coordinatorSummary.hasActivity && epics.length === 0 && (
          <div className="text-center py-12">
            <div className="mx-auto w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
              <Clock3Icon className="size-8 text-muted-foreground/60" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">No swarms active</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
              Configure epics to start coordinated implementation or check your issue setup.
            </p>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Tip: Swarms automatically appear when epics have ready issues</p>
              <p>Use the Issues tab to manage issue status and dependencies</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CoordinatorHeader({
  summary,
  onRefresh,
  refreshing = false,
  showDetailedStatus = false,
}: {
  summary: any;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean;
  showDetailedStatus?: boolean;
}) {
  return (
    <div className="border-b border-border bg-background/95 backdrop-blur-sm p-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Swarm Coordinator</h2>
            {refreshing && <Loader2Icon className="size-4 text-muted-foreground animate-spin" />}
          </div>
          <div className="flex items-center gap-4 text-sm">
            {summary.runningSwarms.length > 0 && (
              <StatusIndicator variant="warning" size="sm" pulse>
                {summary.runningSwarms.length} active
              </StatusIndicator>
            )}
            {summary.readySwarms.length > 0 && (
              <StatusIndicator variant="success" size="sm">
                {summary.readySwarms.length} ready
              </StatusIndicator>
            )}
            {summary.totalActiveWorkers > 0 && (
              <span className="text-muted-foreground flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-warning animate-pulse" />
                {summary.totalActiveWorkers} worker{summary.totalActiveWorkers !== 1 ? "s" : ""}
              </span>
            )}
            {!summary.hasActivity && <span className="text-muted-foreground">No activity</span>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showDetailedStatus && (
            <span className="text-xs text-muted-foreground px-2 py-1 bg-muted/50 rounded">
              Detailed View
            </span>
          )}
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1"
              aria-label="Refresh coordinator status"
            >
              {refreshing ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3" />
              )}
              Refresh
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SwarmCard({
  swarm,
  onStart,
  onPause,
  loading = false,
  operationInProgress = false,
}: SwarmCardProps) {
  const isActive = swarm.activeWorkerCount > 0;
  const statusVariant = isActive ? "warning" : "success";
  const isLoading = loading || operationInProgress;

  const handleAction = useCallback(
    (action: () => void) => {
      if (isLoading) return;
      action();
    },
    [isLoading],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, action: () => void) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleAction(action);
      }
    },
    [handleAction],
  );

  return (
    <Card
      className={cn(
        "p-3 transition-all duration-200",
        isActive && "border-warning/20 bg-warning/5",
        isLoading && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <StatusIndicator
              variant={statusVariant}
              size="sm"
              pulse={isActive && !isLoading}
              loading={isLoading}
            >
              {isActive ? "Running" : "Ready"}
            </StatusIndicator>
            <span className="text-sm font-medium truncate">{swarm.epicTitle}</span>
            {isLoading && operationInProgress && (
              <span className="text-xs text-muted-foreground">
                {isActive ? "Pausing..." : "Starting..."}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {isActive && (
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-warning animate-pulse" />
                {swarm.activeWorkerCount} worker{swarm.activeWorkerCount !== 1 ? "s" : ""}
              </span>
            )}
            <span>
              {swarm.readyIssueCount} ready issue{swarm.readyIssueCount !== 1 ? "s" : ""}
            </span>
            <span>
              {swarm.completedIssueCount}/{swarm.totalIssueCount} completed
            </span>
            {swarm.totalIssueCount > 0 && (
              <div className="flex-1 min-w-0 max-w-24">
                <div className="w-full bg-muted rounded-full h-1">
                  <div
                    className="bg-success h-1 rounded-full transition-all duration-300"
                    style={{
                      width: `${(swarm.completedIssueCount / swarm.totalIssueCount) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-3">
          {isActive ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleAction(() => onPause?.())}
              onKeyDown={(e) => handleKeyDown(e, () => onPause?.())}
              disabled={isLoading}
              className="min-w-[4rem] justify-center"
              aria-label="Pause swarm execution"
            >
              {isLoading && operationInProgress ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <>
                  <PauseIcon className="size-3 mr-1" />
                  Pause
                </>
              )}
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => handleAction(() => onStart?.())}
              onKeyDown={(e) => handleKeyDown(e, () => onStart?.())}
              disabled={isLoading || swarm.readyIssueCount === 0}
              className="min-w-[4rem] justify-center"
              aria-label={`Start swarm for ${swarm.epicTitle}`}
            >
              {isLoading && operationInProgress ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <>
                  <PlayIcon className="size-3 mr-1" />
                  Start
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function EpicCoordinatorCard({ epic, onAction, loading = false }: EpicCoordinatorCardProps) {
  const handleAction = useCallback(() => {
    if (loading) return;
    onAction?.(epic.primaryAction?.kind || "unknown");
  }, [loading, onAction, epic.primaryAction]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleAction();
      }
    },
    [handleAction],
  );

  return (
    <Card className={cn("p-3 transition-all duration-200", loading && "opacity-60")}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusIndicator variant="info" size="sm" loading={loading}>
              {epic.stateKind}
            </StatusIndicator>
            <span className="text-sm font-medium truncate">{epic.epicTitle}</span>
          </div>

          {epic.primaryAction && (
            <p className="text-xs text-muted-foreground truncate">{epic.primaryAction.label}</p>
          )}
        </div>

        {epic.primaryAction && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAction}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="min-w-[5rem] justify-center"
            aria-label={`${epic.primaryAction.label} for ${epic.epicTitle}`}
          >
            {loading ? <Loader2Icon className="size-3 animate-spin" /> : epic.primaryAction.label}
          </Button>
        )}
      </div>
    </Card>
  );
}
