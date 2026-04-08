import React, { useState } from "react";
import { cn } from "~/lib/utils";
import type { InterventionRequest, WorkflowEntity } from "@t3tools/contracts/workflowState";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import {
  AlertTriangle,
  Clock,
  PlayCircle,
  StopCircle,
  SkipForward,
  Settings,
  Info,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";

interface InterventionPanelProps {
  interventions: readonly InterventionRequest[];
  entities: ReadonlyMap<string, WorkflowEntity>;
  onRespondToIntervention: (
    interventionId: string,
    optionId: string,
    reason?: string,
  ) => Promise<void>;
  onRequestIntervention: (entityId: string, reason: string) => Promise<void>;
  className?: string;
}

/**
 * Panel showing all active interventions requiring user attention.
 * This is the key UI for manual control in the simplified workflow.
 */
export function InterventionPanel({
  interventions,
  entities,
  onRespondToIntervention,
  onRequestIntervention,
  className,
}: InterventionPanelProps) {
  const [expandedIntervention, setExpandedIntervention] = useState<string | null>(null);

  const getTypeIcon = (type: InterventionRequest["type"]) => {
    switch (type) {
      case "task_failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "orchestration_failed":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "user_requested":
        return <Settings className="h-4 w-4 text-blue-500" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  const getTypeLabel = (type: InterventionRequest["type"]) => {
    switch (type) {
      case "task_failed":
        return "Task Failed";
      case "orchestration_failed":
        return "System Error";
      case "user_requested":
        return "Manual Request";
      default:
        return "Intervention";
    }
  };

  const getEntityTitle = (entityId: string) => {
    const entity = entities.get(entityId);
    return entity?.title || `Entity ${entityId}`;
  };

  const isExpired = (intervention: InterventionRequest) => {
    return new Date() > new Date(intervention.timeoutAt);
  };

  const getTimeRemaining = (intervention: InterventionRequest) => {
    const now = new Date();
    const timeout = new Date(intervention.timeoutAt);
    const diff = timeout.getTime() - now.getTime();

    if (diff <= 0) return "Expired";

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m remaining`;
    } else {
      return `${minutes}m remaining`;
    }
  };

  if (interventions.length === 0) {
    return (
      <div className={cn("p-6 text-center text-muted-foreground", className)}>
        <CheckCircle className="mx-auto h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No interventions needed</p>
        <p className="text-sm">All workflows are running smoothly</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          Manual Interventions ({interventions.length})
        </h2>
        <Badge variant="secondary">{interventions.length} pending</Badge>
      </div>

      <div className="space-y-3">
        {interventions.map((intervention) => (
          <InterventionCard
            key={intervention.id}
            intervention={intervention}
            entityTitle={getEntityTitle(intervention.entityId)}
            isExpanded={expandedIntervention === intervention.id}
            onToggleExpanded={() =>
              setExpandedIntervention(
                expandedIntervention === intervention.id ? null : intervention.id,
              )
            }
            onRespond={onRespondToIntervention}
            typeIcon={getTypeIcon(intervention.type)}
            typeLabel={getTypeLabel(intervention.type)}
            timeRemaining={getTimeRemaining(intervention)}
            isExpired={isExpired(intervention)}
          />
        ))}
      </div>
    </div>
  );
}

interface InterventionCardProps {
  intervention: InterventionRequest;
  entityTitle: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onRespond: (interventionId: string, optionId: string, reason?: string) => Promise<void>;
  typeIcon: React.ReactNode;
  typeLabel: string;
  timeRemaining: string;
  isExpired: boolean;
}

function InterventionCard({
  intervention,
  entityTitle,
  isExpanded,
  onToggleExpanded,
  onRespond,
  typeIcon,
  typeLabel,
  timeRemaining,
  isExpired,
}: InterventionCardProps) {
  const [responding, setResponding] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState("");

  const handleRespond = async (optionId: string) => {
    try {
      setResponding(true);
      setSelectedOption(optionId);
      await onRespond(intervention.id, optionId, customReason || undefined);
      setCustomReason("");
      setSelectedOption(null);
    } catch (error) {
      console.error("Failed to respond to intervention:", error);
    } finally {
      setResponding(false);
      setSelectedOption(null);
    }
  };

  const getOptionIcon = (optionId: string) => {
    switch (optionId) {
      case "retry":
        return <PlayCircle className="h-4 w-4" />;
      case "skip":
        return <SkipForward className="h-4 w-4" />;
      case "cancel":
        return <StopCircle className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

  const getOptionVariant = (optionId: string) => {
    switch (optionId) {
      case "retry":
        return "default" as const;
      case "skip":
        return "secondary" as const;
      case "cancel":
        return "destructive" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <Card
      className={cn(
        "transition-all duration-200",
        isExpired ? "border-red-200 bg-red-50/50" : "border-orange-200 bg-orange-50/50",
        isExpanded && "shadow-md",
      )}
    >
      <CardHeader className="cursor-pointer pb-3" onClick={onToggleExpanded}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {typeIcon}
            <div>
              <CardTitle className="text-base font-medium">{intervention.title}</CardTitle>
              <CardDescription className="text-sm flex items-center gap-2 mt-1">
                <span>{entityTitle}</span>
                <Badge variant="outline" className="text-xs">
                  {typeLabel}
                </Badge>
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className={cn(isExpired && "text-red-600 font-medium")}>{timeRemaining}</span>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <>
          <CardContent className="pt-0 pb-4">
            <p className="text-sm mb-4">{intervention.description}</p>

            {intervention.context && Object.keys(intervention.context).length > 0 && (
              <div className="bg-gray-50 rounded p-3 text-xs mb-4">
                <strong>Context:</strong>
                <pre className="mt-1 overflow-auto">
                  {JSON.stringify(intervention.context, null, 2)}
                </pre>
              </div>
            )}

            <div className="space-y-3">
              <Label htmlFor={`reason-${intervention.id}`}>Optional reason (recommended):</Label>
              <Textarea
                id={`reason-${intervention.id}`}
                placeholder="Explain your decision (optional but recommended for audit trail)..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </CardContent>

          <CardFooter className="pt-0 flex flex-wrap gap-2">
            {intervention.options.map((option) => (
              <Button
                key={option.id}
                variant={getOptionVariant(option.id)}
                size="sm"
                disabled={responding || isExpired}
                onClick={() => handleRespond(option.id)}
                className="flex items-center gap-2"
              >
                {responding && selectedOption === option.id ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                ) : (
                  getOptionIcon(option.id)
                )}
                {option.label}
              </Button>
            ))}
          </CardFooter>
        </>
      )}
    </Card>
  );
}

/**
 * Component for requesting manual interventions
 */
interface RequestInterventionProps {
  entityId: string;
  entityTitle: string;
  onRequest: (entityId: string, reason: string) => Promise<void>;
  className?: string;
}

export function RequestIntervention({
  entityId,
  entityTitle,
  onRequest,
  className,
}: RequestInterventionProps) {
  const [requesting, setRequesting] = useState(false);
  const [reason, setReason] = useState("");

  const handleRequest = async () => {
    if (!reason.trim()) return;

    try {
      setRequesting(true);
      await onRequest(entityId, reason);
      setReason("");
    } catch (error) {
      console.error("Failed to request intervention:", error);
    } finally {
      setRequesting(false);
    }
  };

  return (
    <Card className={cn("", className)}>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Request Manual Intervention
        </CardTitle>
        <CardDescription>
          Pause automated workflow and ask for manual guidance for {entityTitle}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="intervention-reason">Reason for intervention:</Label>
          <Textarea
            id="intervention-reason"
            placeholder="Describe why manual intervention is needed..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[100px]"
          />
        </div>
      </CardContent>

      <CardFooter>
        <Button onClick={handleRequest} disabled={!reason.trim() || requesting} className="w-full">
          {requesting ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
          ) : (
            <AlertTriangle className="h-4 w-4 mr-2" />
          )}
          Request Intervention
        </Button>
      </CardFooter>
    </Card>
  );
}
