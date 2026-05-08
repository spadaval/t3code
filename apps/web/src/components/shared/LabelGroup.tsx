import { cva } from "class-variance-authority";
import { useState, useCallback } from "react";

import { cn } from "~/lib/utils";

const labelGroupVariants = cva("inline-flex items-center gap-1 text-xs text-muted-foreground");

const labelItemVariants = cva(
  "inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium transition-all duration-150 ease-out",
  {
    variants: {
      variant: {
        default:
          "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground hover:scale-105 hover:shadow-sm",
        subtle: "text-muted-foreground hover:text-foreground hover:bg-muted/30 hover:scale-105",
        compact: "text-muted-foreground hover:text-foreground hover:scale-105",
      },
      interactive: {
        true: "cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:bg-muted active:scale-95 select-none",
        false: "",
      },
    },
    defaultVariants: {
      variant: "compact",
      interactive: false,
    },
  },
);

export interface LabelGroupProps {
  className?: string;
  labels: readonly string[];
  maxVisible?: number;
  variant?: "default" | "subtle" | "compact";
  separator?: string;
  onLabelClick?: ((label: string) => void) | undefined;
  showAll?: boolean;
  expandable?: boolean;
  "aria-label"?: string;
}

/**
 * LabelGroup - Compact label display with enhanced interactions
 *
 * Features:
 * - Expandable label list with "show more" functionality
 * - Keyboard navigation support
 * - Hover states and focus management
 * - Click handling with proper accessibility
 *
 * @example
 * // Basic compact display
 * <LabelGroup labels={["api", "authentication", "backend"]} />
 *
 * @example
 * // Expandable with click handling
 * <LabelGroup
 *   labels={["api", "auth", "backend", "security", "database"]}
 *   expandable
 *   onLabelClick={handleLabelFilter}
 *   maxVisible={3}
 * />
 */
export function LabelGroup({
  className,
  labels,
  maxVisible = 3,
  variant = "compact",
  separator = "·",
  onLabelClick,
  showAll = false,
  expandable = false,
  "aria-label": ariaLabel,
}: LabelGroupProps) {
  const [isExpanded, setIsExpanded] = useState(showAll);

  const handleToggleExpanded = useCallback(() => {
    if (expandable) {
      setIsExpanded(!isExpanded);
    }
  }, [expandable, isExpanded]);

  const handleLabelClick = useCallback(
    (label: string) => {
      onLabelClick?.(label);
    },
    [onLabelClick],
  );

  const handleLabelKeyDown = useCallback(
    (event: React.KeyboardEvent, label: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleLabelClick(label);
      }
    },
    [handleLabelClick],
  );

  const handleExpandKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleToggleExpanded();
      }
    },
    [handleToggleExpanded],
  );

  if (labels.length === 0) {
    return null;
  }

  const visibleLabels = isExpanded ? labels : labels.slice(0, maxVisible);
  const hiddenCount = labels.length - maxVisible;
  const hasHidden = hiddenCount > 0 && !isExpanded;

  if (variant === "compact") {
    return (
      <span
        className={cn(labelGroupVariants(), className)}
        role="group"
        aria-label={ariaLabel || `${labels.length} labels`}
      >
        {visibleLabels.map((label, index) => (
          <span key={label} className="inline-flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground/60">{separator}</span>}
            <span
              className={cn(
                "transition-all duration-150 ease-out",
                onLabelClick &&
                  "cursor-pointer hover:text-foreground hover:scale-105 focus-visible:outline-none focus-visible:underline active:scale-95 select-none",
              )}
              onClick={onLabelClick ? () => handleLabelClick(label) : undefined}
              onKeyDown={onLabelClick ? (e) => handleLabelKeyDown(e, label) : undefined}
              role={onLabelClick ? "button" : undefined}
              tabIndex={onLabelClick ? 0 : undefined}
              aria-label={onLabelClick ? `Filter by ${label}` : undefined}
            >
              {label}
            </span>
          </span>
        ))}
        {hasHidden && expandable && (
          <>
            <span className="text-muted-foreground/60">{separator}</span>
            <span
              className="text-muted-foreground/80 cursor-pointer hover:text-foreground transition-all duration-150 ease-out hover:scale-105 focus-visible:outline-none focus-visible:underline active:scale-95 select-none"
              onClick={handleToggleExpanded}
              onKeyDown={handleExpandKeyDown}
              role="button"
              tabIndex={0}
              aria-label={`Show ${hiddenCount} more labels`}
            >
              +{hiddenCount} more
            </span>
          </>
        )}
        {hasHidden && !expandable && (
          <>
            <span className="text-muted-foreground/60">{separator}</span>
            <span className="text-muted-foreground/80">+{hiddenCount} more</span>
          </>
        )}
        {isExpanded && expandable && hiddenCount > 0 && (
          <>
            <span className="text-muted-foreground/60">{separator}</span>
            <span
              className="text-muted-foreground/80 cursor-pointer hover:text-foreground transition-all duration-150 ease-out hover:scale-105 focus-visible:outline-none focus-visible:underline active:scale-95 select-none"
              onClick={handleToggleExpanded}
              onKeyDown={handleExpandKeyDown}
              role="button"
              tabIndex={0}
              aria-label="Show less labels"
            >
              show less
            </span>
          </>
        )}
      </span>
    );
  }

  return (
    <div
      className={cn("inline-flex items-center gap-1.5 flex-wrap", className)}
      role="group"
      aria-label={ariaLabel || `${labels.length} labels`}
    >
      {visibleLabels.map((label) => (
        <span
          key={label}
          className={cn(
            labelItemVariants({
              variant,
              interactive: Boolean(onLabelClick),
            }),
          )}
          onClick={onLabelClick ? () => handleLabelClick(label) : undefined}
          onKeyDown={onLabelClick ? (e) => handleLabelKeyDown(e, label) : undefined}
          role={onLabelClick ? "button" : undefined}
          tabIndex={onLabelClick ? 0 : undefined}
          aria-label={onLabelClick ? `Filter by ${label}` : undefined}
        >
          {label}
        </span>
      ))}
      {hasHidden && expandable && (
        <span
          className={cn(labelItemVariants({ variant: "subtle", interactive: true }))}
          onClick={handleToggleExpanded}
          onKeyDown={handleExpandKeyDown}
          role="button"
          tabIndex={0}
          aria-label={`Show ${hiddenCount} more labels`}
        >
          +{hiddenCount}
        </span>
      )}
      {hasHidden && !expandable && (
        <span className={cn(labelItemVariants({ variant }))}>+{hiddenCount}</span>
      )}
      {isExpanded && expandable && hiddenCount > 0 && (
        <span
          className={cn(labelItemVariants({ variant: "subtle", interactive: true }))}
          onClick={handleToggleExpanded}
          onKeyDown={handleExpandKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Show less labels"
        >
          less
        </span>
      )}
    </div>
  );
}

// Enhanced convenience components for different contexts
export const IssueLabelGroup = ({
  labels,
  onLabelClick,
  expandable = true,
}: {
  labels: readonly string[];
  onLabelClick?: (label: string) => void;
  expandable?: boolean;
}) => (
  <LabelGroup
    labels={labels}
    variant="compact"
    maxVisible={3}
    onLabelClick={onLabelClick}
    expandable={expandable}
    aria-label="Issue labels"
  />
);

export const CompactLabelList = ({
  labels,
  maxVisible = 5,
  expandable = false,
}: {
  labels: readonly string[];
  maxVisible?: number;
  expandable?: boolean;
}) => (
  <LabelGroup
    labels={labels}
    variant="compact"
    maxVisible={maxVisible}
    separator=","
    expandable={expandable}
    aria-label="Label list"
  />
);
