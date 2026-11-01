// Small wording helpers shared by screens, emails and tests. Pure.

/** "1 contact", "2 contacts": the noun agrees with the number. `many` is only needed for a plural that is not just an added s. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** The verb that goes with a count: "1 contact asks", "2 contacts ask". */
export const are = (n: number): string => (n === 1 ? "is" : "are");
