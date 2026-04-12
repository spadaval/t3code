import { cva, type VariantProps } from "class-variance-authority";
import { type ReactNode } from "react";

import { cn } from "~/lib/utils";

const statusIndicatorVariants = cva(
  "inline-flex items-center gap-1.5 font-medium transition-all duration-200 ease-out",
  {
    variants: {
      variant: {
        success: "text-success-foreground",
        warning: "text-warning-foreground",
        info: "text-info-foreground",
        error: "text-destructive-foreground",
        secondary: "text-muted-foreground",
        primary: "text-foreground",
      },
      size: {
        sm: "text-xs gap-1",
        md: "text-sm gap-1.5",
        lg: "text-base gap-2",
      },
      interactive: {
        true: "cursor-pointer hover:scale-105 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm active:scale-95 select-none",
        false: "",
      },
      loading: {
        true: "opacity-60 animate-pulse-soft",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      interactive: false,
      loading: false,
    },
  },
);

const statusDotVariants = cva("rounded-full shrink-0 transition-all duration-200 ease-out", {
  variants: {
    variant: {
      success: "bg-success shadow-sm shadow-success/20",
      warning: "bg-warning shadow-sm shadow-warning/20",
      info: "bg-info shadow-sm shadow-info/20",
      error: "bg-destructive shadow-sm shadow-destructive/20",
      secondary: "bg-muted-foreground",
      primary: "bg-foreground shadow-sm shadow-foreground/10",
    },
    size: {
      sm: "size-1.5",
      md: "size-2",
      lg: "size-2.5",
    },
    loading: {
      true: "animate-pulse-soft",
      false: "",
    },
    pulse: {
      true: "animate-pulse-soft shadow-lg",
      false: "",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
    loading: false,
    pulse: false,
  },
});

export interface StatusIndicatorProps extends VariantProps<typeof statusIndicatorVariants> {
  className?: string | undefined;
  children: ReactNode;
  showDot?: boolean | undefined;
  icon?: ReactNode | undefined;
  loading?: boolean | undefined;
  pulse?: boolean | undefined;
  onClick?: (() => void) | undefined;
  onKeyDown?: ((event: React.KeyboardEvent) => void) | undefined;
  title?: string | undefined;
  role?: string | undefined;
  "aria-label"?: string | undefined;
}

/**
 * StatusIndicator - A semantic status display component with interaction support
 *
 * Enhanced version that replaces Badge spam with clean status indicators.
 * Now includes loading states, interactive capabilities, and accessibility features.
 *
 * @example
 * // Basic status display
 * <StatusIndicator variant="success">Completed</StatusIndicator>
 *
 * @example
 * // With loading state
 * <StatusIndicator variant="warning" loading>Processing...</StatusIndicator>
 *
 * @example
 * // Interactive with click handling
 * <StatusIndicator
 *   variant="info"
 *   onClick={handleStatusClick}
 *   aria-label="Click to view details"
 * >
 *   Ready to Review
 * </StatusIndicator>
 *
 * @example
 * // With icon and pulse animation
 * <StatusIndicator
 *   variant="warning"
 *   icon={<AlertIcon />}
 *   pulse
 * >
 *   Needs Attention
 * </StatusIndicator>
 */
export function StatusIndicator({
  className,
  variant,
  size,
  interactive,
  loading: loadingProp,
  children,
  showDot = true,
  icon,
  pulse = false,
  onClick,
  onKeyDown,
  title,
  role,
  "aria-label": ariaLabel,
}: StatusIndicatorProps) {
  const isInteractive = Boolean(onClick);
  const isLoading = loadingProp || false;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick?.();
    }
    onKeyDown?.(event);
  };

  const sharedClassName = cn(
    statusIndicatorVariants({
      variant,
      size,
      interactive: isInteractive,
      loading: isLoading,
    }),
    className,
  );

  const content = (
    <>
      {isLoading ? (
        <span className="size-3 border-2 border-current border-t-transparent rounded-full animate-spin opacity-80" />
      ) : icon ? (
        <span className="transition-transform duration-200 ease-out [&>svg]:size-4 [&>svg]:transition-transform [&>svg]:duration-200">
          {icon}
        </span>
      ) : showDot ? (
        <span
          className={statusDotVariants({
            variant,
            size,
            loading: isLoading,
            pulse,
          })}
        />
      ) : null}
      <span className="transition-all duration-200 ease-out">{children}</span>
    </>
  );

  if (isInteractive) {
    return (
      <button
        aria-label={ariaLabel}
        className={sharedClassName}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        role={role ?? "button"}
        tabIndex={0}
        title={title}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <span aria-label={ariaLabel} className={sharedClassName} role={role} title={title}>
      {content}
    </span>
  );
}

// Convenience functions for common status types with enhanced features
export const IssueStatus = {
  Open: ({
    size,
    loading,
    onClick,
  }: {
    size?: StatusIndicatorProps["size"];
    loading?: boolean;
    onClick?: () => void;
  } = {}) => (
    <StatusIndicator
      variant="info"
      size={size}
      loading={loading}
      onClick={onClick}
      title={onClick ? "Click to change status" : undefined}
    >
      Open
    </StatusIndicator>
  ),
  InProgress: ({
    size,
    loading,
    onClick,
    pulse = true,
  }: {
    size?: StatusIndicatorProps["size"];
    loading?: boolean;
    onClick?: () => void;
    pulse?: boolean;
  } = {}) => (
    <StatusIndicator
      variant="warning"
      size={size}
      loading={loading}
      onClick={onClick}
      pulse={pulse}
      title={onClick ? "Click to change status" : undefined}
    >
      In Progress
    </StatusIndicator>
  ),
  Blocked: ({
    size,
    loading,
    onClick,
  }: {
    size?: StatusIndicatorProps["size"];
    loading?: boolean;
    onClick?: () => void;
  } = {}) => (
    <StatusIndicator
      variant="error"
      size={size}
      loading={loading}
      onClick={onClick}
      title={onClick ? "Click to view blockers" : undefined}
    >
      Blocked
    </StatusIndicator>
  ),
  Completed: ({
    size,
    loading,
    onClick,
  }: {
    size?: StatusIndicatorProps["size"];
    loading?: boolean;
    onClick?: () => void;
  } = {}) => (
    <StatusIndicator
      variant="success"
      size={size}
      loading={loading}
      onClick={onClick}
      title={onClick ? "Click to reopen" : undefined}
    >
      Completed
    </StatusIndicator>
  ),
  Closed: ({
    size,
    loading,
    onClick,
  }: {
    size?: StatusIndicatorProps["size"];
    loading?: boolean;
    onClick?: () => void;
  } = {}) => (
    <StatusIndicator
      variant="success"
      size={size}
      loading={loading}
      onClick={onClick}
      title={onClick ? "Click to reopen" : undefined}
    >
      Closed
    </StatusIndicator>
  ),
};

export const Priority = {
  P1: ({ size }: { size?: StatusIndicatorProps["size"] } = {}) => (
    <StatusIndicator variant="error" showDot={false} size={size}>
      P1
    </StatusIndicator>
  ),
  P2: ({ size }: { size?: StatusIndicatorProps["size"] } = {}) => (
    <StatusIndicator variant="warning" showDot={false} size={size}>
      P2
    </StatusIndicator>
  ),
  P3: ({ size }: { size?: StatusIndicatorProps["size"] } = {}) => (
    <StatusIndicator variant="secondary" showDot={false} size={size}>
      P3
    </StatusIndicator>
  ),
};
