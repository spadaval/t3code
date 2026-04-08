import React, { useState, useCallback } from "react";
import { cn } from "~/lib/utils";
import type { WorkflowEntity, WorkflowTransitionReason } from "@t3tools/contracts/workflowState";
import type { SwarmRunId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Alert, AlertDescription } from "../ui/alert";
import { Separator } from "../ui/separator";
import {
  AlertTriangle,
  XCircle,
  Info,
  RefreshCw,
  RotateCcw,
  SkipForward,
  Settings,
  Bug,
  FileText,
  ExternalLink,
  CheckCircle,
  Clock,
  HelpCircle,
  Zap,
} from "lucide-react";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

interface ErrorHandlingSystemProps {
  entity: WorkflowEntity;
  onRetryOperation: (runId: SwarmRunId, operationType: string) => Promise<void>;
  onSkipError: (runId: SwarmRunId, errorId: string, reason: string) => Promise<void>;
  onRestartFromCheckpoint: (runId: SwarmRunId, checkpointId: string) => Promise<void>;
  onCollectDiagnostics: (runId: SwarmRunId) => Promise<DiagnosticInfo>;
  onReportError: (
    runId: SwarmRunId,
    description: string,
    context: Record<string, unknown>,
  ) => Promise<void>;
  className?: string;
}

interface ErrorDetails {
  id: string;
  type:
    | "task_failure"
    | "orchestration_error"
    | "timeout"
    | "resource_unavailable"
    | "validation_error";
  title: string;
  description: string;
  timestamp: string;
  severity: "low" | "medium" | "high" | "critical";
  isRecoverable: boolean;
  suggestedActions: ErrorAction[];
  context: Record<string, unknown>;
  stackTrace?: string;
  relatedErrors?: string[];
}

interface ErrorAction {
  id: string;
  label: string;
  description: string;
  type: "retry" | "skip" | "restart" | "escalate" | "diagnose";
  automated: boolean;
  riskLevel: "safe" | "moderate" | "risky";
  estimatedTime?: string;
}

interface DiagnosticInfo {
  systemStatus: "healthy" | "degraded" | "failed";
  resourceUsage: {
    cpu: number;
    memory: number;
    network: "good" | "poor" | "offline";
  };
  dependencyStatus: Array<{
    name: string;
    status: "up" | "down" | "degraded";
    lastChecked: string;
  }>;
  recentLogs: Array<{
    level: "info" | "warn" | "error";
    message: string;
    timestamp: string;
  }>;
}

/**
 * Enhanced Error Handling System
 *
 * Provides comprehensive error management with explicit error states,
 * actionable recovery options, and diagnostic capabilities.
 */
export function ErrorHandlingSystem({
  entity,
  onRetryOperation,
  onSkipError,
  onRestartFromCheckpoint,
  onCollectDiagnostics,
  onReportError,
  className,
}: ErrorHandlingSystemProps) {
  const [activeTab, setActiveTab] = useState("current");
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [reportDescription, setReportDescription] = useState("");

  // Extract error information from entity state
  const currentErrors = extractErrorsFromEntity(entity);
  const hasErrors =
    currentErrors.length > 0 ||
    entity.currentState.includes("blocked") ||
    entity.currentState.includes("failed");
  const isRecoverable = entity.currentState.includes("recoverable") || entity.requiresIntervention;

  const handleRetry = useCallback(
    async (errorId: string, operationType: string) => {
      try {
        setLoading(`retry-${errorId}`);
        await onRetryOperation(entity.id as SwarmRunId, operationType);
      } catch (error) {
        console.error("Failed to retry operation:", error);
      } finally {
        setLoading(null);
      }
    },
    [entity.id, onRetryOperation],
  );

  const handleSkip = useCallback(
    async (errorId: string, reason: string) => {
      try {
        setLoading(`skip-${errorId}`);
        await onSkipError(entity.id as SwarmRunId, errorId, reason);
      } catch (error) {
        console.error("Failed to skip error:", error);
      } finally {
        setLoading(null);
      }
    },
    [entity.id, onSkipError],
  );

  const handleRestart = useCallback(
    async (checkpointId: string) => {
      try {
        setLoading("restart");
        await onRestartFromCheckpoint(entity.id as SwarmRunId, checkpointId);
      } catch (error) {
        console.error("Failed to restart from checkpoint:", error);
      } finally {
        setLoading(null);
      }
    },
    [entity.id, onRestartFromCheckpoint],
  );

  const handleDiagnostics = useCallback(async () => {
    try {
      setLoading("diagnostics");
      const diagnosticInfo = await onCollectDiagnostics(entity.id as SwarmRunId);
      setDiagnostics(diagnosticInfo);
      setActiveTab("diagnostics");
    } catch (error) {
      console.error("Failed to collect diagnostics:", error);
    } finally {
      setLoading(null);
    }
  }, [entity.id, onCollectDiagnostics]);

  const handleReportError = useCallback(async () => {
    if (!reportDescription.trim()) return;

    try {
      setLoading("report");
      await onReportError(entity.id as SwarmRunId, reportDescription, {
        currentState: entity.currentState,
        timestamp: new Date().toISOString(),
        errors: currentErrors,
      });
      setReportDescription("");
    } catch (error) {
      console.error("Failed to report error:", error);
    } finally {
      setLoading(null);
    }
  }, [entity.id, reportDescription, entity.currentState, currentErrors, onReportError]);

  const getErrorIcon = (type: ErrorDetails["type"]) => {
    switch (type) {
      case "task_failure":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "orchestration_error":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "timeout":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "resource_unavailable":
        return <Zap className="h-4 w-4 text-purple-500" />;
      case "validation_error":
        return <Info className="h-4 w-4 text-blue-500" />;
      default:
        return <Bug className="h-4 w-4 text-gray-500" />;
    }
  };

  const getSeverityColor = (severity: ErrorDetails["severity"]) => {
    switch (severity) {
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200";
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "low":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getActionIcon = (type: ErrorAction["type"]) => {
    switch (type) {
      case "retry":
        return <RefreshCw className="h-4 w-4" />;
      case "skip":
        return <SkipForward className="h-4 w-4" />;
      case "restart":
        return <RotateCcw className="h-4 w-4" />;
      case "escalate":
        return <ExternalLink className="h-4 w-4" />;
      case "diagnose":
        return <Bug className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

  const getRiskColor = (risk: ErrorAction["riskLevel"]) => {
    switch (risk) {
      case "safe":
        return "text-green-600";
      case "moderate":
        return "text-yellow-600";
      case "risky":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  if (
    !hasErrors &&
    entity.currentState !== "blocked_recoverable" &&
    entity.currentState !== "blocked_fatal"
  ) {
    return (
      <Card className={cn("", className)}>
        <CardContent className="pt-6">
          <div className="text-center py-8">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-medium text-green-800 mb-2">No Errors Detected</h3>
            <p className="text-sm text-green-600">
              Workflow is running smoothly without any errors or issues.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header Alert */}
      {hasErrors && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Error Detected:</strong> {entity.title} has encountered {currentErrors.length}{" "}
            error(s) and requires {isRecoverable ? "manual intervention" : "immediate attention"}.
          </AlertDescription>
        </Alert>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Quick Recovery Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleDiagnostics}
              disabled={loading !== null}
              variant="outline"
              className="flex items-center gap-2"
            >
              {loading === "diagnostics" ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
              ) : (
                <Bug className="h-4 w-4" />
              )}
              Run Diagnostics
            </Button>

            {isRecoverable && (
              <>
                <Button
                  onClick={() => handleRetry("current", "workflow")}
                  disabled={loading !== null}
                  className="flex items-center gap-2"
                >
                  {loading?.startsWith("retry") ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Retry Operation
                </Button>

                <Button
                  onClick={() => handleRestart("last_known_good")}
                  disabled={loading !== null}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  {loading === "restart" ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Restart from Checkpoint
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Main Error Handling Interface */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="current">Current Errors</TabsTrigger>
          <TabsTrigger value="recovery">Recovery Options</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="report">Report Issue</TabsTrigger>
        </TabsList>

        {/* Current Errors Tab */}
        <TabsContent value="current" className="space-y-4">
          {currentErrors.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  No specific error details available. Check the diagnostics tab for more
                  information.
                </p>
              </CardContent>
            </Card>
          ) : (
            currentErrors.map((error) => (
              <ErrorCard
                key={error.id}
                error={error}
                isExpanded={expandedError === error.id}
                onToggleExpanded={() =>
                  setExpandedError(expandedError === error.id ? null : error.id)
                }
                onAction={(actionType, actionId) => {
                  switch (actionType) {
                    case "retry":
                      handleRetry(error.id, error.type);
                      break;
                    case "skip":
                      handleSkip(error.id, `Skipping error: ${error.title}`);
                      break;
                    case "restart":
                      handleRestart("before_error");
                      break;
                  }
                }}
                loading={loading}
                getErrorIcon={getErrorIcon}
                getSeverityColor={getSeverityColor}
                getActionIcon={getActionIcon}
                getRiskColor={getRiskColor}
              />
            ))
          )}
        </TabsContent>

        {/* Recovery Options Tab */}
        <TabsContent value="recovery" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Available Recovery Strategies</CardTitle>
              <CardDescription>
                Choose the best recovery approach based on your situation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Automated Recovery */}
              <div className="space-y-3">
                <h4 className="font-medium text-green-700">Automated Recovery</h4>
                <div className="space-y-2">
                  <Button
                    onClick={() => handleRetry("auto", "full_workflow")}
                    disabled={loading !== null}
                    className="w-full justify-start"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Auto-retry with backoff strategy
                  </Button>
                  <p className="text-xs text-muted-foreground ml-6">
                    Automatically retry failed operations with increasing delays
                  </p>
                </div>
              </div>

              <Separator />

              {/* Manual Recovery */}
              <div className="space-y-3">
                <h4 className="font-medium text-blue-700">Manual Recovery</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    onClick={() => handleRestart("last_checkpoint")}
                    disabled={loading !== null}
                    className="justify-start"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Restart from last checkpoint
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleSkip("all", "Manual skip requested")}
                    disabled={loading !== null}
                    className="justify-start"
                  >
                    <SkipForward className="h-4 w-4 mr-2" />
                    Skip problematic tasks
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Advanced Recovery */}
              <div className="space-y-3">
                <h4 className="font-medium text-orange-700">Advanced Recovery</h4>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    disabled={loading !== null}
                    className="w-full justify-start border-orange-200 text-orange-700 hover:bg-orange-50"
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Manual state modification
                  </Button>
                  <p className="text-xs text-muted-foreground ml-6">
                    Directly modify workflow state (requires admin privileges)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Diagnostics Tab */}
        <TabsContent value="diagnostics" className="space-y-4">
          {!diagnostics ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <Bug className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-muted-foreground mb-4">
                    No diagnostic information collected yet
                  </p>
                  <Button onClick={handleDiagnostics} disabled={loading !== null}>
                    {loading === "diagnostics" ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    ) : (
                      <Bug className="h-4 w-4 mr-2" />
                    )}
                    Run System Diagnostics
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <DiagnosticsDisplay diagnostics={diagnostics} />
          )}
        </TabsContent>

        {/* Report Issue Tab */}
        <TabsContent value="report" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report Error to Support</CardTitle>
              <CardDescription>
                Describe the issue you're experiencing for investigation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="error-description">Error description:</Label>
                <Textarea
                  id="error-description"
                  placeholder="Describe what happened, what you expected, and any steps to reproduce the issue..."
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h5 className="font-medium">Automatically included information:</h5>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Workflow state and configuration</li>
                  <li>• Recent execution history</li>
                  <li>• Error context and stack traces</li>
                  <li>• System environment details</li>
                </ul>
              </div>

              <Button
                onClick={handleReportError}
                disabled={loading !== null || !reportDescription.trim()}
                className="w-full"
              >
                {loading === "report" ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                ) : (
                  <ExternalLink className="h-4 w-4 mr-2" />
                )}
                Send Error Report
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper component for individual error cards
interface ErrorCardProps {
  error: ErrorDetails;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onAction: (actionType: string, actionId: string) => void;
  loading: string | null;
  getErrorIcon: (type: ErrorDetails["type"]) => React.ReactNode;
  getSeverityColor: (severity: ErrorDetails["severity"]) => string;
  getActionIcon: (type: ErrorAction["type"]) => React.ReactNode;
  getRiskColor: (risk: ErrorAction["riskLevel"]) => string;
}

function ErrorCard({
  error,
  isExpanded,
  onToggleExpanded,
  onAction,
  loading,
  getErrorIcon,
  getSeverityColor,
  getActionIcon,
  getRiskColor,
}: ErrorCardProps) {
  return (
    <Card
      className={cn(
        "border-l-4",
        error.severity === "critical" ? "border-l-red-500" : "border-l-orange-500",
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={onToggleExpanded}>
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="cursor-pointer">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                {getErrorIcon(error.type)}
                <div>
                  <CardTitle className="text-base">{error.title}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className={getSeverityColor(error.severity)}>
                      {error.severity}
                    </Badge>
                    <span>{error.isRecoverable ? "Recoverable" : "Fatal"}</span>
                  </CardDescription>
                </div>
              </div>
              <time className="text-xs text-muted-foreground">
                {new Date(error.timestamp).toLocaleString()}
              </time>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0">
            <p className="text-sm mb-4">{error.description}</p>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {error.suggestedActions.map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={action.type === "retry" ? "default" : "outline"}
                  onClick={() => onAction(action.type, action.id)}
                  disabled={loading !== null}
                  className="flex items-center gap-2"
                >
                  {getActionIcon(action.type)}
                  <span>{action.label}</span>
                  {action.riskLevel !== "safe" && (
                    <span className={cn("text-xs", getRiskColor(action.riskLevel))}>
                      ({action.riskLevel})
                    </span>
                  )}
                </Button>
              ))}
            </div>

            {/* Additional Details */}
            {(error.context || error.stackTrace) && (
              <details className="text-xs">
                <summary className="cursor-pointer font-medium mb-2">Technical Details</summary>
                {error.context && (
                  <div className="mb-2">
                    <strong>Context:</strong>
                    <pre className="mt-1 p-2 bg-muted rounded overflow-auto">
                      {JSON.stringify(error.context, null, 2)}
                    </pre>
                  </div>
                )}
                {error.stackTrace && (
                  <div>
                    <strong>Stack Trace:</strong>
                    <pre className="mt-1 p-2 bg-muted rounded overflow-auto font-mono">
                      {error.stackTrace}
                    </pre>
                  </div>
                )}
              </details>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Helper component for diagnostics display
function DiagnosticsDisplay({ diagnostics }: { diagnostics: DiagnosticInfo }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
      case "up":
        return "text-green-600 bg-green-50 border-green-200";
      case "degraded":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      case "failed":
      case "down":
        return "text-red-600 bg-red-50 border-red-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  return (
    <div className="space-y-4">
      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-4">
            <span className="font-medium">Overall Status:</span>
            <Badge className={getStatusColor(diagnostics.systemStatus)}>
              {diagnostics.systemStatus}
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{diagnostics.resourceUsage.cpu}%</div>
              <div className="text-sm text-muted-foreground">CPU Usage</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{diagnostics.resourceUsage.memory}%</div>
              <div className="text-sm text-muted-foreground">Memory Usage</div>
            </div>
            <div className="text-center">
              <Badge
                className={getStatusColor(
                  diagnostics.resourceUsage.network === "good" ? "healthy" : "degraded",
                )}
              >
                {diagnostics.resourceUsage.network}
              </Badge>
              <div className="text-sm text-muted-foreground">Network</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dependencies */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service Dependencies</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {diagnostics.dependencyStatus.map((dep) => (
              <div key={dep.name} className="flex items-center justify-between">
                <span className="font-medium">{dep.name}</span>
                <div className="flex items-center gap-2">
                  <Badge className={getStatusColor(dep.status)}>{dep.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(dep.lastChecked).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Logs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {diagnostics.recentLogs.map((log, index) => (
              <div key={index} className="flex items-start gap-2 text-sm">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    log.level === "error" && "border-red-200 text-red-700",
                    log.level === "warn" && "border-yellow-200 text-yellow-700",
                    log.level === "info" && "border-blue-200 text-blue-700",
                  )}
                >
                  {log.level}
                </Badge>
                <div className="flex-1">
                  <p className="font-mono text-xs">{log.message}</p>
                  <time className="text-xs text-muted-foreground">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </time>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Helper function to extract errors from entity state
function extractErrorsFromEntity(entity: WorkflowEntity): ErrorDetails[] {
  const errors: ErrorDetails[] = [];

  // Generate mock errors based on entity state
  if (entity.currentState.includes("blocked") || entity.currentState.includes("failed")) {
    const errorType = entity.currentState.includes("task") ? "task_failure" : "orchestration_error";

    errors.push({
      id: "current-error",
      type: errorType,
      title: `Workflow ${entity.currentState.replace("_", " ")}`,
      description: `The workflow has encountered an issue and is currently in ${entity.currentState} state.`,
      timestamp: entity.updatedAt,
      severity: entity.currentState.includes("fatal") ? "critical" : "high",
      isRecoverable: Boolean(
        entity.currentState.includes("recoverable") || entity.requiresIntervention,
      ),
      suggestedActions: [
        {
          id: "retry",
          label: "Retry",
          description: "Attempt to retry the failed operation",
          type: "retry",
          automated: false,
          riskLevel: "safe",
          estimatedTime: "2-5 minutes",
        },
        {
          id: "skip",
          label: "Skip",
          description: "Skip the problematic step and continue",
          type: "skip",
          automated: false,
          riskLevel: "moderate",
          estimatedTime: "1 minute",
        },
        {
          id: "restart",
          label: "Restart",
          description: "Restart workflow from a previous checkpoint",
          type: "restart",
          automated: false,
          riskLevel: "risky",
          estimatedTime: "5-10 minutes",
        },
      ],
      context: {
        entityId: entity.id,
        currentState: entity.currentState,
        lastTransition: entity.stateHistory?.at(-1) ?? null,
      },
    });
  }

  return errors;
}
