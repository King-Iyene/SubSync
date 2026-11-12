// ONE limit for how long a custom date range may be, shared by the date bar and every server reader, so the browser never offers a range the server then refuses
// (the bug: a 3-year range was refused in silence and the numbers stayed on the last 30 days). About three years. Pure.
export const MAX_RANGE_DAYS = 1096;
/** "about 3 years" in words, for the one-line message. */
export const MAX_RANGE_WORDS = "3 years";
