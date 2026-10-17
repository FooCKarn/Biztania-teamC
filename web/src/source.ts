import { createContext, useContext } from "react";

// Where the workspace reads results from: static demo files, or an engagement's latest run via the Worker.
export interface Source {
  base: string; // prefix for conflict_map.json, pages/*, crops/*
  engagement?: { id: string; synthetic: boolean; closed: boolean; purged: boolean };
}

export const DEMO: Source = { base: "data/" };
export const engagementSource = (id: string, run: string, e: { synthetic: boolean; status: string; purged_at: string | null }): Source => ({
  base: `api/engagements/${id}/data/${run}/`,
  engagement: { id, synthetic: e.synthetic, closed: e.status !== "open", purged: !!e.purged_at },
});

export const SourceContext = createContext<Source>(DEMO);
export const useSource = () => useContext(SourceContext);
