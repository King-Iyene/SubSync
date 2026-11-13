"use client";

import { createContext, useContext } from "react";
import type { PipelinePick } from "@/lib/design/pipeline-pick-link";

// The pipeline and account picked on Pipeline, handed to the older screens that sit inside it (Stale deals and hygiene, Forecast and stages, Deal moves) so they follow the same picker.
export const PickContext = createContext<PipelinePick>({ pipeline: "", location: "" });
export const usePick = (): PipelinePick => useContext(PickContext);
