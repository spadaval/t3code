import type {
  WorkflowEntity,
  ContextualAction,
  ActionCategory,
  SwarmCoordinationState,
  TaskExecutionState,
  IssuePreparationState,
} from "@t3tools/contracts/workflowState";

/**
 * Contextual Action System
 *
 * Determines what actions are available for workflow entities based on their current state,
 * type, and context. Replaces scattered UI buttons with context-aware action menus.
 */

// ── Action Definitions by Entity Type ─────────────────────────────────────────

/**
 * Base actions available for all entities
 */
const BASE_ACTIONS = {
  view_details: {
    id: "view_details",
    label: "View Details",
    description: "Show detailed information about this item",
    category: "diagnostic",
    icon: "eye",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  view_history: {
    id: "view_history",
    label: "View History",
    description: "Show state transition history",
    category: "diagnostic",
    icon: "history",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  refresh_status: {
    id: "refresh_status",
    label: "Refresh Status",
    description: "Update status from server",
    category: "secondary",
    icon: "refresh",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "r",
  },

  copy_id: {
    id: "copy_id",
    label: "Copy ID",
    description: "Copy entity ID to clipboard",
    category: "secondary",
    icon: "copy",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "c",
  },
} satisfies Record<string, ContextualAction>;

/**
 * Actions specific to issue entities
 */
const ISSUE_ACTIONS = {
  edit_issue: {
    id: "edit_issue",
    label: "Edit Issue",
    description: "Modify issue details",
    category: "primary",
    icon: "edit",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "e",
  },

  mark_ready: {
    id: "mark_ready",
    label: "Mark Ready",
    description: "Mark issue as ready for work",
    category: "primary",
    icon: "check",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  mark_blocked: {
    id: "mark_blocked",
    label: "Mark Blocked",
    description: "Mark issue as blocked",
    category: "secondary",
    icon: "block",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  defer_issue: {
    id: "defer_issue",
    label: "Defer",
    description: "Postpone work on this issue",
    category: "secondary",
    icon: "clock",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  archive_issue: {
    id: "archive_issue",
    label: "Archive",
    description: "Archive this issue",
    category: "destructive",
    icon: "archive",
    isEnabled: true,
    requiresConfirmation: true,
    shortcut: null,
  },
} satisfies Record<string, ContextualAction>;

/**
 * Actions specific to swarm run entities
 */
const SWARM_RUN_ACTIONS = {
  start_swarm: {
    id: "start_swarm",
    label: "Start Swarm",
    description: "Begin swarm execution",
    category: "primary",
    icon: "play",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "s",
  },

  pause_swarm: {
    id: "pause_swarm",
    label: "Pause Swarm",
    description: "Pause swarm execution",
    category: "primary",
    icon: "pause",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "p",
  },

  resume_paused_swarm_run: {
    id: "resume_paused_swarm_run",
    label: "Resume Swarm",
    description: "Resume swarm execution",
    category: "primary",
    icon: "play",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "r",
  },

  cancel_swarm: {
    id: "cancel_swarm",
    label: "Cancel Swarm",
    description: "Cancel swarm execution",
    category: "destructive",
    icon: "x",
    isEnabled: true,
    requiresConfirmation: true,
    shortcut: null,
  },

  restart_swarm: {
    id: "restart_swarm",
    label: "Restart Swarm",
    description: "Restart failed swarm from beginning",
    category: "recovery",
    icon: "rotate-ccw",
    isEnabled: true,
    requiresConfirmation: true,
    shortcut: null,
  },

  debug_swarm: {
    id: "debug_swarm",
    label: "Debug",
    description: "Open swarm debugging tools",
    category: "diagnostic",
    icon: "bug",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "d",
  },

  view_logs: {
    id: "view_logs",
    label: "View Logs",
    description: "Show execution logs",
    category: "diagnostic",
    icon: "file-text",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "l",
  },

  manual_recovery: {
    id: "manual_recovery",
    label: "Manual Recovery",
    description: "Start manual recovery process",
    category: "recovery",
    icon: "tool",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  // New simplified workflow actions
  execute_next_task: {
    id: "execute_next_task",
    label: "Execute Next Task",
    description: "Manually trigger execution of the next pending task",
    category: "primary",
    icon: "arrow-right",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "n",
  },

  request_intervention: {
    id: "request_intervention",
    label: "Request Intervention",
    description: "Pause workflow and ask for manual guidance",
    category: "secondary",
    icon: "help-circle",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "h",
  },

  view_execution_history: {
    id: "view_execution_history",
    label: "View Execution History",
    description: "Show detailed execution timeline and events",
    category: "diagnostic",
    icon: "list",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "h",
  },

  manual_task_control: {
    id: "manual_task_control",
    label: "Task Control",
    description: "Manually mark tasks as completed, failed, or skipped",
    category: "recovery",
    icon: "settings",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },
} satisfies Record<string, ContextualAction>;

/**
 * Actions specific to task execution entities
 */
const TASK_EXECUTION_ACTIONS = {
  assign_task: {
    id: "assign_task",
    label: "Assign Task",
    description: "Assign to specific worker",
    category: "primary",
    icon: "user-plus",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  reassign_task: {
    id: "reassign_task",
    label: "Reassign Task",
    description: "Assign to different worker",
    category: "secondary",
    icon: "user-x",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  retry_task: {
    id: "retry_task",
    label: "Retry Task",
    description: "Retry failed task",
    category: "recovery",
    icon: "refresh",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: null,
  },

  cancel_task: {
    id: "cancel_task",
    label: "Cancel Task",
    description: "Cancel task execution",
    category: "destructive",
    icon: "x",
    isEnabled: true,
    requiresConfirmation: true,
    shortcut: null,
  },

  mark_completed: {
    id: "mark_completed",
    label: "Mark Completed",
    description: "Manually mark as completed",
    category: "recovery",
    icon: "check",
    isEnabled: true,
    requiresConfirmation: true,
    shortcut: null,
  },

  view_work: {
    id: "view_work",
    label: "View Work",
    description: "Show work done for this task",
    category: "diagnostic",
    icon: "code",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "w",
  },

  debug_task: {
    id: "debug_task",
    label: "Debug Task",
    description: "Debug task execution",
    category: "diagnostic",
    icon: "bug",
    isEnabled: true,
    requiresConfirmation: false,
    shortcut: "d",
  },
} satisfies Record<string, ContextualAction>;

// ── State-Based Action Selection ──────────────────────────────────────────────

/**
 * Determines available actions for issue entities based on their state
 */
function getIssueActions(entity: WorkflowEntity): ContextualAction[] {
  const actions: ContextualAction[] = [];

  // Always available
  actions.push(BASE_ACTIONS.view_details, BASE_ACTIONS.refresh_status);

  const state = entity.currentState as IssuePreparationState;

  switch (state) {
    case "draft":
      actions.push(ISSUE_ACTIONS.edit_issue, ISSUE_ACTIONS.mark_ready, ISSUE_ACTIONS.defer_issue);
      break;

    case "ready":
      actions.push(ISSUE_ACTIONS.edit_issue, ISSUE_ACTIONS.mark_blocked, ISSUE_ACTIONS.defer_issue);
      break;

    case "blocked":
      actions.push(ISSUE_ACTIONS.edit_issue, ISSUE_ACTIONS.mark_ready, ISSUE_ACTIONS.defer_issue);
      break;

    case "deferred":
      actions.push(ISSUE_ACTIONS.edit_issue, ISSUE_ACTIONS.mark_ready, ISSUE_ACTIONS.archive_issue);
      break;
  }

  // Add conditional actions
  if (entity.transitions.length > 0) {
    actions.push(BASE_ACTIONS.view_history);
  }

  return actions;
}

/**
 * Determines available actions for swarm run entities based on their state
 */
function getSwarmRunActions(entity: WorkflowEntity): ContextualAction[] {
  const actions: ContextualAction[] = [];

  // Always available
  actions.push(BASE_ACTIONS.view_details, BASE_ACTIONS.refresh_status, SWARM_RUN_ACTIONS.view_logs);

  const state = entity.currentState as SwarmCoordinationState;

  switch (state) {
    case "pending":
      actions.push(SWARM_RUN_ACTIONS.start_swarm, SWARM_RUN_ACTIONS.cancel_swarm);
      break;

    case "starting":
      actions.push(SWARM_RUN_ACTIONS.cancel_swarm);
      break;

    case "active":
      actions.push(
        SWARM_RUN_ACTIONS.pause_swarm,
        SWARM_RUN_ACTIONS.execute_next_task,
        SWARM_RUN_ACTIONS.request_intervention,
        SWARM_RUN_ACTIONS.cancel_swarm,
        SWARM_RUN_ACTIONS.debug_swarm,
        SWARM_RUN_ACTIONS.view_execution_history,
      );
      break;

    case "paused":
      actions.push(
        SWARM_RUN_ACTIONS.resume_paused_swarm_run,
        SWARM_RUN_ACTIONS.execute_next_task,
        SWARM_RUN_ACTIONS.manual_task_control,
        SWARM_RUN_ACTIONS.cancel_swarm,
        SWARM_RUN_ACTIONS.debug_swarm,
        SWARM_RUN_ACTIONS.view_execution_history,
      );
      break;

    case "idle":
      actions.push(
        SWARM_RUN_ACTIONS.resume_paused_swarm_run,
        SWARM_RUN_ACTIONS.execute_next_task,
        SWARM_RUN_ACTIONS.cancel_swarm,
        SWARM_RUN_ACTIONS.debug_swarm,
        SWARM_RUN_ACTIONS.view_execution_history,
      );
      break;

    case "blocked_recoverable":
      actions.push(
        SWARM_RUN_ACTIONS.manual_recovery,
        SWARM_RUN_ACTIONS.manual_task_control,
        SWARM_RUN_ACTIONS.restart_swarm,
        SWARM_RUN_ACTIONS.cancel_swarm,
        SWARM_RUN_ACTIONS.debug_swarm,
        SWARM_RUN_ACTIONS.view_execution_history,
      );
      break;

    case "blocked_fatal":
      actions.push(
        SWARM_RUN_ACTIONS.restart_swarm,
        SWARM_RUN_ACTIONS.cancel_swarm,
        SWARM_RUN_ACTIONS.debug_swarm,
      );
      break;

    case "completing":
      actions.push(SWARM_RUN_ACTIONS.cancel_swarm);
      break;

    case "completed":
      // Read-only actions only
      break;

    case "cancelled":
      actions.push(SWARM_RUN_ACTIONS.restart_swarm);
      break;
  }

  // Add conditional actions
  if (entity.transitions.length > 0) {
    actions.push(BASE_ACTIONS.view_history);
  }

  if (entity.lastError) {
    actions.push(SWARM_RUN_ACTIONS.debug_swarm);
  }

  return actions;
}

/**
 * Determines available actions for task execution entities based on their state
 */
function getTaskExecutionActions(entity: WorkflowEntity): ContextualAction[] {
  const actions: ContextualAction[] = [];

  // Always available
  actions.push(BASE_ACTIONS.view_details, BASE_ACTIONS.refresh_status);

  const state = entity.currentState as TaskExecutionState;

  switch (state) {
    case "queued":
      actions.push(TASK_EXECUTION_ACTIONS.assign_task, TASK_EXECUTION_ACTIONS.cancel_task);
      break;

    case "assigned":
      actions.push(TASK_EXECUTION_ACTIONS.reassign_task, TASK_EXECUTION_ACTIONS.cancel_task);
      break;

    case "in_progress":
      actions.push(
        TASK_EXECUTION_ACTIONS.view_work,
        TASK_EXECUTION_ACTIONS.reassign_task,
        TASK_EXECUTION_ACTIONS.cancel_task,
        TASK_EXECUTION_ACTIONS.debug_task,
      );
      break;

    case "review_required":
      actions.push(
        TASK_EXECUTION_ACTIONS.view_work,
        TASK_EXECUTION_ACTIONS.mark_completed,
        TASK_EXECUTION_ACTIONS.reassign_task,
      );
      break;

    case "completed":
      actions.push(TASK_EXECUTION_ACTIONS.view_work);
      break;

    case "failed_retryable":
      actions.push(
        TASK_EXECUTION_ACTIONS.retry_task,
        TASK_EXECUTION_ACTIONS.reassign_task,
        TASK_EXECUTION_ACTIONS.cancel_task,
        TASK_EXECUTION_ACTIONS.debug_task,
      );
      break;

    case "failed_terminal":
      actions.push(
        TASK_EXECUTION_ACTIONS.debug_task,
        TASK_EXECUTION_ACTIONS.mark_completed, // Manual override
      );
      break;

    case "cancelled":
      actions.push(TASK_EXECUTION_ACTIONS.retry_task);
      break;
  }

  // Add conditional actions
  if (entity.transitions.length > 0) {
    actions.push(BASE_ACTIONS.view_history);
  }

  if (entity.assignee) {
    actions.push(TASK_EXECUTION_ACTIONS.view_work);
  }

  return actions;
}

// ── Main Action Selection Function ────────────────────────────────────────────

/**
 * Main function to get available contextual actions for any workflow entity
 */
export function getAvailableActions(entity: WorkflowEntity): ContextualAction[] {
  switch (entity.type) {
    case "issue":
    case "epic":
      return getIssueActions(entity);

    case "swarm_run":
      return getSwarmRunActions(entity);

    case "task_execution":
      return getTaskExecutionActions(entity);

    case "recovery_session":
      // Recovery sessions have their own specialized actions
      return [
        BASE_ACTIONS.view_details,
        BASE_ACTIONS.refresh_status,
        {
          id: "proceed_recovery",
          label: "Proceed with Recovery",
          description: "Continue recovery process",
          category: "primary",
          icon: "arrow-right",
          isEnabled: true,
          requiresConfirmation: false,
          shortcut: null,
        },
      ];

    default:
      return [BASE_ACTIONS.view_details, BASE_ACTIONS.refresh_status];
  }
}

/**
 * Filters actions based on entity state and context
 */
export function filterActionsForContext(
  actions: ContextualAction[],
  entity: WorkflowEntity,
  context?: {
    isReadOnly?: boolean;
    hideDestructive?: boolean;
    maxActions?: number;
  },
): ContextualAction[] {
  let filteredActions = [...actions];

  // Filter based on context
  if (context?.isReadOnly) {
    filteredActions = filteredActions.filter(
      (action) => action.category === "diagnostic" || action.category === "secondary",
    );
  }

  if (context?.hideDestructive) {
    filteredActions = filteredActions.filter((action) => action.category !== "destructive");
  }

  // Disable actions based on entity state
  filteredActions = filteredActions.map((action) => {
    let isEnabled = action.isEnabled;

    // Disable actions that don't make sense for error states
    if (
      entity.errorRecoveryState !== "none" &&
      action.category === "primary" &&
      !action.id.includes("recovery") &&
      !action.id.includes("debug")
    ) {
      isEnabled = false;
    }

    return { ...action, isEnabled };
  });

  // Limit number of actions if requested
  if (context?.maxActions && filteredActions.length > context.maxActions) {
    // Prioritize by category: primary > recovery > secondary > diagnostic > destructive
    const priorityOrder: ActionCategory[] = [
      "primary",
      "recovery",
      "secondary",
      "diagnostic",
      "destructive",
    ];

    filteredActions.sort((a, b) => {
      const aPriority = priorityOrder.indexOf(a.category);
      const bPriority = priorityOrder.indexOf(b.category);
      return aPriority - bPriority;
    });

    filteredActions = filteredActions.slice(0, context.maxActions);
  }

  return filteredActions;
}

/**
 * Gets the primary action for an entity (most important action user should take)
 */
export function getPrimaryAction(entity: WorkflowEntity): ContextualAction | null {
  const actions = getAvailableActions(entity);
  const primaryActions = actions.filter((a) => a.category === "primary" && a.isEnabled);

  if (primaryActions.length === 0) {
    return null;
  }

  // Return the first primary action, which should be the most relevant
  return primaryActions[0] ?? null;
}

/**
 * Groups actions by category for organized display
 */
export function groupActionsByCategory(
  actions: ContextualAction[],
): Record<ActionCategory, ContextualAction[]> {
  const grouped: Record<ActionCategory, ContextualAction[]> = {
    primary: [],
    secondary: [],
    diagnostic: [],
    recovery: [],
    destructive: [],
  };

  actions.forEach((action) => {
    grouped[action.category].push(action);
  });

  return grouped;
}

/**
 * Creates a formatted action menu structure for UI components
 */
export interface ActionMenuItem {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: string | undefined;
  shortcut?: string | undefined;
  isEnabled: boolean;
  requiresConfirmation: boolean;
  category: ActionCategory;
  separator?: boolean | undefined; // Add separator after this item
}

export function createActionMenuItems(
  entity: WorkflowEntity,
  context?: Parameters<typeof filterActionsForContext>[2],
): ActionMenuItem[] {
  const actions = filterActionsForContext(getAvailableActions(entity), entity, context);

  const grouped = groupActionsByCategory(actions);
  const menuItems: ActionMenuItem[] = [];

  // Add items in priority order with separators between categories
  const categoryOrder: ActionCategory[] = [
    "primary",
    "recovery",
    "secondary",
    "diagnostic",
    "destructive",
  ];

  categoryOrder.forEach((category, index) => {
    if (grouped[category].length > 0) {
      grouped[category].forEach((action) => {
        menuItems.push({
          id: action.id,
          label: action.label,
          description: action.description || undefined,
          icon: action.icon || undefined,
          shortcut: action.shortcut || undefined,
          isEnabled: action.isEnabled,
          requiresConfirmation: action.requiresConfirmation,
          category: action.category,
        });
      });

      // Add separator after this category (except for the last one with items)
      const hasMoreCategories = categoryOrder
        .slice(index + 1)
        .some((cat) => grouped[cat].length > 0);

      const lastItem = menuItems.at(-1);
      if (hasMoreCategories && lastItem) {
        lastItem.separator = true;
      }
    }
  });

  return menuItems;
}
