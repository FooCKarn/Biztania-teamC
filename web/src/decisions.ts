import { useCallback, useEffect, useState } from "react";
import type { Decision } from "./types";

// Demo only: the auditor's decisions stay in this browser (localStorage), keyed by run_id.
// A real deployment writes them to the audit-trail store on the backend.
export function useDecisions(runId: string) {
  const key = `ac-decisions-${runId}`;
  const [map, setMap] = useState<Record<string, Decision>>({});

  useEffect(() => {
    try {
      setMap(JSON.parse(localStorage.getItem(key) || "{}"));
    } catch {
      setMap({});
    }
  }, [key]);

  const decide = useCallback(
    (flagId: string, d: Decision | null) => {
      setMap((prev) => {
        const next = { ...prev };
        if (d) next[flagId] = d;
        else delete next[flagId];
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage blocked: decision lives only for this page view */
        }
        return next;
      });
    },
    [key],
  );

  return { decisions: map, decide };
}
