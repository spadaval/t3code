import React, { useState, useMemo } from "react";
import { cn } from "~/lib/utils";
import type { WorkflowEntity, WorkflowPhase } from "@t3tools/contracts/workflowState";
import {
  useWorkflowState,
  useVisibleWorkflowEntities,
  useWorkflowSummary,
} from "~/workflowStateManager";
import { ActionBar, QuickActions, useEntityShortcuts } from "./EntityActions";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  Search,
  Filter,
  Layout,
  Eye,
  EyeOff,
  RefreshCw,
  Settings,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  Pause,
  Play,
  Zap,
} from "lucide-react";

// ── Types and Interfaces ──────────────────────────────────────────────────────

interface WorkflowDashboardProps {
  className?: string;
  threadId?: string;
  onActionExecute?: (entityId: string, actionId: string) => Promise<void>;
}

// ── Summary Cards ─────────────────────────────────────────────────────────────

function WorkflowSummaryCards() {
  const summary = useWorkflowSummary();

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Issues</p>
            <p className="text-lg font-semibold">{summary.entitiesByPhase.issue_preparation}</p>
          </div>
          <div className="p-2 bg-blue-100 rounded-lg">
            <Layout className="size-4 text-blue-600" />
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Swarms</p>
            <p className="text-lg font-semibold">{summary.entitiesByPhase.swarm_coordination}</p>
          </div>
          <div className="p-2 bg-green-100 rounded-lg">
            <Zap className="size-4 text-green-600" />
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Tasks</p>
            <p className="text-lg font-semibold">{summary.entitiesByPhase.task_execution}</p>
          </div>
          <div className="p-2 bg-orange-100 rounded-lg">
            <Play className="size-4 text-orange-600" />
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Interventions</p>
            <p className="text-lg font-semibold text-amber-600">{summary.activeInterventions}</p>
          </div>
          <div className="p-2 bg-amber-100 rounded-lg">
            <AlertTriangle className="size-4 text-amber-600" />
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Progress</p>
            <p className="text-lg font-semibold">{Math.round(summary.completionRate * 100)}%</p>
          </div>
          <div className="p-2 bg-purple-100 rounded-lg">
            <CheckCircle className="size-4 text-purple-600" />
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Entity Status Badge ───────────────────────────────────────────────────────

function EntityStatusBadge({ entity }: { entity: WorkflowEntity }) {
  const getStatusVariant = (state: string) => {
    if (state.includes("completed") || state.includes("done")) return "success";
    if (state.includes("failed") || state.includes("blocked") || state.includes("error"))
      return "destructive";
    if (state.includes("active") || state.includes("running") || state.includes("progress"))
      return "warning";
    if (state.includes("paused") || state.includes("idle")) return "secondary";
    return "outline";
  };

  const getStateIcon = (state: string) => {
    if (state.includes("completed") || state.includes("done"))
      return <CheckCircle className="size-3" />;
    if (state.includes("failed") || state.includes("blocked"))
      return <XCircle className="size-3" />;
    if (state.includes("active") || state.includes("running") || state.includes("progress"))
      return <Play className="size-3" />;
    if (state.includes("paused")) return <Pause className="size-3" />;
    if (state.includes("idle")) return <Clock className="size-3" />;
    return null;
  };

  return (
    <Badge
      variant={getStatusVariant(entity.currentState)}
      className="flex items-center gap-1 text-xs"
    >
      {getStateIcon(entity.currentState)}
      {entity.currentState.replace(/_/g, " ")}
    </Badge>
  );
}

// ── Entity Card ───────────────────────────────────────────────────────────────

interface EntityCardProps {
  entity: WorkflowEntity;
  isSelected: boolean;
  onSelect: (entityId: string) => void;
  onActionExecute: (entityId: string, actionId: string) => Promise<void>;
  showDetails: boolean;
}

function EntityCard({
  entity,
  isSelected,
  onSelect,
  onActionExecute,
  showDetails,
}: EntityCardProps) {
  const handleActionExecute = async (actionId: string) => {
    await onActionExecute(entity.id, actionId);
  };

  useEntityShortcuts({
    entity,
    onActionExecute: handleActionExecute,
    disabled: !isSelected,
  });

  const progressMetrics = entity.progressMetrics || {};
  const completionRate = progressMetrics.completionRate || 0;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-primary ring-offset-2",
      )}
      onClick={() => onSelect(entity.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{entity.title}</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs">
                {entity.type.replace(/_/g, " ")}
              </Badge>
              <EntityStatusBadge entity={entity} />
            </div>
          </div>
          <ActionBar
            entity={entity}
            onActionExecute={handleActionExecute}
            showPrimaryAction={false}
            maxMenuActions={5}
            className="ml-2"
          />
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {entity.description && (
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{entity.description}</p>
        )}

        {entity.lastError && (
          <div className="bg-destructive/10 border border-destructive/20 rounded p-2 mb-3">
            <p className="text-xs text-destructive line-clamp-1">Error: {entity.lastError}</p>
          </div>
        )}

        {/* Progress indicators */}
        {completionRate > 0 && (
          <div className="space-y-2 mb-3">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{Math.round(completionRate * 100)}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${completionRate * 100}%` }}
              />
            </div>
          </div>
        )}

        {showDetails && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Updated:</span>
              <span>{new Date(entity.updatedAt).toLocaleTimeString()}</span>
            </div>
            {entity.assignee && (
              <div className="flex justify-between">
                <span>Assignee:</span>
                <span className="truncate max-w-[100px]">{entity.assignee}</span>
              </div>
            )}
            {entity.priority !== null && (
              <div className="flex justify-between">
                <span>Priority:</span>
                <span>{entity.priority}</span>
              </div>
            )}
          </div>
        )}

        {/* Quick actions for selected entity */}
        {isSelected && (
          <div className="mt-3 pt-3 border-t">
            <QuickActions
              entity={entity}
              onActionExecute={handleActionExecute}
              maxActions={3}
              category="primary"
              className="justify-start"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Entity List ───────────────────────────────────────────────────────────────

interface EntityListProps {
  entities: WorkflowEntity[];
  selectedEntityId: string | null;
  onEntitySelect: (entityId: string) => void;
  onActionExecute: (entityId: string, actionId: string) => Promise<void>;
  showDetails: boolean;
  groupBy: string;
}

function EntityList({
  entities,
  selectedEntityId,
  onEntitySelect,
  onActionExecute,
  showDetails,
  groupBy,
}: EntityListProps) {
  const groupedEntities = useMemo(() => {
    if (groupBy === "none") {
      return { "All Entities": entities };
    }

    const groups: Record<string, WorkflowEntity[]> = {};

    entities.forEach((entity) => {
      let groupKey: string;

      switch (groupBy) {
        case "phase":
          groupKey = entity.phase.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
          break;
        case "type":
          groupKey = entity.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
          break;
        case "status":
          groupKey = entity.currentState
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase());
          break;
        case "parent":
          groupKey = entity.parentId ? `Parent: ${entity.parentId}` : "No Parent";
          break;
        default:
          groupKey = "Ungrouped";
      }

      (groups[groupKey] ??= []).push(entity);
    });

    return groups;
  }, [entities, groupBy]);

  if (entities.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto w-16 h-16 rounded-full bg-muted/20 flex items-center justify-center mb-4">
          <Layout className="size-8 text-muted-foreground/60" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">No entities found</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Try adjusting your filters or refresh the data.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(groupedEntities).map(([groupName, groupEntities]) => (
        <div key={groupName}>
          {groupBy !== "none" && (
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              {groupName} ({groupEntities.length})
            </h3>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groupEntities.map((entity) => (
              <EntityCard
                key={entity.id}
                entity={entity}
                isSelected={selectedEntityId === entity.id}
                onSelect={onEntitySelect}
                onActionExecute={onActionExecute}
                showDetails={showDetails}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Dashboard Component ──────────────────────────────────────────────────

export function WorkflowDashboard({
  className,
  threadId,
  onActionExecute,
}: WorkflowDashboardProps) {
  const workflowStore = useWorkflowState();
  const visibleEntities = useVisibleWorkflowEntities();

  // Local UI state
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"dashboard" | "issues" | "swarms" | "tasks">(
    "dashboard",
  );

  // Handle action execution
  const handleActionExecute = async (entityId: string, actionId: string) => {
    if (onActionExecute) {
      await onActionExecute(entityId, actionId);
    } else {
      // Default action handling - could dispatch to workflow store
      console.log(`Execute action ${actionId} on entity ${entityId}`);
      // TODO: Implement default action execution
    }
  };

  // Filter entities by view
  const filteredEntities = useMemo(() => {
    switch (activeView) {
      case "issues":
        return visibleEntities.filter((e) => e.type === "issue" || e.type === "epic");
      case "swarms":
        return visibleEntities.filter((e) => e.type === "swarm_run");
      case "tasks":
        return visibleEntities.filter((e) => e.type === "task_execution");
      default:
        return visibleEntities;
    }
  }, [visibleEntities, activeView]);

  return (
    <div className={cn("flex flex-col h-full p-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Workflow Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Manage your issues, swarms, and task execution workflow
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => workflowStore.triggerRefresh()}
            className="flex items-center gap-2"
          >
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => workflowStore.setShowEntityDetails(!workflowStore.ui.showEntityDetails)}
          >
            {workflowStore.ui.showEntityDetails ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <WorkflowSummaryCards />

      {/* Filters and Search */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search entities..."
            value={workflowStore.ui.searchQuery}
            onChange={(e) => workflowStore.setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select
          value={workflowStore.ui.groupEntitiesBy}
          onValueChange={(value: any) => workflowStore.setGroupBy(value)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="phase">By Phase</SelectItem>
            <SelectItem value="type">By Type</SelectItem>
            <SelectItem value="status">By Status</SelectItem>
            <SelectItem value="parent">By Parent</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={`${workflowStore.ui.sortEntitiesBy}-${workflowStore.ui.sortDirection}`}
          onValueChange={(value) => {
            if (!value) return;
            const [sortBy, direction] = value.split("-") as [any, "asc" | "desc"];
            workflowStore.setSortBy(sortBy, direction);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated-desc">Recently Updated</SelectItem>
            <SelectItem value="updated-asc">Oldest First</SelectItem>
            <SelectItem value="created-desc">Recently Created</SelectItem>
            <SelectItem value="created-asc">Created First</SelectItem>
            <SelectItem value="priority-desc">High Priority</SelectItem>
            <SelectItem value="priority-asc">Low Priority</SelectItem>
            <SelectItem value="name-asc">A-Z</SelectItem>
            <SelectItem value="name-desc">Z-A</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Main Content */}
      <Tabs
        value={activeView}
        onValueChange={(value: any) => setActiveView(value)}
        className="flex-1"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="issues">Issues</TabsTrigger>
          <TabsTrigger value="swarms">Swarms</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="flex-1 mt-6">
          <EntityList
            entities={filteredEntities}
            selectedEntityId={selectedEntityId}
            onEntitySelect={setSelectedEntityId}
            onActionExecute={handleActionExecute}
            showDetails={workflowStore.ui.showEntityDetails}
            groupBy={workflowStore.ui.groupEntitiesBy}
          />
        </TabsContent>

        <TabsContent value="issues" className="flex-1 mt-6">
          <EntityList
            entities={filteredEntities}
            selectedEntityId={selectedEntityId}
            onEntitySelect={setSelectedEntityId}
            onActionExecute={handleActionExecute}
            showDetails={workflowStore.ui.showEntityDetails}
            groupBy={workflowStore.ui.groupEntitiesBy}
          />
        </TabsContent>

        <TabsContent value="swarms" className="flex-1 mt-6">
          <EntityList
            entities={filteredEntities}
            selectedEntityId={selectedEntityId}
            onEntitySelect={setSelectedEntityId}
            onActionExecute={handleActionExecute}
            showDetails={workflowStore.ui.showEntityDetails}
            groupBy={workflowStore.ui.groupEntitiesBy}
          />
        </TabsContent>

        <TabsContent value="tasks" className="flex-1 mt-6">
          <EntityList
            entities={filteredEntities}
            selectedEntityId={selectedEntityId}
            onEntitySelect={setSelectedEntityId}
            onActionExecute={handleActionExecute}
            showDetails={workflowStore.ui.showEntityDetails}
            groupBy={workflowStore.ui.groupEntitiesBy}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
