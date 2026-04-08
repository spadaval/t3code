import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

interface ProgressProps extends ComponentProps<"div"> {
  value?: number | null;
  max?: number;
}

export function Progress({ className, value = 0, max = 100, ...props }: ProgressProps) {
  const normalizedValue = Math.min(Math.max(value ?? 0, 0), max);
  const percentage = max > 0 ? (normalizedValue / max) * 100 : 0;

  return (
    <div
      aria-valuemax={max}
      aria-valuemin={0}
      aria-valuenow={normalizedValue}
      aria-valuetext={`${Math.round(percentage)}%`}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      {...props}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
