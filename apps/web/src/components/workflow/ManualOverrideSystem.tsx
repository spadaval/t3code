import React, { useState } from "react";
import { cn } from "~/lib/utils";
import type { WorkflowEntity } from "@t3tools/contracts/workflowState";
import type { SwarmRunId } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Separator } from "../ui/separator";
import {
  Settings2,
  PlayCircle,
  PauseCircle,
  StopCircle,
  RotateCcw,
  FastForward,
  StepForward,
  Bug,
  Eye,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Edit3,
} from "lucide-react";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

interface ManualOverrideSystemProps {
  entity: WorkflowEntity;
  onStepThrough: (
    runId: SwarmRunId,
    mode: "single" | "until_error" | "until_intervention",
  ) => Promise<void>;
  onManualAssignment: (runId: SwarmRunId, taskId: string, assignee: string) => Promise<void>;
  onWorkflowRestart: (runId: SwarmRunId, fromStep?: string) => Promise<void>;
  onDebugMode: (runId: SwarmRunId, enabled: boolean) => Promise<void>;
  onInjectCommand: (
    runId: SwarmRunId,
    command: string,
    context?: Record<string, unknown>,
  ) => Promise<void>;
  onModifyWorkflowState: (runId: SwarmRunId, newState: string, reason: string) => Promise<void>;
  className?: string;
}

interface DebugSession {
  id: string;
  entityId: string;
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  mode: "single" | "until_error" | "until_intervention";
  breakpoints: number[];
  variables: Record<string, unknown>;
}

/**
 * Manual Override System
 *
 * Provides advanced manual control capabilities for workflow debugging and intervention.
 * This is the power-user interface for when automated workflows need direct manipulation.
 */
export function ManualOverrideSystem({
  entity,
  onStepThrough,
  onManualAssignment,
  onWorkflowRestart,
  onDebugMode,
  onInjectCommand,
  onModifyWorkflowState,
  className,
}: ManualOverrideSystemProps) {
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const [activeTab, setActiveTab] = useState("control");
  const [loading, setLoading] = useState<string | null>(null);

  // Step-through controls
  const [stepMode, setStepMode] = useState<"single" | "until_error" | "until_intervention">(
    "single",
  );

  // Manual assignment state
  const [assignTaskId, setAssignTaskId] = useState("");
  const [assignee, setAssignee] = useState("");

  // Workflow restart state
  const [restartFromStep, setRestartFromStep] = useState("");

  // Command injection state
  const [injectedCommand, setInjectedCommand] = useState("");
  const [commandContext, setCommandContext] = useState("{}");

  // State modification
  const [newState, setNewState] = useState("");
  const [stateChangeReason, setStateChangeReason] = useState("");

  const runId = entity.id as SwarmRunId;

  const handleStepThrough = async () => {
    try {
      setLoading("step_through");
      await onStepThrough(runId, stepMode);

      // Simulate debug session creation
      const newDebugSession: DebugSession = {
        id: crypto.randomUUID(),
        entityId: entity.id,
        isActive: true,
        currentStep: debugSession?.currentStep ? debugSession.currentStep + 1 : 1,
        totalSteps: 10, // This would come from the actual workflow
        mode: stepMode,
        breakpoints: debugSession?.breakpoints || [],
        variables: {
          /* This would come from actual state */
        },
      };
      setDebugSession(newDebugSession);
    } catch (error) {
      console.error("Failed to start step-through:", error);
    } finally {
      setLoading(null);
    }
  };

  const handleManualAssignment = async () => {
    if (!assignTaskId.trim() || !assignee.trim()) return;

    try {
      setLoading("manual_assignment");
      await onManualAssignment(runId, assignTaskId, assignee);
      setAssignTaskId("");
      setAssignee("");
    } catch (error) {
      console.error("Failed to assign task:", error);
    } finally {
      setLoading(null);
    }
  };

  const handleWorkflowRestart = async () => {
    try {
      setLoading("workflow_restart");
      await onWorkflowRestart(runId, restartFromStep || undefined);
      setRestartFromStep("");
    } catch (error) {
      console.error("Failed to restart workflow:", error);
    } finally {
      setLoading(null);
    }
  };

  const handleToggleDebugMode = async (enabled: boolean) => {
    try {
      setLoading("debug_mode");
      await onDebugMode(runId, enabled);

      if (enabled) {
        const newDebugSession: DebugSession = {
          id: crypto.randomUUID(),
          entityId: entity.id,
          isActive: true,
          currentStep: 0,
          totalSteps: 10,
          mode: "single",
          breakpoints: [],
          variables: {},
        };
        setDebugSession(newDebugSession);
      } else {
        setDebugSession(null);
      }
    } catch (error) {
      console.error("Failed to toggle debug mode:", error);
    } finally {
      setLoading(null);
    }
  };

  const handleInjectCommand = async () => {
    if (!injectedCommand.trim()) return;

    try {
      setLoading("inject_command");
      const context = JSON.parse(commandContext || "{}");
      await onInjectCommand(runId, injectedCommand, context);
      setInjectedCommand("");
      setCommandContext("{}");
    } catch (error) {
      console.error("Failed to inject command:", error);
    } finally {
      setLoading(null);
    }
  };

  const handleModifyState = async () => {
    if (!newState.trim() || !stateChangeReason.trim()) return;

    try {
      setLoading("modify_state");
      await onModifyWorkflowState(runId, newState, stateChangeReason);
      setNewState("");
      setStateChangeReason("");
    } catch (error) {
      console.error("Failed to modify state:", error);
    } finally {
      setLoading(null);
    }
  };

  const isWorkflowActive = !["completed", "cancelled", "failed"].includes(entity.currentState);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <Card className="border-orange-200 bg-orange-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-800">
            <Settings2 className="h-5 w-5" />
            Manual Override System
            <Badge variant="outline" className="ml-2">
              Advanced Controls
            </Badge>
          </CardTitle>
          <CardDescription className="text-orange-700">
            Direct manual control and debugging for {entity.title}. Use these controls when
            automated workflow needs manual intervention.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Debug Session Status */}
      {debugSession && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="bg-blue-100">
                  <Bug className="h-3 w-3 mr-1" />
                  Debug Active
                </Badge>
                <span className="text-sm">
                  Step {debugSession.currentStep} / {debugSession.totalSteps}
                </span>
                <Badge variant="outline">{debugSession.mode}</Badge>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleToggleDebugMode(false)}>
                End Debug Session
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Controls */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="control">Control</TabsTrigger>
          <TabsTrigger value="debug">Debug</TabsTrigger>
          <TabsTrigger value="assignment">Assignment</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        {/* Basic Control Tab */}
        <TabsContent value="control" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow Control</CardTitle>
              <CardDescription>Basic workflow control and restart options</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="default"
                  onClick={() => handleToggleDebugMode(!debugSession)}
                  disabled={loading !== null}
                  className="flex items-center gap-2"
                >
                  {debugSession ? <StopCircle className="h-4 w-4" /> : <Bug className="h-4 w-4" />}
                  {debugSession ? "Stop Debug" : "Start Debug"}
                </Button>

                {isWorkflowActive && (
                  <Button
                    variant="outline"
                    onClick={handleStepThrough}
                    disabled={loading !== null}
                    className="flex items-center gap-2"
                  >
                    {loading === "step_through" ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      <StepForward className="h-4 w-4" />
                    )}
                    Single Step
                  </Button>
                )}
              </div>

              <Separator />

              {/* Workflow Restart */}
              <div className="space-y-3">
                <h4 className="font-medium">Restart Workflow</h4>
                <div className="space-y-2">
                  <Label htmlFor="restart-step">Restart from step (optional):</Label>
                  <Input
                    id="restart-step"
                    placeholder="Leave empty to restart from beginning"
                    value={restartFromStep}
                    onChange={(e) => setRestartFromStep(e.target.value)}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={handleWorkflowRestart}
                  disabled={loading !== null}
                  className="flex items-center gap-2"
                >
                  {loading === "workflow_restart" ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                  Restart Workflow
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Debug Tab */}
        <TabsContent value="debug" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step-Through Debugging</CardTitle>
              <CardDescription>
                Execute workflow one step at a time with full visibility
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Step Mode Selection */}
              <div className="space-y-2">
                <Label>Step execution mode:</Label>
                <Select value={stepMode} onValueChange={(value: any) => setStepMode(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Step</SelectItem>
                    <SelectItem value="until_error">Run Until Error</SelectItem>
                    <SelectItem value="until_intervention">Run Until Intervention</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Debug Controls */}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleStepThrough}
                  disabled={loading !== null || !isWorkflowActive}
                  className="flex items-center gap-2"
                >
                  {loading === "step_through" ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <StepForward className="h-4 w-4" />
                  )}
                  Execute Step
                </Button>

                <Button
                  variant="outline"
                  disabled={loading !== null || !debugSession}
                  className="flex items-center gap-2"
                >
                  <Eye className="h-4 w-4" />
                  Inspect Variables
                </Button>

                <Button
                  variant="outline"
                  disabled={loading !== null || !debugSession}
                  className="flex items-center gap-2"
                >
                  <Terminal className="h-4 w-4" />
                  View Call Stack
                </Button>
              </div>

              {/* Debug Session Info */}
              {debugSession && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <h5 className="font-medium">Current Debug Session</h5>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <strong>Current Step:</strong> {debugSession.currentStep}
                    </div>
                    <div>
                      <strong>Mode:</strong> {debugSession.mode}
                    </div>
                    <div>
                      <strong>Breakpoints:</strong> {debugSession.breakpoints.length}
                    </div>
                    <div>
                      <strong>Status:</strong> {debugSession.isActive ? "Active" : "Paused"}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual Assignment Tab */}
        <TabsContent value="assignment" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manual Task Assignment</CardTitle>
              <CardDescription>Manually assign tasks to specific workers or agents</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="task-id">Task ID:</Label>
                <Input
                  id="task-id"
                  placeholder="Enter task execution ID"
                  value={assignTaskId}
                  onChange={(e) => setAssignTaskId(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="assignee">Assign to:</Label>
                <Input
                  id="assignee"
                  placeholder="Worker/agent identifier"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                />
              </div>

              <Button
                onClick={handleManualAssignment}
                disabled={loading !== null || !assignTaskId.trim() || !assignee.trim()}
                className="flex items-center gap-2"
              >
                {loading === "manual_assignment" ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Assign Task
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Advanced Tab */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Advanced Controls</CardTitle>
              <CardDescription>Direct workflow manipulation - use with caution</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Command Injection */}
              <div className="space-y-3">
                <h4 className="font-medium text-orange-800">Command Injection</h4>
                <div className="space-y-2">
                  <Label htmlFor="command">Command:</Label>
                  <Input
                    id="command"
                    placeholder="e.g., pause_execution, force_complete, etc."
                    value={injectedCommand}
                    onChange={(e) => setInjectedCommand(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="context">Context (JSON):</Label>
                  <Textarea
                    id="context"
                    placeholder='{"param1": "value1", "param2": "value2"}'
                    value={commandContext}
                    onChange={(e) => setCommandContext(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleInjectCommand}
                  disabled={loading !== null || !injectedCommand.trim()}
                  className="flex items-center gap-2 text-orange-700 border-orange-300 hover:bg-orange-50"
                >
                  {loading === "inject_command" ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                  ) : (
                    <Terminal className="h-4 w-4" />
                  )}
                  Inject Command
                </Button>
              </div>

              <Separator />

              {/* State Modification */}
              <div className="space-y-3">
                <h4 className="font-medium text-red-800">Direct State Modification</h4>
                <div className="space-y-2">
                  <Label htmlFor="new-state">New State:</Label>
                  <Select value={newState} onValueChange={setNewState}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select new state" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="blocked_recoverable">Blocked (Recoverable)</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state-reason">Reason for change:</Label>
                  <Textarea
                    id="state-reason"
                    placeholder="Explain why you're manually changing the state..."
                    value={stateChangeReason}
                    onChange={(e) => setStateChangeReason(e.target.value)}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={handleModifyState}
                  disabled={loading !== null || !newState || !stateChangeReason.trim()}
                  className="flex items-center gap-2"
                >
                  {loading === "modify_state" ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <Edit3 className="h-4 w-4" />
                  )}
                  Modify State
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
