"use client";

import { useEffect } from "react";

// White-label: when a company has set its own business name, the product name is replaced everywhere a person can read it
// (page text, the browser tab title, and hover or placeholder text), including messages that come from the server.
// Only text is changed, never markup. Without a brand name nothing happens.
const PRODUCT = /SubSync/g;
const ATTRS = ["title", "placeholder", "aria-label", "alt"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT"]);

export function brandReplace(text: string, name: string): string {
  return text.replace(PRODUCT, () => name);
}

function fixNode(node: Node, name: string) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = (node as Text).parentElement;
    if (parent && SKIP_TAGS.has(parent.tagName)) return;
    const v = node.nodeValue ?? "";
    if (v.includes("SubSync")) node.nodeValue = brandReplace(v, name);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (SKIP_TAGS.has(el.tagName)) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v && v.includes("SubSync")) el.setAttribute(a, brandReplace(v, name)); }
  el.childNodes.forEach((c) => fixNode(c, name));
}

export function useBrandedText(name: string | null) {
  useEffect(() => {
    if (!name || name.includes("SubSync")) return; // nothing to do, or the replacement would match itself
    const apply = () => { fixNode(document.body, name); if (document.title.includes("SubSync")) document.title = brandReplace(document.title, name); };
    apply();
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") r.addedNodes.forEach((n) => fixNode(n, name));
        else if (r.type === "characterData") fixNode(r.target, name);
        else if (r.type === "attributes") fixNode(r.target, name);
      }
      if (document.title.includes("SubSync")) document.title = brandReplace(document.title, name);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [name]);
}
