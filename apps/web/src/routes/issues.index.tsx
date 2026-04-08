import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const IssuesPageContent = lazy(() => import("~/components/issues-page/IssuesPageContent"));

function IssuesIndexView() {
  return (
    <Suspense>
      <IssuesPageContent />
    </Suspense>
  );
}

export const Route = createFileRoute("/issues/")({
  component: IssuesIndexView,
});
