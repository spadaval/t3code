import React, { useState, useEffect, useMemo } from "react";
import { cn } from "~/lib/utils";
import type { WorkflowEntity } from "@t3tools/contracts/workflowState";
import type { SwarmRunId } from "@t3tools/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Progress } from "../ui/progress";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import {
  Activity,
  BarChart3,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
  Play,
  TrendingUp,
  Eye,
  Filter,
  RefreshCw,
  Calendar,
  Timer,
  Zap,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface ProgressVisualizationProps {
  entity: WorkflowEntity;
  executionHistory: readonly {
    timestamp: string;
    event: string;
    context: Record<string, unknown>;
  }[];
  onRefreshData: () => Promise<void>;
  className?: string;
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  title: string;
  description: string;
  type: "success" | "error" | "warning" | "info" | "milestone";
  duration?: number;
  metadata?: Record<string, unknown>;
}

interface ProgressMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  averageTaskDuration: number;
  estimatedCompletion: string | null;
  velocity: number; // tasks per hour
  errorRate: number; // percentage
}

/**
 * Progress Visualization System
 *
 * Comprehensive progress tracking and visualization with real-time updates,
 * timeline views, and detailed metrics for workflow transparency.
 */
export function ProgressVisualization({
  entity,
  executionHistory,
  onRefreshData,
  className,
}: ProgressVisualizationProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [timelineFilter, setTimelineFilter] = useState<string>("all");
  const [refreshing, setRefreshing] = useState(false);

  // Auto-refresh every 10 seconds when workflow is active
  useEffect(() => {
    if (!["active", "running", "starting"].includes(entity.currentState)) return;

    const interval = setInterval(async () => {
      try {
        await onRefreshData();
      } catch (error) {
        console.error("Failed to refresh progress data:", error);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [entity.currentState, onRefreshData]);

  // Transform execution history into timeline events
  const timelineEvents = useMemo((): TimelineEvent[] => {
    return executionHistory.map((event, index) => {
      let type: TimelineEvent["type"] = "info";
      let title = event.event.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
      let description = "";

      if (event.event.includes("completed") || event.event.includes("success")) {
        type = "success";
        description = "Task completed successfully";
      } else if (event.event.includes("failed") || event.event.includes("error")) {
        type = "error";
        description = "Task encountered an error";
      } else if (event.event.includes("blocked") || event.event.includes("intervention")) {
        type = "warning";
        description = "Manual intervention required";
      } else if (event.event.includes("started") || event.event.includes("created")) {
        type = "milestone";
        description = "Workflow milestone reached";
      }

      // Add context-specific description
      if (event.context.taskId) {
        description += ` (Task: ${event.context.taskId})`;
      }
      if (event.context.reason) {
        description += ` - ${event.context.reason}`;
      }

      return {
        id: `event-${index}`,
        timestamp: event.timestamp,
        title,
        description,
        type,
        metadata: event.context,
      };
    });
  }, [executionHistory]);

  // Calculate progress metrics
  const progressMetrics = useMemo((): ProgressMetrics => {
    const completedEvents = executionHistory.filter((e) => e.event.includes("completed"));
    const failedEvents = executionHistory.filter((e) => e.event.includes("failed"));
    const startedEvents = executionHistory.filter((e) => e.event.includes("started"));

    const totalTasks = entity.progress?.total || startedEvents.length || 1;
    const completedTasks = entity.progress?.completed || completedEvents.length;
    const failedTasks = failedEvents.length;
    const blockedTasks = executionHistory.filter((e) => e.event.includes("blocked")).length;

    // Calculate average task duration
    let totalDuration = 0;
    let taskCount = 0;

    for (let i = 0; i < executionHistory.length - 1; i++) {
      const current = executionHistory[i];
      const next = executionHistory[i + 1];

      if (!current || !next) {
        continue;
      }

      if (current.event.includes("started") && next.event.includes("completed")) {
        const duration = new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime();
        totalDuration += duration;
        taskCount++;
      }
    }

    const averageTaskDuration = taskCount > 0 ? totalDuration / taskCount : 0;

    // Calculate velocity (tasks per hour)
    const workflowStart = new Date(entity.createdAt);
    const now = new Date();
    const hoursElapsed = (now.getTime() - workflowStart.getTime()) / (1000 * 60 * 60);
    const velocity = hoursElapsed > 0 ? completedTasks / hoursElapsed : 0;

    // Estimate completion time
    const remainingTasks = totalTasks - completedTasks;
    const estimatedCompletion =
      velocity > 0 && remainingTasks > 0
        ? new Date(now.getTime() + (remainingTasks / velocity) * 60 * 60 * 1000).toISOString()
        : null;

    // Calculate error rate
    const errorRate = totalTasks > 0 ? (failedTasks / totalTasks) * 100 : 0;

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      blockedTasks,
      averageTaskDuration,
      estimatedCompletion,
      velocity,
      errorRate,
    };
  }, [entity, executionHistory]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await onRefreshData();
    } catch (error) {
      console.error("Failed to refresh:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredTimelineEvents =
    timelineFilter === "all"
      ? timelineEvents
      : timelineEvents.filter((event) => event.type === timelineFilter);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 80) return "bg-green-500";
    if (percentage >= 60) return "bg-blue-500";
    if (percentage >= 40) return "bg-yellow-500";
    return "bg-orange-500";
  };

  const getEventIcon = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "warning":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "milestone":
        return <Zap className="h-4 w-4 text-blue-500" />;
      default:
        return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header with real-time status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-5 w-5" />
              <div>
                <CardTitle>Progress Tracking</CardTitle>
                <CardDescription>Real-time workflow progress and metrics</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={entity.currentState === "active" ? "default" : "secondary"}
                className="flex items-center gap-1"
              >
                {entity.currentState === "active" ? (
                  <Play className="h-3 w-3" />
                ) : (
                  <Pause className="h-3 w-3" />
                )}
                {entity.currentState}
              </Badge>
              <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="realtime">Real-time</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Progress Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Overall Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Completed</span>
                    <span>
                      {progressMetrics.completedTasks} / {progressMetrics.totalTasks}
                    </span>
                  </div>
                  <Progress
                    value={(progressMetrics.completedTasks / progressMetrics.totalTasks) * 100}
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    {Math.round(
                      (progressMetrics.completedTasks / progressMetrics.totalTasks) * 100,
                    )}
                    % complete
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Velocity Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Velocity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-500" />
                    <span className="text-lg font-semibold">
                      {progressMetrics.velocity.toFixed(1)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">tasks per hour</p>
                </div>
              </CardContent>
            </Card>

            {/* Error Rate Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-lg font-semibold">
                      {progressMetrics.errorRate.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {progressMetrics.failedTasks} failed tasks
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* ETA Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Estimated Completion</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Timer className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-semibold">
                      {progressMetrics.estimatedCompletion
                        ? new Date(progressMetrics.estimatedCompletion).toLocaleTimeString()
                        : "N/A"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {progressMetrics.estimatedCompletion ? "estimated" : "unable to estimate"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Current Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">State:</span>
                  <Badge variant="outline">{entity.currentState}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Last Updated:</span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(entity.updatedAt).toLocaleString()}
                  </span>
                </div>
                {entity.requiresIntervention && (
                  <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <AlertCircle className="h-4 w-4 text-orange-500" />
                    <span className="text-sm text-orange-800">Manual intervention required</span>
                  </div>
                )}
                {progressMetrics.averageTaskDuration > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Avg. Task Duration:</span>
                    <span className="text-sm">
                      {formatDuration(progressMetrics.averageTaskDuration)}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Execution Timeline</CardTitle>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  <Select
                    value={timelineFilter}
                    onValueChange={(value) => setTimelineFilter(value ?? "all")}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Events</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="error">Errors</SelectItem>
                      <SelectItem value="warning">Warnings</SelectItem>
                      <SelectItem value="milestone">Milestones</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {filteredTimelineEvents.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No events match the selected filter
                  </p>
                ) : (
                  filteredTimelineEvents.map((event, index) => (
                    <div key={event.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        {getEventIcon(event.type)}
                        {index < filteredTimelineEvents.length - 1 && (
                          <div className="w-px h-8 bg-border mt-2" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm">{event.title}</h4>
                          <time className="text-xs text-muted-foreground">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </time>
                        </div>
                        <p className="text-sm text-muted-foreground">{event.description}</p>
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground">
                              View details
                            </summary>
                            <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                              {JSON.stringify(event.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Metrics Tab */}
        <TabsContent value="metrics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Task Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span>Completed</span>
                    </div>
                    <span className="font-semibold">{progressMetrics.completedTasks}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span>Failed</span>
                    </div>
                    <span className="font-semibold">{progressMetrics.failedTasks}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                      <span>Blocked</span>
                    </div>
                    <span className="font-semibold">{progressMetrics.blockedTasks}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between font-semibold">
                    <span>Total</span>
                    <span>{progressMetrics.totalTasks}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm">Success Rate</span>
                      <span className="text-sm font-semibold">
                        {((1 - progressMetrics.errorRate / 100) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={(1 - progressMetrics.errorRate / 100) * 100} className="h-2" />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm">Completion Rate</span>
                      <span className="text-sm font-semibold">
                        {(
                          (progressMetrics.completedTasks / progressMetrics.totalTasks) *
                          100
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                    <Progress
                      value={(progressMetrics.completedTasks / progressMetrics.totalTasks) * 100}
                      className="h-2"
                    />
                  </div>

                  <div className="pt-2 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Velocity:</span>
                      <span className="font-semibold">
                        {progressMetrics.velocity.toFixed(2)} tasks/hr
                      </span>
                    </div>
                    {progressMetrics.averageTaskDuration > 0 && (
                      <div className="flex justify-between">
                        <span>Avg Duration:</span>
                        <span className="font-semibold">
                          {formatDuration(progressMetrics.averageTaskDuration)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Real-time Tab */}
        <TabsContent value="realtime" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Real-time Monitoring
              </CardTitle>
              <CardDescription>Live updates and current activity status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        entity.currentState === "active"
                          ? "bg-green-500 animate-pulse"
                          : "bg-gray-400",
                      )}
                    />
                    <span className="font-medium">
                      {entity.currentState === "active" ? "Workflow Active" : "Workflow Inactive"}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    Last update: {new Date().toLocaleTimeString()}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                  <div className="p-4 border rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {progressMetrics.completedTasks}
                    </div>
                    <div className="text-sm text-muted-foreground">Tasks Completed</div>
                  </div>

                  <div className="p-4 border rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {progressMetrics.velocity.toFixed(1)}
                    </div>
                    <div className="text-sm text-muted-foreground">Tasks/Hour</div>
                  </div>

                  <div className="p-4 border rounded-lg">
                    <div className="text-2xl font-bold text-orange-600">
                      {progressMetrics.errorRate.toFixed(1)}%
                    </div>
                    <div className="text-sm text-muted-foreground">Error Rate</div>
                  </div>
                </div>

                {/* Latest Events */}
                <div>
                  <h4 className="font-medium mb-3">Latest Activity</h4>
                  <div className="space-y-2">
                    {timelineEvents.slice(0, 5).map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center gap-3 p-2 bg-muted/20 rounded"
                      >
                        {getEventIcon(event.type)}
                        <div className="flex-1">
                          <span className="text-sm font-medium">{event.title}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
