// A small sliding-window rate limiter, in memory. Pure (no network), so it is unit tested. It protects the public share page: a
// guesser who asks for many unknown links is turned away before the database is touched. Memory is per server instance, which is
// enough for this (the link itself is an unguessable 192 bit token; this only makes guessing slower and cheaper to refuse).
export type Limiter = { allow: (key: string, now?: number) => boolean; size: () => number };

export function createLimiter(max: number, windowMs: number, maxKeys = 5000): Limiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        // Forget the keys whose window has passed so the map cannot grow without limit.
        for (const [k, v] of hits) if (v.every((t) => t <= now - windowMs)) hits.delete(k);
        if (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      }
      return true;
    },
    size: () => hits.size,
  };
}
