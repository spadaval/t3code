import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  ThreadId,
  SwarmRunId,
  SwarmTaskExecutionId,
  OrchestrationSwarmRun,
  OrchestrationSwarmTaskExecution,
  BeadsSwarmSummary,
  BeadsCoordinatorEpicSnapshot,
} from "@t3tools/contracts";
import type {
  WorkflowEntity,
  WorkflowPhase,
  WorkflowTransition,
  WorkflowInterventionPoint,
  ContextualAction,
  InterventionType,
  WorkflowTransitionReason,
  ActionCategory,
} from "@t3tools/contracts/workflowState";

/**
 * Unified Workflow State Manager
 *
 * Replaces the fragmented state across multiple stores with a single, coherent
 * state management system focused on transparency and manual control.
 */

// ── Unified Entity Collections ────────────────────────────────────────────────

interface WorkflowEntityCollections {
  // Core entities indexed by ID
  entitiesById: Record<string, WorkflowEntity>;

  // Entity relationships and indexes
  entitiesByType: Record<string, string[]>; // type -> entity IDs
  entitiesByPhase: Record<WorkflowPhase, string[]>; // phase -> entity IDs
  entitiesByParent: Record<string, string[]>; // parent ID -> child entity IDs
  entitiesByThread: Record<string, string[]>; // thread ID -> entity IDs

  // Derived collections for quick lookup
  issueEntities: Record<string, WorkflowEntity>; // issue ID -> entity
  swarmRunEntities: Record<string, WorkflowEntity>; // swarm run ID -> entity
  taskExecutionEntities: Record<string, WorkflowEntity>; // task execution ID -> entity
}

// ── Active Interventions and Actions ──────────────────────────────────────────

interface WorkflowInteractions {
  // Active intervention points requiring user input
  activeInterventions: Record<string, WorkflowInterventionPoint>; // intervention ID -> intervention
  interventionsByEntity: Record<string, string[]>; // entity ID -> intervention IDs

  // Available contextual actions by entity
  actionsByEntity: Record<string, ContextualAction[]>; // entity ID -> actions

  // Action execution state
  executingActions: Record<string, boolean>; // action ID -> is executing
  lastActionResults: Record<string, { success: boolean; message: string | null }>; // action ID -> result
}

// ── UI State for Workflow Views ───────────────────────────────────────────────

interface WorkflowUIState {
  // Current view and focus
  currentThreadId: ThreadId | null;
  activeView: "dashboard" | "issues" | "coordinator" | "recovery";
  selectedEntityId: string | null;

  // UI preferences
  showCompletedEntities: boolean;
  groupEntitiesBy: "type" | "phase" | "parent" | "status";
  sortEntitiesBy: "updated" | "created" | "priority" | "name";
  sortDirection: "asc" | "desc";

  // Filters and search
  searchQuery: string;
  activeFilters: {
    phases: WorkflowPhase[];
    entityTypes: string[];
    statuses: string[];
    assignees: string[];
  };

  // Display preferences
  expandedEntityIds: Set<string>;
  showEntityDetails: boolean;
  showTransitionHistory: boolean;
  showMetrics: boolean;

  // Loading and error states
  loadingActions: Set<string>; // action IDs currently loading
  errors: Record<string, string>; // entity ID -> error message
  lastRefresh: number | null;
  autoRefreshInterval: number | null; // seconds, null = disabled
}

// ── Progress and Metrics Tracking ─────────────────────────────────────────────

interface WorkflowMetrics {
  // Entity counts by status
  entityCounts: Record<string, Record<string, number>>; // entity type -> status -> count

  // Progress tracking
  completionRates: Record<string, number>; // entity ID -> completion percentage
  timeToCompletion: Record<string, number>; // entity ID -> estimated minutes

  // Activity metrics
  recentTransitions: WorkflowTransition[]; // last N transitions across all entities
  activeInterventionCount: number;
  stalledEntityCount: number; // entities with no progress for X time

  // Performance metrics
  averageTaskDuration: Record<string, number>; // task type -> average duration in minutes
  failureRates: Record<string, number>; // entity type -> failure percentage
}

// ── Main Store Interface ──────────────────────────────────────────────────────

interface WorkflowStateStore {
  // Core state
  entities: WorkflowEntityCollections;
  interactions: WorkflowInteractions;
  ui: WorkflowUIState;
  metrics: WorkflowMetrics;

  // ── Entity Management Actions ─────────────────────────────────────────────

  // Create/update entities
  createEntity: (entity: WorkflowEntity) => void;
  updateEntity: (id: string, updates: Partial<WorkflowEntity>) => void;
  deleteEntity: (id: string) => void;

  // Batch operations for performance
  batchUpdateEntities: (updates: Record<string, Partial<WorkflowEntity>>) => void;
  bulkCreateEntities: (entities: WorkflowEntity[]) => void;

  // ── State Transition Management ───────────────────────────────────────────

  // Execute state transitions with validation
  transitionEntity: (
    entityId: string,
    toState: string,
    reason: WorkflowTransitionReason,
    triggeredBy?: string,
    metadata?: Record<string, unknown>,
  ) => boolean; // returns success

  // Bulk state transitions (for coordinated actions)
  batchTransitionEntities: (
    transitions: Array<{
      entityId: string;
      toState: string;
      reason: WorkflowTransitionReason;
      triggeredBy?: string;
      metadata?: Record<string, unknown>;
    }>,
  ) => void;

  // ── Intervention Management ───────────────────────────────────────────────

  // Create intervention points
  createIntervention: (entityId: string, intervention: WorkflowInterventionPoint) => void;
  resolveIntervention: (interventionId: string, selectedOptionId: string) => void;
  dismissIntervention: (interventionId: string) => void;

  // ── Action Execution ──────────────────────────────────────────────────────

  // Execute contextual actions
  executeAction: (
    entityId: string,
    actionId: string,
    parameters?: Record<string, unknown>,
  ) => Promise<void>;

  // Action state management
  setActionExecuting: (actionId: string, executing: boolean) => void;
  setActionResult: (actionId: string, success: boolean, message: string | null) => void;

  // ── UI State Management ───────────────────────────────────────────────────

  // View navigation
  setActiveView: (view: WorkflowUIState["activeView"]) => void;
  setCurrentThread: (threadId: ThreadId | null) => void;
  setSelectedEntity: (entityId: string | null) => void;

  // Display preferences
  setShowCompleted: (show: boolean) => void;
  setGroupBy: (groupBy: WorkflowUIState["groupEntitiesBy"]) => void;
  setSortBy: (sortBy: WorkflowUIState["sortEntitiesBy"], direction: "asc" | "desc") => void;

  // Filtering and search
  setSearchQuery: (query: string) => void;
  setActiveFilters: (filters: Partial<WorkflowUIState["activeFilters"]>) => void;
  clearFilters: () => void;

  // Entity expansion/collapse
  toggleEntityExpanded: (entityId: string) => void;
  expandAllEntities: () => void;
  collapseAllEntities: () => void;

  // Display toggles
  setShowEntityDetails: (show: boolean) => void;
  setShowTransitionHistory: (show: boolean) => void;
  setShowMetrics: (show: boolean) => void;

  // Error and loading state
  setEntityError: (entityId: string, error: string | null) => void;
  clearAllErrors: () => void;

  // Auto-refresh
  setAutoRefreshInterval: (seconds: number | null) => void;
  triggerRefresh: () => void;

  // ── Data Integration ──────────────────────────────────────────────────────

  // Sync with existing orchestration data
  syncFromOrchestrationData: (data: {
    swarmRuns: OrchestrationSwarmRun[];
    taskExecutions: OrchestrationSwarmTaskExecution[];
    swarmSummaries: BeadsSwarmSummary[];
    epics: BeadsCoordinatorEpicSnapshot[];
  }) => void;

  // Legacy compatibility helpers
  getIssueEntitiesForThread: (threadId: ThreadId) => WorkflowEntity[];
  getSwarmEntitiesForThread: (threadId: ThreadId) => WorkflowEntity[];

  // ── Selectors and Computed State ──────────────────────────────────────────

  // Entity retrieval
  getEntity: (id: string) => WorkflowEntity | null;
  getEntitiesByType: (type: string) => WorkflowEntity[];
  getEntitiesByPhase: (phase: WorkflowPhase) => WorkflowEntity[];
  getEntitiesByParent: (parentId: string) => WorkflowEntity[];
  getEntitiesForThread: (threadId: ThreadId) => WorkflowEntity[];

  // Filtered and sorted entities
  getFilteredEntities: () => WorkflowEntity[];
  getVisibleEntities: () => WorkflowEntity[]; // respects UI filters and search

  // Intervention and action queries
  getActiveInterventionsForEntity: (entityId: string) => WorkflowInterventionPoint[];
  getAvailableActionsForEntity: (entityId: string) => ContextualAction[];

  // Progress and status queries
  getEntityProgress: (entityId: string) => number; // 0-1
  getEntityNextActions: (entityId: string) => ContextualAction[]; // recommended next steps
  isEntityStalled: (entityId: string) => boolean;
  getEntityBlockers: (entityId: string) => string[]; // reasons entity cannot progress

  // Summary statistics
  getWorkflowSummary: () => {
    totalEntities: number;
    entitiesByPhase: Record<WorkflowPhase, number>;
    activeInterventions: number;
    stalledEntities: number;
    completionRate: number;
  };
}

// ── Default State ─────────────────────────────────────────────────────────────

const initialEntityCollections: WorkflowEntityCollections = {
  entitiesById: {},
  entitiesByType: {},
  entitiesByPhase: {
    coordination: [],
    issue_preparation: [],
    swarm_coordination: [],
    task_execution: [],
    completion_review: [],
    error_recovery: [],
  },
  entitiesByParent: {},
  entitiesByThread: {},
  issueEntities: {},
  swarmRunEntities: {},
  taskExecutionEntities: {},
};

const initialInteractions: WorkflowInteractions = {
  activeInterventions: {},
  interventionsByEntity: {},
  actionsByEntity: {},
  executingActions: {},
  lastActionResults: {},
};

const initialUIState: WorkflowUIState = {
  currentThreadId: null,
  activeView: "dashboard",
  selectedEntityId: null,
  showCompletedEntities: false,
  groupEntitiesBy: "phase",
  sortEntitiesBy: "updated",
  sortDirection: "desc",
  searchQuery: "",
  activeFilters: {
    phases: [],
    entityTypes: [],
    statuses: [],
    assignees: [],
  },
  expandedEntityIds: new Set(),
  showEntityDetails: true,
  showTransitionHistory: false,
  showMetrics: false,
  loadingActions: new Set(),
  errors: {},
  lastRefresh: null,
  autoRefreshInterval: null,
};

const initialMetrics: WorkflowMetrics = {
  entityCounts: {},
  completionRates: {},
  timeToCompletion: {},
  recentTransitions: [],
  activeInterventionCount: 0,
  stalledEntityCount: 0,
  averageTaskDuration: {},
  failureRates: {},
};

// ── Store Implementation ──────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowStateStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    entities: initialEntityCollections,
    interactions: initialInteractions,
    ui: initialUIState,
    metrics: initialMetrics,

    // ── Entity Management Actions ─────────────────────────────────────────────

    createEntity: (entity: WorkflowEntity) => {
      // Ensure entity has up-to-date available actions
      const { getAvailableActions: getContextualActions } = require("./contextualActions");
      const entityWithActions = {
        ...entity,
        availableActions: getContextualActions(entity),
      };

      set((state) => {
        const newEntitiesById = { ...state.entities.entitiesById, [entity.id]: entityWithActions };
        const typeEntities = state.entities.entitiesByType[entity.type] || [];
        const phaseEntities = state.entities.entitiesByPhase[entity.phase] || [];

        return {
          entities: {
            ...state.entities,
            entitiesById: newEntitiesById,
            entitiesByType: {
              ...state.entities.entitiesByType,
              [entity.type]: [...typeEntities, entity.id],
            },
            entitiesByPhase: {
              ...state.entities.entitiesByPhase,
              [entity.phase]: [...phaseEntities, entity.id],
            },
            // Update specialized indexes based on entity type
            ...(entity.type === "issue" && {
              issueEntities: { ...state.entities.issueEntities, [entity.id]: entityWithActions },
            }),
            ...(entity.type === "swarm_run" && {
              swarmRunEntities: {
                ...state.entities.swarmRunEntities,
                [entity.id]: entityWithActions,
              },
            }),
            ...(entity.type === "task_execution" && {
              taskExecutionEntities: {
                ...state.entities.taskExecutionEntities,
                [entity.id]: entityWithActions,
              },
            }),
          },
        };
      });
    },

    updateEntity: (id: string, updates: Partial<WorkflowEntity>) => {
      set((state) => {
        const existingEntity = state.entities.entitiesById[id];
        if (!existingEntity) return state;

        const updatedEntity = {
          ...existingEntity,
          ...updates,
          updatedAt: new Date().toISOString(),
        };

        // If state changed, update stateChangedAt
        if (updates.currentState && updates.currentState !== existingEntity.currentState) {
          updatedEntity.stateChangedAt = updatedEntity.updatedAt;
        }

        // Refresh available actions when entity is updated
        const { getAvailableActions: getContextualActions } = require("./contextualActions");
        updatedEntity.availableActions = getContextualActions(updatedEntity);

        return {
          entities: {
            ...state.entities,
            entitiesById: { ...state.entities.entitiesById, [id]: updatedEntity },
            // Update specialized indexes if needed
            ...(updatedEntity.type === "issue" && {
              issueEntities: { ...state.entities.issueEntities, [id]: updatedEntity },
            }),
            ...(updatedEntity.type === "swarm_run" && {
              swarmRunEntities: { ...state.entities.swarmRunEntities, [id]: updatedEntity },
            }),
            ...(updatedEntity.type === "task_execution" && {
              taskExecutionEntities: {
                ...state.entities.taskExecutionEntities,
                [id]: updatedEntity,
              },
            }),
          },
        };
      });
    },

    deleteEntity: (id: string) => {
      set((state) => {
        const entity = state.entities.entitiesById[id];
        if (!entity) return state;

        const { [id]: removed, ...remainingEntities } = state.entities.entitiesById;
        const typeEntities = (state.entities.entitiesByType[entity.type] || []).filter(
          (eid) => eid !== id,
        );
        const phaseEntities = (state.entities.entitiesByPhase[entity.phase] || []).filter(
          (eid) => eid !== id,
        );

        return {
          entities: {
            ...state.entities,
            entitiesById: remainingEntities,
            entitiesByType: {
              ...state.entities.entitiesByType,
              [entity.type]: typeEntities,
            },
            entitiesByPhase: {
              ...state.entities.entitiesByPhase,
              [entity.phase]: phaseEntities,
            },
            // Remove from specialized indexes
            ...(entity.type === "issue" && {
              issueEntities: Object.fromEntries(
                Object.entries(state.entities.issueEntities).filter(([eid]) => eid !== id),
              ),
            }),
            ...(entity.type === "swarm_run" && {
              swarmRunEntities: Object.fromEntries(
                Object.entries(state.entities.swarmRunEntities).filter(([eid]) => eid !== id),
              ),
            }),
            ...(entity.type === "task_execution" && {
              taskExecutionEntities: Object.fromEntries(
                Object.entries(state.entities.taskExecutionEntities).filter(([eid]) => eid !== id),
              ),
            }),
          },
        };
      });
    },

    batchUpdateEntities: (updates: Record<string, Partial<WorkflowEntity>>) => {
      Object.entries(updates).forEach(([id, update]) => {
        get().updateEntity(id, update);
      });
    },

    bulkCreateEntities: (entities: WorkflowEntity[]) => {
      entities.forEach((entity) => {
        get().createEntity(entity);
      });
    },

    // ── State Transition Management ───────────────────────────────────────────

    transitionEntity: (
      entityId: string,
      toState: string,
      reason: WorkflowTransitionReason,
      triggeredBy?: string,
      metadata?: Record<string, unknown>,
    ): boolean => {
      const entity = get().entities.entitiesById[entityId];
      if (!entity) return false;

      // TODO: Add state transition validation here
      // For now, allow all transitions - validation will be added in next iteration

      const transition: WorkflowTransition = {
        fromState: entity.currentState,
        toState,
        reason,
        triggeredBy: triggeredBy || null,
        metadata: metadata || {},
        timestamp: new Date().toISOString() as any,
      };

      get().updateEntity(entityId, {
        currentState: toState,
        transitions: [...entity.transitions, transition],
      });

      return true;
    },

    batchTransitionEntities: (transitions) => {
      transitions.forEach(({ entityId, toState, reason, triggeredBy, metadata }) => {
        get().transitionEntity(entityId, toState, reason, triggeredBy, metadata);
      });
    },

    // ── Placeholder implementations (to be completed in next iteration) ──────

    createIntervention: () => {}, // TODO: Implement
    resolveIntervention: () => {}, // TODO: Implement
    dismissIntervention: () => {}, // TODO: Implement

    executeAction: async () => {}, // TODO: Implement
    setActionExecuting: () => {}, // TODO: Implement
    setActionResult: () => {}, // TODO: Implement

    setActiveView: (view) => set((state) => ({ ui: { ...state.ui, activeView: view } })),
    setCurrentThread: (threadId) =>
      set((state) => ({ ui: { ...state.ui, currentThreadId: threadId } })),
    setSelectedEntity: (entityId) =>
      set((state) => ({ ui: { ...state.ui, selectedEntityId: entityId } })),

    setShowCompleted: (show) =>
      set((state) => ({ ui: { ...state.ui, showCompletedEntities: show } })),
    setGroupBy: (groupBy) => set((state) => ({ ui: { ...state.ui, groupEntitiesBy: groupBy } })),
    setSortBy: (sortBy, direction) =>
      set((state) => ({
        ui: { ...state.ui, sortEntitiesBy: sortBy, sortDirection: direction },
      })),

    setSearchQuery: (query) => set((state) => ({ ui: { ...state.ui, searchQuery: query } })),
    setActiveFilters: (filters) =>
      set((state) => ({
        ui: { ...state.ui, activeFilters: { ...state.ui.activeFilters, ...filters } },
      })),
    clearFilters: () =>
      set((state) => ({
        ui: {
          ...state.ui,
          activeFilters: { phases: [], entityTypes: [], statuses: [], assignees: [] },
          searchQuery: "",
        },
      })),

    toggleEntityExpanded: (entityId) =>
      set((state) => {
        const expanded = new Set(state.ui.expandedEntityIds);
        if (expanded.has(entityId)) {
          expanded.delete(entityId);
        } else {
          expanded.add(entityId);
        }
        return { ui: { ...state.ui, expandedEntityIds: expanded } };
      }),

    expandAllEntities: () =>
      set((state) => ({
        ui: { ...state.ui, expandedEntityIds: new Set(Object.keys(state.entities.entitiesById)) },
      })),

    collapseAllEntities: () =>
      set((state) => ({
        ui: { ...state.ui, expandedEntityIds: new Set() },
      })),

    setShowEntityDetails: (show) =>
      set((state) => ({ ui: { ...state.ui, showEntityDetails: show } })),
    setShowTransitionHistory: (show) =>
      set((state) => ({ ui: { ...state.ui, showTransitionHistory: show } })),
    setShowMetrics: (show) => set((state) => ({ ui: { ...state.ui, showMetrics: show } })),

    setEntityError: (entityId, error) =>
      set((state) => ({
        ui: {
          ...state.ui,
          errors: error
            ? { ...state.ui.errors, [entityId]: error }
            : Object.fromEntries(Object.entries(state.ui.errors).filter(([id]) => id !== entityId)),
        },
      })),

    clearAllErrors: () => set((state) => ({ ui: { ...state.ui, errors: {} } })),

    setAutoRefreshInterval: (seconds) =>
      set((state) => ({ ui: { ...state.ui, autoRefreshInterval: seconds } })),
    triggerRefresh: () => set((state) => ({ ui: { ...state.ui, lastRefresh: Date.now() } })),

    // ── Data Integration ──────────────────────────────────────────────────────

    syncFromOrchestrationData: (data: {
      swarmRuns: OrchestrationSwarmRun[];
      taskExecutions: OrchestrationSwarmTaskExecution[];
      swarmSummaries: BeadsSwarmSummary[];
      epics: BeadsCoordinatorEpicSnapshot[];
    }) => {
      const {
        convertOrchestrationDataToWorkflowEntities,
        hasEntityStateChanged,
        updateEntityFromOrchestrationData,
      } = require("./workflowDataAdapters");

      const newEntities = convertOrchestrationDataToWorkflowEntities(data);
      const currentState = get();

      // Process each new entity
      newEntities.forEach((newEntity: WorkflowEntity) => {
        const existingEntity = currentState.entities.entitiesById[newEntity.id];

        if (!existingEntity) {
          // New entity - create it
          get().createEntity(newEntity);
        } else {
          // Existing entity - check if update is needed
          const correspondingData = [
            ...data.swarmRuns,
            ...data.taskExecutions,
            ...data.swarmSummaries,
          ].find((d) => {
            if ("runId" in d && d.runId === newEntity.id) return true;
            if ("executionId" in d && d.executionId === newEntity.id) return true;
            if ("swarmId" in d && d.swarmId === newEntity.id) return true;
            return false;
          });

          if (correspondingData && hasEntityStateChanged(existingEntity, correspondingData)) {
            const updates = updateEntityFromOrchestrationData(existingEntity, correspondingData);
            get().updateEntity(newEntity.id, updates);
          }
        }
      });
    },
    getIssueEntitiesForThread: (threadId: ThreadId) => {
      const state = get();
      const threadEntities = state.entities.entitiesByThread[threadId] || [];
      return threadEntities
        .map((id) => state.entities.entitiesById[id])
        .filter(
          (entity): entity is WorkflowEntity =>
            entity !== undefined && (entity.type === "issue" || entity.type === "epic"),
        );
    },

    getSwarmEntitiesForThread: (threadId: ThreadId) => {
      const state = get();
      const threadEntities = state.entities.entitiesByThread[threadId] || [];
      return threadEntities
        .map((id) => state.entities.entitiesById[id])
        .filter(
          (entity): entity is WorkflowEntity =>
            entity !== undefined && (entity.type === "swarm_run" || entity.type === "swarm"),
        );
    },

    getEntity: (id) => get().entities.entitiesById[id] || null,
    getEntitiesByType: (type) =>
      (get().entities.entitiesByType[type] || [])
        .map((id) => get().entities.entitiesById[id])
        .filter((entity): entity is WorkflowEntity => entity !== undefined),
    getEntitiesByPhase: (phase) =>
      (get().entities.entitiesByPhase[phase] || [])
        .map((id) => get().entities.entitiesById[id])
        .filter((entity): entity is WorkflowEntity => entity !== undefined),
    getEntitiesByParent: (parentId) =>
      (get().entities.entitiesByParent[parentId] || [])
        .map((id) => get().entities.entitiesById[id])
        .filter((entity): entity is WorkflowEntity => entity !== undefined),
    getEntitiesForThread: () => [], // TODO: Implement

    getFilteredEntities: () => {
      const state = get();
      const { ui } = state;
      let entities = Object.values(state.entities.entitiesById);

      // Apply search filter
      if (ui.searchQuery) {
        const query = ui.searchQuery.toLowerCase();
        entities = entities.filter(
          (entity) =>
            entity.title.toLowerCase().includes(query) ||
            entity.description?.toLowerCase().includes(query) ||
            entity.assignee?.toLowerCase().includes(query),
        );
      }

      // Apply phase filter
      if (ui.activeFilters.phases.length > 0) {
        entities = entities.filter((entity) => ui.activeFilters.phases.includes(entity.phase));
      }

      // Apply entity type filter
      if (ui.activeFilters.entityTypes.length > 0) {
        entities = entities.filter((entity) => ui.activeFilters.entityTypes.includes(entity.type));
      }

      // Apply status filter
      if (ui.activeFilters.statuses.length > 0) {
        entities = entities.filter((entity) =>
          ui.activeFilters.statuses.includes(entity.currentState),
        );
      }

      // Apply assignee filter
      if (ui.activeFilters.assignees.length > 0) {
        entities = entities.filter(
          (entity) => entity.assignee && ui.activeFilters.assignees.includes(entity.assignee),
        );
      }

      // Filter out completed entities if not showing them
      if (!ui.showCompletedEntities) {
        entities = entities.filter(
          (entity) => !["completed", "done", "closed"].includes(entity.currentState),
        );
      }

      return entities;
    },

    getVisibleEntities: () => {
      const state = get();
      const filteredEntities = get().getFilteredEntities();

      // Sort entities
      const sortedEntities = [...filteredEntities].sort((a, b) => {
        let comparison = 0;

        switch (state.ui.sortEntitiesBy) {
          case "updated":
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
            break;
          case "created":
            comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            break;
          case "priority":
            comparison = (a.priority || 0) - (b.priority || 0);
            break;
          case "name":
            comparison = a.title.localeCompare(b.title);
            break;
          default:
            comparison = 0;
        }

        return state.ui.sortDirection === "desc" ? -comparison : comparison;
      });

      return sortedEntities;
    },

    getActiveInterventionsForEntity: () => [], // TODO: Implement
    getAvailableActionsForEntity: (entityId: string) => {
      const entity = get().getEntity(entityId);
      if (!entity) return [];

      const { getAvailableActions } = require("./contextualActions");
      return getAvailableActions(entity);
    },

    getEntityProgress: () => 0, // TODO: Implement
    getEntityNextActions: () => [], // TODO: Implement
    isEntityStalled: () => false, // TODO: Implement
    getEntityBlockers: () => [], // TODO: Implement

    getWorkflowSummary: () => ({
      totalEntities: Object.keys(get().entities.entitiesById).length,
      entitiesByPhase: {
        coordination: get().entities.entitiesByPhase.coordination.length,
        issue_preparation: get().entities.entitiesByPhase.issue_preparation.length,
        swarm_coordination: get().entities.entitiesByPhase.swarm_coordination.length,
        task_execution: get().entities.entitiesByPhase.task_execution.length,
        completion_review: get().entities.entitiesByPhase.completion_review.length,
        error_recovery: get().entities.entitiesByPhase.error_recovery.length,
      },
      activeInterventions: Object.keys(get().interactions.activeInterventions).length,
      stalledEntities: get().metrics.stalledEntityCount,
      completionRate: 0, // TODO: Calculate
    }),
  })),
);

/**
 * Hook for accessing workflow state in components
 */
export function useWorkflowState() {
  return useWorkflowStore();
}

/**
 * Hook for accessing specific entity
 */
export function useWorkflowEntity(entityId: string | null) {
  return useWorkflowStore((state) =>
    entityId ? state.entities.entitiesById[entityId] || null : null,
  );
}

/**
 * Hook for accessing filtered entities based on current UI state
 */
export function useVisibleWorkflowEntities() {
  return useWorkflowStore((state) => state.getVisibleEntities());
}

/**
 * Hook for workflow summary statistics
 */
export function useWorkflowSummary() {
  return useWorkflowStore((state) => state.getWorkflowSummary());
}
