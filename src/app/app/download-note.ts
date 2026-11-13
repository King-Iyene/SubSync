// The small notice shown after every file download (Export CSV and the rest). A download that does nothing visible looks like a broken button, and an embedded
// page can have downloads blocked by the host, so the notice says what happened and offers the file in a new tab as a fallback. Plain DOM, no React, so any caller can use it.
let timer: ReturnType<typeof setTimeout> | null = null;

export function showDownloadNote(kind: "done" | "failed", filename: string, openUrl?: string): void {
  if (typeof document === "undefined") return;
  let box = document.querySelector<HTMLElement>("[data-testid='download-note']");
  if (!box) {
    box = document.createElement("div");
    box.setAttribute("data-testid", "download-note");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;max-width:min(92vw,520px);padding:10px 14px;border-radius:10px;border:1px solid var(--border,#c9c9c9);background:var(--card,#ffffff);color:var(--foreground,#111111);font-size:14px;line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,.25)";
    document.body.appendChild(box);
  }
  const note = box;
  note.textContent = "";
  const text = document.createElement("span");
  text.textContent = kind === "done" ? `Downloaded ${filename} to your Downloads folder. ` : `Could not download ${filename}. Try again in a moment. `;
  note.appendChild(text);
  if (kind === "done" && openUrl) {
    const a = document.createElement("a");
    a.href = openUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Nothing downloaded? Open the file.";
    a.style.cssText = "text-decoration:underline;margin-right:8px";
    note.appendChild(a);
  }
  const close = document.createElement("button");
  close.type = "button"; close.textContent = "Dismiss"; close.style.cssText = "text-decoration:underline;cursor:pointer;background:none;border:0;color:inherit;font:inherit";
  close.onclick = () => note.remove();
  note.appendChild(close);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => note.remove(), 12000);
}

/** Save a file the page built itself: a hidden link that is clicked, then the notice above. The one place that does it. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
  showDownloadNote("done", filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
