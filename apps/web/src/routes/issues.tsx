import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { SidebarInset, SidebarTrigger } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { Button } from "~/components/ui/button";
import { ArrowLeftIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Search param types
// ---------------------------------------------------------------------------

export interface IssuesRouteSearch {
  tab?: "coordinator" | "issues" | "activity";
  epicId?: string;
  issueId?: string;
}

function parseIssuesRouteSearch(search: Record<string, unknown>): IssuesRouteSearch {
  const tab = parseTab(search.tab);
  const epicId = typeof search.epicId === "string" ? search.epicId : undefined;
  const issueId = typeof search.issueId === "string" ? search.issueId : undefined;
  return {
    ...(tab ? { tab } : {}),
    ...(epicId ? { epicId } : {}),
    ...(issueId ? { issueId } : {}),
  };
}

function parseTab(value: unknown): IssuesRouteSearch["tab"] {
  if (value === "coordinator" || value === "issues" || value === "activity") {
    return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function IssuesRouteLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        void navigate({ to: "/" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigate]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-4">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void navigate({ to: "/" })}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeftIcon className="size-3" />
                Back
              </Button>
              <span className="text-sm font-medium text-foreground">Issues</span>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-4">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void navigate({ to: "/" })}
              className="no-drag gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="size-3" />
              Back
            </Button>
            <span className="ml-2 text-xs font-medium tracking-wide text-muted-foreground/70">
              Issues
            </span>
          </div>
        )}

        <div className="min-h-0 flex flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </SidebarInset>
  );
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/issues")({
  validateSearch: (search) => parseIssuesRouteSearch(search),
  beforeLoad: ({ search }) => {
    // Default to coordinator tab if no tab specified
    if (!search.tab) {
      throw redirect({ to: "/issues", search: { ...search, tab: "coordinator" }, replace: true });
    }
  },
  component: IssuesRouteLayout,
});
