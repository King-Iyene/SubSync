// A small in-memory cache that forgets (stage F10, the call list 504). It keeps the answer of a slow list for a short time per server instance, so pressing
// a list twice, or two people opening the same list, does not read the whole account twice. Never used for anything that must be fresh to the second, and
// the people who log a call clear their installation's entries so the list they see moves at once. Pure: the clock is passed in, so it is unit tested.

export type TtlCache<V> = {
  get: (key: string) => V | undefined;
  set: (key: string, value: V) => void;
  /** Forget every key that starts with the prefix (an installation's id). */
  clear: (prefix: string) => number;
  size: () => number;
};

export function ttlCache<V>(ttlMs: number, maxEntries = 200, now: () => number = Date.now): TtlCache<V> {
  const store = new Map<string, { at: number; value: V }>();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) { store.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value) {
      if (store.size >= maxEntries && !store.has(key)) {
        // Drop the oldest entry (a Map keeps insertion order).
        const first = store.keys().next().value;
        if (first !== undefined) store.delete(first);
      }
      store.delete(key);
      store.set(key, { at: now(), value });
    },
    clear(prefix) {
      let n = 0;
      for (const k of [...store.keys()]) if (k.startsWith(prefix)) { store.delete(k); n++; }
      return n;
    },
    size: () => store.size,
  };
}
