// Response types of GET /api/app/pipeline3?part=funnel | funnel-deals | stuck | funnel-settings (flag pl_history_funnel). Types only: safe for the browser.
import type { Page, Pl3Row } from "./pipeline3-types";

/** What happened to a deal after it first entered a step in the chosen dates. The five add up to "entered". */
export type FunnelOutcome = "advanced" | "dropped" | "here" | "other";
export type FunnelDrill = "entered" | FunnelOutcome;

export type FunnelStep = {
  /** Step key (the step name in lower case): used to open exactly its deals. */
  key: string; name: string; order: number;
  entered: number; advanced: number; dropped: number; here: number; other: number;
  /** Share of deals that entered this step and later reached a later step or were won. null under the minimum sample. */
  advanceRate: number | null;
  /** Median days deals stayed in this step before moving (only stays that ended). null under the minimum sample. */
  medianDays: number | null; stays: number;
  enough: boolean;
};

export type Pl3Funnel = {
  pipeline: string | null; pipelines: string[];
  steps: FunnelStep[];
  /** The first date we recorded a stage move in these accounts; before it there is no history. */
  historySince: string | null; windowStartsBeforeHistory: boolean;
  minSample: number; excludedTests: boolean;
  /** True when there is no recorded move at all in the dates (the screen says "Not enough data yet"). */
  empty: boolean;
};

export type Pl3FunnelDeals = Page<Pl3Row> & { stepName: string | null; drill: FunnelDrill };

export type StuckStage = { stage: string; pipeline: string | null; count: number; value: number; usualDays: number | null };
export type Pl3Stuck = Page<Pl3Row> & {
  /** Estimate: the money in deals past the usual time for their own step. Not a forecast; many will still close. */
  total: number; totalValue: number; estimate: true; formula: string;
  byStage: StuckStage[];
  /** Open deals that sit in a step with too little history to say what is usual (not judged). */
  notJudged: number; minSample: number;
};

export type HistorySettings = { minSample: number; excludeTest: boolean; defaultPipeline: string | null; canEdit: boolean; pipelines?: string[] };
