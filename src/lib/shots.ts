// Screenshot mode for the marketplace listing images (npm run shots). `?shots=1` on the address hides every demo and sample label; it is remembered for the tab.
// It only does anything when the demo sign-in is on (the dashboard checks `auth.demo`, and the demo sign-in is refused in production), and it never changes data.
export function shotsRequested(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("shots") === "1") window.sessionStorage.setItem("subsync-shots", "1");
    return window.sessionStorage.getItem("subsync-shots") === "1";
  } catch { return false; }
}
