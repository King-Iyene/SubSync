// Name and number similarity for duplicate matching (stage CLEANUP). Pure: no database, no network, so every rule is unit tested.
//
//   soundex / jaroWinkler        the two classic ways of saying "spelled differently, sounds the same"
//   canonicalFirst               Bob -> robert, Liz -> elizabeth (a short list of common nicknames)
//   nameSimilarity               how alike two full names are, and why in words
//   digitsSwapped                two phone numbers that differ only by two neighbouring digits being swapped
//   isRoleEmail / isPlaceholderPhone   mailboxes and numbers that belong to a business or to nobody, not to one person

const NICK: Record<string, string> = {
  bob: "robert", rob: "robert", robby: "robert", bobby: "robert", bert: "robert", bill: "william", billy: "william", will: "william", willy: "william", liam: "william",
  dick: "richard", rick: "richard", ricky: "richard", rich: "richard", richie: "richard", jim: "james", jimmy: "james", jamie: "james", jack: "john", johnny: "john", jon: "john", johnnie: "john",
  mike: "michael", mick: "michael", mikey: "michael", mitch: "michael", tom: "thomas", tommy: "thomas", dave: "david", davey: "david", steve: "stephen", steven: "stephen", stevie: "stephen",
  chris: "christopher", kit: "christopher", tony: "anthony", andy: "andrew", drew: "andrew", matt: "matthew", pete: "peter", joe: "joseph", joey: "joseph", dan: "daniel", danny: "daniel",
  ben: "benjamin", benny: "benjamin", sam: "samuel", sammy: "samuel", nick: "nicholas", nicky: "nicholas", ed: "edward", eddie: "edward", ted: "edward", teddy: "edward", ned: "edward",
  hank: "henry", harry: "henry", hal: "henry", chuck: "charles", charlie: "charles", chas: "charles", al: "albert", fred: "frederick", freddie: "frederick", greg: "gregory", jeff: "jeffrey",
  ken: "kenneth", kenny: "kenneth", larry: "lawrence", len: "leonard", lenny: "leonard", walt: "walter", don: "donald", ron: "ronald", ronnie: "ronald", phil: "philip", pat: "patrick", paddy: "patrick",
  liz: "elizabeth", lizzie: "elizabeth", beth: "elizabeth", betty: "elizabeth", betsy: "elizabeth", eliza: "elizabeth", lisa: "elizabeth", kate: "katherine", katie: "katherine", kathy: "katherine", katy: "katherine", kat: "katherine", catherine: "katherine", cathy: "katherine",
  meg: "margaret", maggie: "margaret", peggy: "margaret", marge: "margaret", sue: "susan", susie: "susan", suzy: "susan", jen: "jennifer", jenny: "jennifer", jess: "jessica", jessie: "jessica",
  becky: "rebecca", becca: "rebecca", abby: "abigail", debbie: "deborah", deb: "deborah", barb: "barbara", patty: "patricia", trish: "patricia", tricia: "patricia", vicky: "victoria", vicki: "victoria",
  sandy: "alexandra", alex: "alexander", xander: "alexander", cindy: "cynthia", cyndi: "cynthia", mandy: "amanda", manny: "emmanuel", manuel: "emmanuel", ike: "isaac", jake: "jacob",
};

/** The full first name a nickname stands for ("bob" becomes "robert"). A name that is not in the list is returned as it is, lower case. */
export function canonicalFirst(first: string): string {
  const f = first.toLowerCase().replace(/[^a-z]/g, "");
  return NICK[f] ?? f;
}

/** American Soundex of one word: a letter and three digits. Empty for a word with no letters. */
export function soundex(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  const code: Record<string, string> = { b: "1", f: "1", p: "1", v: "1", c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2", d: "3", t: "3", l: "4", m: "5", n: "5", r: "6" };
  let out = w[0].toUpperCase();
  let last = code[w[0]] ?? "";
  for (let i = 1; i < w.length && out.length < 4; i++) {
    const c = code[w[i]] ?? "";
    if (c && c !== last) out += c;
    if (w[i] !== "h" && w[i] !== "w") last = c;
  }
  return out.padEnd(4, "0");
}

/** Jaro-Winkler similarity, 0 (nothing alike) to 1 (the same). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = true; bm[j] = true; matches++; break; }
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

const words = (name: string) => name.toLowerCase().replace(/[^a-z\s,'-]/g, " ").replace(/[-']/g, "").split(/[\s]+/).filter(Boolean);

/** First and last name from a full name. "Smith, John" is read as John Smith. Middle names are ignored. */
export function splitName(full: string): { first: string; last: string } {
  const comma = full.includes(",");
  const parts = full.split(",");
  const w = comma ? [...words(parts.slice(1).join(" ")), ...words(parts[0])] : words(full);
  const clean = w.filter((x) => !["mr", "mrs", "ms", "dr", "jr", "sr", "ii", "iii", "miss", "prof"].includes(x.replace(/\./g, "")));
  if (clean.length === 0) return { first: "", last: "" };
  if (clean.length === 1) return { first: clean[0], last: "" };
  return { first: clean[0], last: clean[clean.length - 1] };
}

export type NameKind = "exact" | "order" | "nickname" | "initial" | "spelling" | "none";
export type NameMatch = { kind: NameKind; score: number; label: string };

const NONE: NameMatch = { kind: "none", score: 0, label: "" };

/**
 * How alike two full names are. "exact" is the same words (any case); "order" the same words the other way round (Smith John); "nickname" the same last name
 * and a first name that is a short form (Bob and Robert); "initial" the same last name and a first name that is only an initial (J. and John); "spelling" the
 * same sound with a small typo (Jon Smyth and John Smith). A single word is never enough, and neither is a pair that differs on both names.
 */
export function nameSimilarity(a: string, b: string): NameMatch {
  const x = splitName(a);
  const y = splitName(b);
  if (!x.first || !y.first || !x.last || !y.last) return NONE;
  if (x.first === y.first && x.last === y.last) return { kind: "exact", score: 1, label: "same name" };
  if (x.first === y.last && x.last === y.first) return { kind: "order", score: 0.95, label: "same name, first and last swapped" };
  const lastSame = x.last === y.last || (jaroWinkler(x.last, y.last) >= 0.85 && soundex(x.last) === soundex(y.last));
  if (!lastSame) return NONE;
  const fx = canonicalFirst(x.first);
  const fy = canonicalFirst(y.first);
  if (fx === fy) return { kind: "nickname", score: 0.92, label: `${x.first} and ${y.first} are the same first name` };
  if ((x.first.length === 1 && y.first.startsWith(x.first)) || (y.first.length === 1 && x.first.startsWith(y.first))) return { kind: "initial", score: 0.85, label: "same last name, first name is an initial" };
  if (jaroWinkler(fx, fy) >= 0.9) return { kind: "spelling", score: 0.88, label: "names are spelled a little differently" };
  return NONE;
}

/** Two first names that are clearly two different people: both present, not a nickname, not an initial, not a close spelling. */
export function firstNamesDiffer(a: string, b: string): boolean {
  const x = splitName(a).first;
  const y = splitName(b).first;
  if (!x || !y) return false;
  const fx = canonicalFirst(x);
  const fy = canonicalFirst(y);
  if (fx === fy) return false;
  if ((x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))) return false;
  return jaroWinkler(fx, fy) < 0.85;
}

/** The two digit strings are the same length and differ only by two neighbouring digits being swapped (5550102030 and 5550102003). */
export function digitsSwapped(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length || a === b) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

/** The same digits in any order: the bucket key that finds swapped numbers without comparing every pair. */
export const digitBag = (digits: string): string => [...digits].sort().join("");

const ROLE = new Set([
  "info", "sales", "admin", "support", "contact", "office", "hello", "team", "billing", "accounts", "accounting", "enquiries", "inquiries", "mail", "service", "reception",
  "bookings", "booking", "orders", "help", "marketing", "hr", "jobs", "careers", "noreply", "no-reply", "webmaster", "postmaster", "customerservice", "manager", "enquiry",
]);

/** A mailbox that belongs to a business or a team, not to one person (info@, sales@, support@). */
export function isRoleEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return ROLE.has(email.slice(0, at).toLowerCase().split("+")[0]);
}

/** A number nobody owns: one digit repeated (0000000000), a counting run, or the made-up 555 range with a block of zeros. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length < 7) return false;
  const tail = d.slice(-10);
  if (/^(\d)\1+$/.test(tail)) return true;
  if (/(\d)\1{6,}$/.test(tail)) return true;
  return "01234567890123456789".includes(tail) || "98765432109876543210".includes(tail);
}
