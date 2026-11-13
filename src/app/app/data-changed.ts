// The "data changed" signal, browser side: after any sync lands, every open screen re-reads its own data quietly (no spinner, no layout jump, scroll and open panels stay).
// Screens subscribe through useData (session.tsx); anything else may subscribe with onDataChanged.
export type DataChanged = { version: number; /** A person pressed a sync button: always announced, even for a version already seen. */ force?: boolean };
type Listener = (d: DataChanged) => void;
const listeners = new Set<Listener>();
let last = -1;

export function onDataChanged(cb: Listener): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Tell every subscriber. A background version is announced once (two polls that see the same change must not refresh twice); a manual sync is always announced. */
export function emitDataChanged(d: DataChanged): boolean {
  if (!d.force && d.version <= last) return false;
  if (!d.force && d.version > last) last = d.version;
  for (const cb of [...listeners]) { try { cb(d); } catch { /* one screen failing never stops the others */ } }
  return true;
}
/** The first answer of a session only records the version (nothing changed yet from this screen's point of view). Returns true when the version moved since the last one seen. */
export function noteVersion(version: number): boolean {
  if (last < 0) { last = version; return false; }
  return emitDataChanged({ version });
}
export function resetDataChangedForTests(): void { listeners.clear(); last = -1; }
