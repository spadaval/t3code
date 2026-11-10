import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom } from "../../state/preferences";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";

/** Whether a send should leave for the thread list; call it when the send lands. */
export function useFireAndForget() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const { isPrimarySidebarVisible } = useAdaptiveWorkspaceLayout();
  const enabled = AsyncResult.isSuccess(preferences) && preferences.value.fireAndForget === true;
  // With the list already in the sidebar, leaving the thread gains nothing.
  return () => enabled && !isPrimarySidebarVisible();
}
