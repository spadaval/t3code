import React, { useState, useEffect } from "react";
import { cn } from "~/lib/utils";
import type { WorkflowEntity } from "@t3tools/contracts/workflowState";
import type { SwarmRunId, SwarmTaskExecutionId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import {
  PlayCircle,
  CheckCircle2,
  XCircle,
  SkipForward,
  Clock,
  AlertTriangle,
  Info,
  ArrowRight,
  Settings,
} from "lucide-react";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

interface ManualTaskControlProps {
  entity: WorkflowEntity;
  onExecuteNextTask: (runId: SwarmRunId) => Promise<void>;
  onMarkTaskCompleted: (runId: SwarmRunId, taskId: SwarmTaskExecutionId) => Promise<void>;
  onMarkTaskFailed: (
    runId: SwarmRunId,
    taskId: SwarmTaskExecutionId,
    reason: string,
  ) => Promise<void>;
  onGetExecutionHistory: (
    runId: SwarmRunId,
  ) => Promise<readonly { timestamp: string; event: string; context: Record<string, unknown> }[]>;
  className?: string;
}

interface TaskExecutionEvent {
  timestamp: string;
  event: string;
  context: Record<string, unknown>;
}

/**
 * Manual Task Control Panel
 *
 * Provides granular control over task execution for swarm workflows.
 * This is a key component of the simplified workflow system that gives
 * users direct control when automation fails or needs guidance.
 */
export function ManualTaskControl({
  entity,
  onExecuteNextTask,
  onMarkTaskCompleted,
  onMarkTaskFailed,
  onGetExecutionHistory,
  className,
}: ManualTaskControlProps) {
  const [history, setHistory] = useState<readonly TaskExecutionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Task completion/failure dialog state
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [taskDialogMode, setTaskDialogMode] = useState<"complete" | "fail">("complete");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [taskReason, setTaskReason] = useState("");

  const runId = entity.id as SwarmRunId;

  useEffect(() => {
    loadHistory();
  }, [runId]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const executionHistory = await onGetExecutionHistory(runId);
      setHistory(executionHistory);
    } catch (error) {
      console.error("Failed to load execution history:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteNext = async () => {
    try {
      setActionInProgress("execute_next");
      await onExecuteNextTask(runId);
      await loadHistory(); // Refresh history after action
    } catch (error) {
      console.error("Failed to execute next task:", error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTaskComplete = async () => {
    if (!selectedTaskId) return;

    try {
      setActionInProgress("complete");
      await onMarkTaskCompleted(runId, selectedTaskId as SwarmTaskExecutionId);
      await loadHistory();
      setShowTaskDialog(false);
      setSelectedTaskId("");
      setTaskReason("");
    } catch (error) {
      console.error("Failed to mark task completed:", error);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleTaskFail = async () => {
    if (!selectedTaskId || !taskReason.trim()) return;

    try {
      setActionInProgress("fail");
      await onMarkTaskFailed(runId, selectedTaskId as SwarmTaskExecutionId, taskReason);
      await loadHistory();
      setShowTaskDialog(false);
      setSelectedTaskId("");
      setTaskReason("");
    } catch (error) {
      console.error("Failed to mark task failed:", error);
    } finally {
      setActionInProgress(null);
    }
  };

  const openTaskDialog = (mode: "complete" | "fail", taskId?: string) => {
    setTaskDialogMode(mode);
    setSelectedTaskId(taskId || "");
    setTaskReason("");
    setShowTaskDialog(true);
  };

  const getEventIcon = (event: string) => {
    if (event.includes("completed")) return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (event.includes("failed") || event.includes("error"))
      return <XCircle className="h-4 w-4 text-red-500" />;
    if (event.includes("started") || event.includes("requested"))
      return <PlayCircle className="h-4 w-4 text-blue-500" />;
    if (event.includes("paused")) return <Clock className="h-4 w-4 text-yellow-500" />;
    if (event.includes("intervention"))
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    return <Info className="h-4 w-4 text-gray-500" />;
  };

  const getEventDescription = (event: string) => {
    return event
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  // Extract current and recent tasks from history
  const currentTask = history
    .slice()
    .reverse()
    .find(
      (e) =>
        e.event.includes("task_execution_requested") &&
        !e.event.includes("completed") &&
        !e.event.includes("failed"),
    );

  const recentTasks = history
    .filter((e) => e.event.includes("task_"))
    .slice(-10)
    .reverse();

  return (
    <div className={cn("space-y-6", className)}>
      {/* Current State Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Manual Task Control
          </CardTitle>
          <CardDescription>Direct control over task execution for {entity.title}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Current Status */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-3">
              <Badge variant="outline">{entity.currentState}</Badge>
              <span className="text-sm text-muted-foreground">
                Progress: {entity.progress?.completed || 0} / {entity.progress?.total || 0} tasks
              </span>
            </div>
            {entity.requiresIntervention && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Intervention Required
              </Badge>
            )}
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleExecuteNext}
              disabled={
                actionInProgress !== null ||
                entity.currentState === "completed" ||
                entity.currentState === "cancelled"
              }
              className="flex items-center gap-2"
            >
              {actionInProgress === "execute_next" ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Execute Next Task
            </Button>

            <Button
              variant="outline"
              onClick={() => openTaskDialog("complete")}
              disabled={actionInProgress !== null}
              className="flex items-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark Task Completed
            </Button>

            <Button
              variant="outline"
              onClick={() => openTaskDialog("fail")}
              disabled={actionInProgress !== null}
              className="flex items-center gap-2"
            >
              <XCircle className="h-4 w-4" />
              Mark Task Failed
            </Button>

            <Button
              variant="ghost"
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2"
            >
              <Info className="h-4 w-4" />
              {showHistory ? "Hide" : "Show"} History
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Current Task Info */}
      {currentTask && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Task</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <PlayCircle className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="font-medium">Task in Progress</p>
                  <p className="text-sm text-muted-foreground">
                    Started: {formatTimestamp(currentTask.timestamp)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => openTaskDialog("complete", currentTask.context.taskId as string)}
                  disabled={actionInProgress !== null}
                >
                  Complete
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openTaskDialog("fail", currentTask.context.taskId as string)}
                  disabled={actionInProgress !== null}
                >
                  Mark Failed
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution History */}
      {showHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execution History</CardTitle>
            <CardDescription>Recent task execution events</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No execution history available
              </p>
            ) : (
              <div className="space-y-3">
                {recentTasks.map((event, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                    {getEventIcon(event.event)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{getEventDescription(event.event)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimestamp(event.timestamp)}
                      </p>
                      {Object.keys(event.context).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs cursor-pointer text-muted-foreground">
                            View context
                          </summary>
                          <pre className="text-xs mt-1 p-2 bg-background rounded overflow-auto">
                            {JSON.stringify(event.context, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Task Action Dialog */}
      <Dialog open={showTaskDialog} onOpenChange={setShowTaskDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {taskDialogMode === "complete" ? "Mark Task Completed" : "Mark Task Failed"}
            </DialogTitle>
            <DialogDescription>
              {taskDialogMode === "complete"
                ? "Mark this task as successfully completed"
                : "Mark this task as failed and provide a reason"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="task-id">Task ID:</Label>
              <Textarea
                id="task-id"
                placeholder="Enter task execution ID..."
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            {taskDialogMode === "fail" && (
              <div className="space-y-2">
                <Label htmlFor="task-reason">Reason for failure:</Label>
                <Textarea
                  id="task-reason"
                  placeholder="Explain why this task failed..."
                  value={taskReason}
                  onChange={(e) => setTaskReason(e.target.value)}
                  className="min-h-[100px]"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowTaskDialog(false)}
                disabled={actionInProgress !== null}
              >
                Cancel
              </Button>
              <Button
                onClick={taskDialogMode === "complete" ? handleTaskComplete : handleTaskFail}
                disabled={
                  actionInProgress !== null ||
                  !selectedTaskId.trim() ||
                  (taskDialogMode === "fail" && !taskReason.trim())
                }
              >
                {actionInProgress ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                ) : taskDialogMode === "complete" ? (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                ) : (
                  <XCircle className="h-4 w-4 mr-2" />
                )}
                {taskDialogMode === "complete" ? "Mark Completed" : "Mark Failed"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
