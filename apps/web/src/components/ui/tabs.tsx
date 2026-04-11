import { createContext, useContext } from "react";
import type { ComponentProps } from "react";

import { cn } from "~/lib/utils";

interface TabsContextValue {
  onValueChange?: ((value: string) => void) | undefined;
  value?: string | undefined;
}

const TabsContext = createContext<TabsContextValue | null>(null);

interface TabsProps extends ComponentProps<"div"> {
  value?: string;
  onValueChange?: (value: string) => void;
}

function Tabs({ className, value, onValueChange, children, ...props }: TabsProps) {
  return (
    <TabsContext.Provider value={{ onValueChange, value }}>
      <div className={cn("flex flex-col gap-4", className)} data-slot="tabs" {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      data-slot="tabs-list"
      role="tablist"
      {...props}
    />
  );
}

interface TabsTriggerProps extends ComponentProps<"button"> {
  value: string;
}

function TabsTrigger({ className, value, children, onClick, ...props }: TabsTriggerProps) {
  const context = useContext(TabsContext);
  const active = context?.value === value;

  return (
    <button
      aria-selected={active}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
        active && "bg-background text-foreground shadow-xs",
        !active && "text-muted-foreground hover:text-foreground",
        className,
      )}
      data-slot="tabs-trigger"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          context?.onValueChange?.(value);
        }
      }}
      role="tab"
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

interface TabsContentProps extends ComponentProps<"div"> {
  value: string;
  forceMount?: boolean;
}

function TabsContent({
  className,
  value,
  forceMount = false,
  children,
  ...props
}: TabsContentProps) {
  const context = useContext(TabsContext);
  const active = context?.value === value;

  if (!forceMount && !active) {
    return null;
  }

  return (
    <div
      className={cn(active ? "block" : "hidden", className)}
      data-slot="tabs-content"
      role="tabpanel"
      {...props}
    >
      {children}
    </div>
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
