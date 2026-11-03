// The shared building blocks (stage D0). Import from here. Each has a usage example on /design and its props are written up in docs/features/D0.md.
export { Page, Section, ModuleTabs, BackLink, BackProvider, useBack, SUBTITLE_MAX, type ModuleTab, type BackTarget } from "./template";
export { ScopeFilterBar, FilterDrawer, AccountScope, FilterHelp } from "./filters";
export { CardRange, useCardRange, type CardRangeState } from "./card-range";
export { DrillPanel, useDrill, type DrillState } from "./drill";
export { HowTo } from "./how-to";
export { remember, remembered } from "./remember";
export { InlineAlert, type AlertTone } from "./alert";
export { FreshnessStrip as StatusLine } from "../views/sync-status";
export { DataList, type Column } from "./data-list";
export { LeadDrawer, type LeadSeed } from "./lead-drawer";
export { DialButton } from "./dial-button";
export { EmptyState, Skeleton, SkeletonRows, SkeletonCards, ErrorState, DefinitionTip } from "./states";
export { BarChart, Distribution, Sparkline, ChartPlaceholder, type Bar, type ChartTone } from "./charts";
export { MyDayView } from "./my-day";
export { useTheme } from "./theme";
export { LineChart } from "./line-chart";
