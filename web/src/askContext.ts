import { useSyncExternalStore } from "react";

// The flag open in the review pane, so the AI panel can offer its follow-up questions as chips.
export interface AskFlag {
  id: string;
  title: string;
  questions: string[];
}

let current: AskFlag | null = null;
const listeners = new Set<() => void>();

export function setAskFlag(f: AskFlag | null) {
  if (current?.id === f?.id) return;
  current = f;
  listeners.forEach((l) => l());
}

export const useAskFlag = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
