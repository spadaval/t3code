import { AlertCircleIcon, RefreshCwIcon, WifiOffIcon, ServerCrashIcon } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Card, CardHeader, CardTitle, CardPanel } from "../ui/card";

export interface ErrorDisplayProps {
  className?: string | undefined;
  error: string | Error | null;
  title?: string | undefined;
  description?: string | undefined;
  icon?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  variant?: "default" | "minimal" | "inline" | undefined;
  retrying?: boolean | undefined;
}

/**
 * ErrorDisplay - Enhanced error display component with retry functionality
 *
 * Features:
 * - Multiple display variants (card, minimal, inline)
 * - Retry functionality with loading states
 * - Contextual error icons and messages
 * - Accessibility compliance
 * - Mobile-responsive design
 *
 * @example
 * <ErrorDisplay
 *   error="Failed to load issues"
 *   onRetry={handleRetry}
 *   retrying={isRetrying}
 * />
 */
export function ErrorDisplay({
  className,
  error,
  title,
  description,
  icon,
  actions,
  onRetry,
  retryLabel = "Try Again",
  variant = "default",
  retrying = false,
}: ErrorDisplayProps) {
  if (!error) return null;

  const errorMessage = error instanceof Error ? error.message : error;
  const errorIcon = icon || getErrorIcon(errorMessage);
  const errorTitle = title || getErrorTitle(errorMessage);
  const errorDescription = description || getErrorDescription(errorMessage);

  if (variant === "minimal") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground p-3 bg-destructive/5 rounded-lg border border-destructive/20",
          className,
        )}
        role="alert"
        aria-live="polite"
      >
        <span className="text-destructive shrink-0">{errorIcon}</span>
        <span className="flex-1 min-w-0">
          <span className="font-medium text-destructive">{errorTitle}</span>
          {errorDescription && (
            <span className="block text-muted-foreground mt-1">{errorDescription}</span>
          )}
        </span>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
            className="shrink-0 text-destructive hover:text-destructive-foreground hover:bg-destructive/10"
          >
            {retrying ? (
              <RefreshCwIcon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            <span className="sr-only">{retryLabel}</span>
          </Button>
        )}
        {actions}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div
        className={cn("flex items-center gap-2 text-sm text-destructive", className)}
        role="alert"
        aria-live="polite"
      >
        <span className="shrink-0">{errorIcon}</span>
        <span className="flex-1 min-w-0">{errorTitle}</span>
        {onRetry && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onRetry}
            disabled={retrying}
            className="shrink-0 h-auto p-1 text-xs"
          >
            {retrying ? (
              <RefreshCwIcon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            {retryLabel}
          </Button>
        )}
        {actions}
      </div>
    );
  }

  // Default card variant
  return (
    <Card className={cn("border-destructive/20 bg-destructive/5", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <span className="shrink-0">{errorIcon}</span>
          <span className="flex-1 min-w-0">{errorTitle}</span>
        </CardTitle>
      </CardHeader>
      {(errorDescription || onRetry || actions) && (
        <CardPanel className="pt-0 space-y-4">
          {errorDescription && <p className="text-sm text-muted-foreground">{errorDescription}</p>}
          {(onRetry || actions) && (
            <div className="flex items-center gap-2 flex-wrap">
              {onRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  disabled={retrying}
                  className="border-destructive/30 text-destructive hover:bg-destructive/10"
                >
                  {retrying ? (
                    <>
                      <RefreshCwIcon className="size-4 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <RefreshCwIcon className="size-4" />
                      {retryLabel}
                    </>
                  )}
                </Button>
              )}
              {actions}
            </div>
          )}
        </CardPanel>
      )}
    </Card>
  );
}

// Helper functions for contextual error handling
function getErrorIcon(errorMessage: string): ReactNode {
  const message = errorMessage.toLowerCase();

  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return <WifiOffIcon className="size-4" />;
  }

  if (message.includes("server") || message.includes("500") || message.includes("503")) {
    return <ServerCrashIcon className="size-4" />;
  }

  return <AlertCircleIcon className="size-4" />;
}

function getErrorTitle(errorMessage: string): string {
  const message = errorMessage.toLowerCase();

  if (message.includes("network") || message.includes("fetch")) {
    return "Connection Error";
  }

  if (message.includes("server")) {
    return "Server Error";
  }

  if (message.includes("not found") || message.includes("404")) {
    return "Not Found";
  }

  if (message.includes("unauthorized") || message.includes("403")) {
    return "Access Denied";
  }

  return "Error";
}

function getErrorDescription(errorMessage: string): string | null {
  const message = errorMessage.toLowerCase();

  if (message.includes("network") || message.includes("fetch")) {
    return "Please check your internet connection and try again.";
  }

  if (message.includes("server")) {
    return "The server is experiencing issues. Please try again in a moment.";
  }

  if (message.includes("not found")) {
    return "The requested resource could not be found.";
  }

  if (message.includes("unauthorized")) {
    return "You don't have permission to access this resource.";
  }

  return null;
}

/**
 * Convenience components for common error scenarios
 */
export const ErrorBoundaryFallback = ({
  error,
  onReset,
}: {
  error: Error;
  onReset?: () => void;
}) => (
  <ErrorDisplay
    error={error}
    title="Something went wrong"
    description="An unexpected error occurred. This has been logged and will be investigated."
    onRetry={onReset}
    retryLabel="Reload"
    className="m-4"
  />
);

export const NetworkErrorBoundary = ({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying?: boolean;
}) => (
  <ErrorDisplay
    error="Failed to connect to server"
    title="Connection Problem"
    description="Unable to reach the server. Please check your connection and try again."
    onRetry={onRetry}
    retrying={retrying}
    variant="minimal"
  />
);
