import { createContext, useContext } from "react";

// Where the workspace reads its results from:
//  - the public demo: static files under data/ (synthetic TG Company sample)
//  - an engagement: the Worker API, for members only, from that engagement's latest pipeline run
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
