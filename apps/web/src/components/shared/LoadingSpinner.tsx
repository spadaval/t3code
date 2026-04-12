import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps } from "react";

import { cn } from "~/lib/utils";

const loadingSpinnerVariants = cva(
  "border-current border-t-transparent rounded-full animate-spin",
  {
    variants: {
      size: {
        xs: "size-3 border",
        sm: "size-4 border-2",
        md: "size-6 border-2",
        lg: "size-8 border-2",
        xl: "size-12 border-3",
      },
      variant: {
        default: "text-primary",
        muted: "text-muted-foreground",
        inverse: "text-primary-foreground",
        success: "text-success",
        warning: "text-warning",
        error: "text-destructive",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "default",
    },
  },
);

export interface LoadingSpinnerProps
  extends Omit<ComponentProps<"div">, "children">, VariantProps<typeof loadingSpinnerVariants> {
  /**
   * Screen reader text for accessibility
   */
  label?: string;
}

/**
 * LoadingSpinner - Accessible loading indicator with multiple sizes and variants
 *
 * Features:
 * - Respects prefers-reduced-motion
 * - Proper ARIA labeling
 * - Multiple sizes and color variants
 * - Optimized animations
 *
 * @example
 * <LoadingSpinner size="lg" label="Loading issues..." />
 */
export function LoadingSpinner({
  className,
  size,
  variant,
  label = "Loading...",
  ...props
}: LoadingSpinnerProps) {
  return (
    <div
      className={cn(loadingSpinnerVariants({ size, variant }), className)}
      role="status"
      aria-label={label}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * Enhanced shimmer loading effect for content placeholders
 */
export function LoadingShimmer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%] rounded",
        className,
      )}
      role="status"
      aria-label="Loading content..."
      {...props}
    >
      <span className="sr-only">Loading content...</span>
    </div>
  );
}

/**
 * Pulse loading effect for buttons and interactive elements
 */
export function LoadingPulse({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse-soft", className)}
      role="status"
      aria-label="Processing..."
      {...props}
    >
      {children}
      <span className="sr-only">Processing...</span>
    </div>
  );
}

/**
 * Skeleton loading patterns for common UI elements
 */
export const LoadingSkeleton = {
  Text: ({ lines = 3, className, ...props }: { lines?: number } & ComponentProps<"div">) => (
    <div className={cn("space-y-2", className)} {...props}>
      {Array.from({ length: lines }, (_, i) => (
        <LoadingShimmer
          key={i}
          className={cn(
            "h-4",
            i === 0 && "w-3/4",
            i === 1 && "w-full",
            i === 2 && "w-2/3",
            i > 2 && "w-5/6",
          )}
        />
      ))}
    </div>
  ),

  Card: ({ className, ...props }: ComponentProps<"div">) => (
    <div className={cn("p-4 space-y-3", className)} {...props}>
      <div className="flex items-center space-x-2">
        <LoadingShimmer className="size-6 rounded-full" />
        <LoadingShimmer className="h-4 w-24" />
      </div>
      <LoadingShimmer className="h-4 w-3/4" />
      <LoadingShimmer className="h-3 w-1/2" />
    </div>
  ),

  List: ({ items = 5, className, ...props }: { items?: number } & ComponentProps<"div">) => (
    <div className={cn("space-y-3", className)} {...props}>
      {Array.from({ length: items }, (_, i) => (
        <LoadingSkeleton.Card key={i} />
      ))}
    </div>
  ),
};
