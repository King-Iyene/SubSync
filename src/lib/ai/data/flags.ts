// Which feature flag switches each data job on. Every job needs the global ai_byo AND its own flag (all default off); a job without an entry here (the 7 am brief) keeps its own check elsewhere.
export const JOB_FLAG = { ask_data: "ai_ask_data", data_review: "ai_data_review", data_clean: "ai_data_clean", dup_adjudicate: "ai_dup_judge", setup_audit: "ai_setup_audit" } as const;
export type DataJob = keyof typeof JOB_FLAG;
export const isDataJob = (j: string): j is DataJob => Object.prototype.hasOwnProperty.call(JOB_FLAG, j);

/** Is this job switched on? `on` answers for one flag name. */
export const jobEnabled = (on: (flag: string) => boolean, job: string): boolean => on("ai_byo") && (!isDataJob(job) || on(JOB_FLAG[job]));
