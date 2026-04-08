import React, { useMemo } from "react";
import type { WorkflowEntity } from "@t3tools/contracts/workflowState";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  MoreHorizontal,
  Play,
  Pause,
  Square,
  RefreshCw,
  Eye,
  History,
  Copy,
  Edit,
  Check,
  Clock,
  Archive,
  Bug,
  FileText,
  Wrench,
  UserPlus,
  UserX,
  Code,
  ArrowRight,
  RotateCcw,
  Blocks,
  HelpCircle,
  List,
  Settings,
} from "lucide-react";
import { cn } from "~/lib/utils";
import type { ActionMenuItem } from "~/contextualActions";
import { createActionMenuItems, getPrimaryAction } from "~/contextualActions";

// ── Icon Mapping ──────────────────────────────────────────────────────────────

const iconMap = {
  play: Play,
  pause: Pause,
  square: Square,
  refresh: RefreshCw,
  eye: Eye,
  history: History,
  copy: Copy,
  edit: Edit,
  check: Check,
  clock: Clock,
  archive: Archive,
  bug: Bug,
  "file-text": FileText,
  tool: Wrench,
  "user-plus": UserPlus,
  "user-x": UserX,
  code: Code,
  "arrow-right": ArrowRight,
  "rotate-ccw": RotateCcw,
  block: Blocks,
  "help-circle": HelpCircle,
  list: List,
  settings: Settings,
  x: Square,
} as const;

function getIcon(iconName: string | null | undefined) {
  if (!iconName) return null;
  const IconComponent = iconMap[iconName as keyof typeof iconMap];
  return IconComponent ? <IconComponent className="size-4" /> : null;
}

// ── Primary Action Button ─────────────────────────────────────────────────────

interface PrimaryActionButtonProps {
  entity: WorkflowEntity;
  onActionExecute: (actionId: string) => Promise<void>;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function PrimaryActionButton({
  entity,
  onActionExecute,
  disabled = false,
  size = "md",
  className,
}: PrimaryActionButtonProps) {
  const primaryAction = useMemo(() => getPrimaryAction(entity), [entity]);

  if (!primaryAction) {
    return null;
  }

  const handleClick = async () => {
    if (!disabled && primaryAction.isEnabled) {
      await onActionExecute(primaryAction.id);
    }
  };

  return (
    <Button
      variant={primaryAction.category === "destructive" ? "destructive" : "default"}
      size={size === "md" ? "default" : size}
      onClick={handleClick}
      disabled={disabled || !primaryAction.isEnabled}
      className={cn("flex items-center gap-2", className)}
      title={primaryAction.description || primaryAction.label}
    >
      {getIcon(primaryAction.icon)}
      {primaryAction.label}
      {primaryAction.shortcut && (
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          {primaryAction.shortcut}
        </kbd>
      )}
    </Button>
  );
}

// ── Action Menu ───────────────────────────────────────────────────────────────

interface ActionMenuProps {
  entity: WorkflowEntity;
  onActionExecute: (actionId: string) => Promise<void>;
  disabled?: boolean | undefined;
  maxActions?: number | undefined;
  hideDestructive?: boolean | undefined;
  isReadOnly?: boolean | undefined;
  triggerClassName?: string | undefined;
  contentAlign?: "start" | "end" | "center" | undefined;
}

export function ActionMenu({
  entity,
  onActionExecute,
  disabled = false,
  maxActions,
  hideDestructive = false,
  isReadOnly = false,
  triggerClassName,
  contentAlign = "end",
}: ActionMenuProps) {
  const menuItems = useMemo(() => {
    const context: Parameters<typeof createActionMenuItems>[1] = {
      hideDestructive,
      isReadOnly,
    };
    if (maxActions !== undefined) {
      context.maxActions = maxActions;
    }
    return createActionMenuItems(entity, context);
  }, [entity, maxActions, hideDestructive, isReadOnly]);

  const handleMenuItemClick = async (item: ActionMenuItem) => {
    if (!disabled && item.isEnabled) {
      if (item.requiresConfirmation) {
        // TODO: Show confirmation dialog
        // For now, just execute the action
        await onActionExecute(item.id);
      } else {
        await onActionExecute(item.id);
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 w-8 p-0", triggerClassName)}
            disabled={disabled}
          >
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Open action menu</span>
          </Button>
        }
      />
      <DropdownMenuContent align={contentAlign} className="w-48">
        {menuItems.map((item) => (
          <React.Fragment key={item.id}>
            <DropdownMenuItem
              onClick={() => handleMenuItemClick(item)}
              disabled={!item.isEnabled}
              className={cn(
                "flex items-center gap-2 cursor-pointer",
                item.category === "destructive" && "text-destructive focus:text-destructive",
                !item.isEnabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {getIcon(item.icon)}
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{item.label}</div>
                {item.description && (
                  <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                )}
              </div>
              {item.shortcut && (
                <kbd className="pointer-events-none inline-flex h-4 select-none items-center gap-1 rounded border bg-muted px-1 font-mono text-[9px] font-medium text-muted-foreground">
                  {item.shortcut}
                </kbd>
              )}
            </DropdownMenuItem>
            {item.separator && <DropdownMenuSeparator />}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Combined Action Bar ───────────────────────────────────────────────────────

interface ActionBarProps {
  entity: WorkflowEntity;
  onActionExecute: (actionId: string) => Promise<void>;
  disabled?: boolean | undefined;
  showPrimaryAction?: boolean | undefined;
  maxMenuActions?: number | undefined;
  hideDestructive?: boolean | undefined;
  isReadOnly?: boolean | undefined;
  className?: string | undefined;
}

export function ActionBar({
  entity,
  onActionExecute,
  disabled = false,
  showPrimaryAction = true,
  maxMenuActions,
  hideDestructive = false,
  isReadOnly = false,
  className,
}: ActionBarProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showPrimaryAction && (
        <PrimaryActionButton
          entity={entity}
          onActionExecute={onActionExecute}
          disabled={disabled}
          size="sm"
        />
      )}
      <ActionMenu
        entity={entity}
        onActionExecute={onActionExecute}
        disabled={disabled}
        maxActions={maxMenuActions}
        hideDestructive={hideDestructive}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}

// ── Quick Actions (Inline Buttons) ────────────────────────────────────────────

interface QuickActionsProps {
  entity: WorkflowEntity;
  onActionExecute: (actionId: string) => Promise<void>;
  disabled?: boolean;
  maxActions?: number;
  category?: "primary" | "secondary" | "all";
  className?: string;
}

export function QuickActions({
  entity,
  onActionExecute,
  disabled = false,
  maxActions = 3,
  category = "primary",
  className,
}: QuickActionsProps) {
  const actions = useMemo(() => {
    let entityActions = entity.availableActions;

    if (category !== "all") {
      entityActions = entityActions.filter((action) => action.category === category);
    }

    return entityActions.filter((action) => action.isEnabled).slice(0, maxActions);
  }, [entity, category, maxActions]);

  const handleActionClick = async (actionId: string) => {
    if (!disabled) {
      await onActionExecute(actionId);
    }
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {actions.map((action) => (
        <Button
          key={action.id}
          variant={action.category === "destructive" ? "destructive" : "ghost"}
          size="sm"
          onClick={() => handleActionClick(action.id)}
          disabled={disabled || !action.isEnabled}
          className="h-7 px-2 text-xs"
          title={action.description || action.label}
        >
          {getIcon(action.icon)}
          {action.label}
        </Button>
      ))}
    </div>
  );
}

// ── Keyboard Shortcut Handler ─────────────────────────────────────────────────

interface UseEntityShortcutsProps {
  entity: WorkflowEntity;
  onActionExecute: (actionId: string) => Promise<void>;
  disabled?: boolean;
}

export function useEntityShortcuts({
  entity,
  onActionExecute,
  disabled = false,
}: UseEntityShortcutsProps) {
  React.useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when no input is focused
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const shortcutAction = entity.availableActions.find(
        (action) =>
          action.shortcut &&
          action.shortcut.toLowerCase() === event.key.toLowerCase() &&
          action.isEnabled,
      );

      if (shortcutAction) {
        event.preventDefault();
        onActionExecute(shortcutAction.id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [entity, onActionExecute, disabled]);
}
