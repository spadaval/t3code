import { cva, type VariantProps } from "class-variance-authority";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import { cn } from "~/lib/utils";

const navigationTabsVariants = cva(
  "flex items-center border-b border-border bg-background overflow-x-auto scrollbar-hide",
);

const navigationTabVariants = cva(
  "relative inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border-b-2 border-transparent hover:bg-muted/40 active:scale-[0.98] select-none whitespace-nowrap touch-target navigation-tab",
  {
    variants: {
      variant: {
        default:
          "text-muted-foreground hover:text-foreground data-[active=true]:border-primary data-[active=true]:text-foreground data-[active=true]:bg-background/60 data-[active=true]:shadow-sm",
        subtle:
          "text-muted-foreground hover:text-foreground hover:bg-muted/50 data-[active=true]:bg-muted data-[active=true]:text-foreground data-[active=true]:shadow-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface NavigationTabsProps {
  className?: string;
  children: ReactNode;
  variant?: VariantProps<typeof navigationTabVariants>["variant"];
  onKeyDown?: (event: KeyboardEvent) => void;
}

export interface NavigationTabProps {
  className?: string;
  children: ReactNode;
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  loading?: boolean | undefined;
  onClick?: (() => void) | undefined;
  variant?: VariantProps<typeof navigationTabVariants>["variant"];
  badge?: ReactNode | undefined;
  "aria-label"?: string | undefined;
}

/**
 * NavigationTabs - Clean tab navigation component with keyboard support
 *
 * Features:
 * - Keyboard navigation with arrow keys
 * - Focus management and accessibility
 * - Loading states and hover effects
 * - Smooth transitions and animations
 *
 * @example
 * <NavigationTabs>
 *   <NavigationTab
 *     active={activeTab === 'issues'}
 *     onClick={() => setActiveTab('issues')}
 *     loading={issuesLoading}
 *   >
 *     Issues
 *   </NavigationTab>
 *   <NavigationTab
 *     active={activeTab === 'coordinator'}
 *     onClick={() => setActiveTab('coordinator')}
 *     badge={<Badge size="sm" variant="info">2 active</Badge>}
 *   >
 *     Coordinator
 *   </NavigationTab>
 * </NavigationTabs>
 */
export function NavigationTabs({
  className,
  children,
  variant: _variant,
  onKeyDown,
}: NavigationTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!tabsRef.current) return;

      const tabs = Array.from(
        tabsRef.current.querySelectorAll('[role="tab"]:not(:disabled)'),
      ) as HTMLButtonElement[];

      const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);

      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          event.preventDefault();
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
          tabs[nextIndex]?.focus();
          break;
        }
        case "Home":
          event.preventDefault();
          tabs[0]?.focus();
          break;
        case "End":
          event.preventDefault();
          tabs[tabs.length - 1]?.focus();
          break;
      }

      onKeyDown?.(event);
    },
    [onKeyDown],
  );

  useEffect(() => {
    const tabsElement = tabsRef.current;
    if (!tabsElement) return;

    tabsElement.addEventListener("keydown", handleKeyDown);
    return () => tabsElement.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div ref={tabsRef} className={cn(navigationTabsVariants(), className)} role="tablist">
      {children}
    </div>
  );
}

export function NavigationTab({
  className,
  children,
  active = false,
  disabled = false,
  loading = false,
  onClick,
  variant,
  badge,
  "aria-label": ariaLabel,
}: NavigationTabProps) {
  const handleClick = useCallback(() => {
    if (disabled || loading) return;
    onClick?.();
  }, [disabled, loading, onClick]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <button
      className={cn(navigationTabVariants({ variant }), loading && "cursor-wait", className)}
      data-active={active}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="tab"
      aria-selected={active}
      aria-label={ariaLabel}
      type="button"
      tabIndex={active ? 0 : -1}
    >
      <span className="flex items-center gap-2 transition-all duration-200 ease-out">
        {loading && (
          <span className="size-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        <span className={cn("transition-all duration-200 ease-out", loading && "opacity-80")}>
          {children}
        </span>
      </span>
      {badge && !loading && (
        <span className="ml-1 transition-all duration-200 ease-out">{badge}</span>
      )}
      {/* Enhanced active tab indicator with animation */}
      {active && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary transition-all duration-300 ease-out animate-scale-in shadow-sm" />
      )}
    </button>
  );
}

// Convenience components for common patterns
export const IssuePanelTabs = {
  Issues: ({
    active,
    onClick,
    count,
  }: {
    active?: boolean;
    onClick?: () => void;
    count?: number;
  }) => (
    <NavigationTab active={active} onClick={onClick}>
      Issues
      {typeof count === "number" && count > 0 && (
        <span className="ml-1 text-xs text-muted-foreground">({count})</span>
      )}
    </NavigationTab>
  ),

  Coordinator: ({
    active,
    onClick,
    activeCount,
  }: {
    active?: boolean;
    onClick?: () => void;
    activeCount?: number;
  }) => (
    <NavigationTab active={active} onClick={onClick}>
      Coordinator
      {typeof activeCount === "number" && activeCount > 0 && (
        <span className="ml-1 inline-flex items-center gap-1 text-xs">
          <span className="size-1.5 rounded-full bg-success animate-pulse" />
          {activeCount} active
        </span>
      )}
    </NavigationTab>
  ),
};
