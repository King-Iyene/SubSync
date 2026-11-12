// A person's name as people write it. Some CRM answers (a search, a quick webhook) carry the name in lower case only ("test lead one"). That is a copy of the name, not what the owner typed,
// so a name that is entirely lower case is shown with capitals at the start of each word. A name that already has any capital letter ("McDonald", "DE LA CRUZ", "Test Lead one") is
// shown exactly as stored: SubSync never changes a name somebody wrote on purpose. Pure and tested.

const SMALL = new Set(["de", "la", "da", "van", "von", "der", "den", "di", "del", "du", "le", "bin", "al"]);

export function properName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "";
  if (!/\p{L}/u.test(n) || n !== n.toLocaleLowerCase()) return n; // no letters, or a capital is already there: as stored
  const words = n.split(/(\s+)/);
  return words.map((w, i) => {
    if (/^\s+$/.test(w) || !w) return w;
    const lower = SMALL.has(w) && i > 0;
    if (lower) return w;
    // capital after a hyphen or an apostrophe too ("anne-marie", "o'neil")
    return w.replace(/(^|[-'’])(\p{L})/gu, (_m, p: string, c: string) => p + c.toLocaleUpperCase());
  }).join("");
}
