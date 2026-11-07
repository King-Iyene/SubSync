// A wait in minutes as people say it: "45 min", "13 h 19 min", "2 d 3 h". Used by every slim lead row in Speed.
export function humanWait(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}
export const initialsOf = (name: string): string => { const p = name.trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase(); };
