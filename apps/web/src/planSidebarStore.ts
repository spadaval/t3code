import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export interface PlanSidebarStoreState {
  readonly openByThreadId: Record<string, boolean>;
}

interface PlanSidebarStore extends PlanSidebarStoreState {
  readonly setPlanSidebarOpen: (threadId: ThreadId, open: boolean) => void;
  readonly reset: () => void;
}

const initialState: PlanSidebarStoreState = {
  openByThreadId: {},
};

export const usePlanSidebarStore = create<PlanSidebarStore>((set) => ({
  ...initialState,
  setPlanSidebarOpen: (threadId, open) =>
    set((state) => {
      const key = threadId as string;
      if ((state.openByThreadId[key] ?? false) === open) {
        return state;
      }
      if (!open) {
        const { [key]: _removed, ...rest } = state.openByThreadId;
        return { openByThreadId: rest };
      }
      return {
        openByThreadId: {
          ...state.openByThreadId,
          [key]: true,
        },
      };
    }),
  reset: () => set(initialState),
}));
