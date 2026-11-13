"use client";

import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { fitView, panBy, percent, stepZoom, wheelFactor, zoomAt, type View } from "@/lib/design/flow-zoom";
import { useReducedMotion } from "../speed6-base";

// A small pan and zoom canvas (pure CSS transform, no library). Wheel or trackpad pinch zooms at the pointer, drag the background to move,
// two fingers pinch on a phone. Fit scales and centres the whole drawing. Buttons and nodes inside keep working because the browser scales their hit areas with the drawing.

export type CanvasHandle = { centerOn: (x: number, y: number, z?: number) => void; fit: () => void };

type Props = {
  contentW: number; contentH: number;
  /** Changes whenever the drawing changes (new data, new layout): the canvas re-fits itself. */
  fitKey: string;
  /** Overlay: the plain mouse wheel zooms. In the page: Ctrl + wheel (or trackpad pinch) zooms so the page can still scroll. */
  wheelZoom: boolean;
  /** Listen to the whole window for + - 0 F and arrows (full screen view). Otherwise only while the canvas has focus. */
  globalKeys?: boolean;
  onViewSize?: (w: number, h: number) => void;
  extra?: ReactNode;
  className?: string;
  label: string;
  children: ReactNode;
};

const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.closest("input, select, textarea") !== null || t.isContentEditable);
const isInteractive = (t: EventTarget | null) => t instanceof HTMLElement && t.closest("button, a, input, select, textarea, [data-nopan]") !== null;

export const FlowCanvas = forwardRef<CanvasHandle, Props>(function FlowCanvas({ contentW, contentH, fitKey, wheelZoom, globalKeys, onViewSize, extra, className, label, children }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [view, setViewState] = useState<View>({ z: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [anim, setAnim] = useState(false);
  const [dragging, setDragging] = useState(false);
  const setView = useCallback((v: View, animate = false) => { viewRef.current = v; setAnim(animate); setViewState(v); }, []);

  const fit = useCallback((animate = true) => {
    const { w, h } = sizeRef.current; if (!w || !h) return;
    setView(fitView(contentW, contentH, w, h), animate);
  }, [contentW, contentH, setView]);
  const zoomBy = useCallback((dir: 1 | -1) => { const { w, h } = sizeRef.current; setView(zoomAt(viewRef.current, stepZoom(viewRef.current.z, dir), w / 2, h / 2), true); }, [setView]);
  const reset = useCallback(() => { const { w, h } = sizeRef.current; setView(zoomAt(viewRef.current, 1, w / 2, h / 2), true); }, [setView]);

  useImperativeHandle(ref, () => ({
    fit: () => fit(true),
    centerOn: (x, y, z = 1) => { const { w, h } = sizeRef.current; setView({ z, x: w / 2 - x * z, y: h / 2 - y * z }, true); },
  }), [fit, setView]);

  // Measure the visible area; fit again whenever it or the drawing changes.
  useEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); sizeRef.current = { w: r.width, h: r.height }; onViewSize?.(Math.floor(r.width), Math.floor(r.height)); };
    const ro = new ResizeObserver(() => { measure(); fit(false); });
    measure(); ro.observe(el);
    return () => ro.disconnect();
  }, [fit, onViewSize]);
  useEffect(() => { fit(false); }, [fitKey, fit]);

  // Wheel at the pointer. Non-passive so the page does not scroll while zooming.
  useEffect(() => {
    const el = box.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!wheelZoom && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView(zoomAt(viewRef.current, viewRef.current.z * wheelFactor(e.deltaY, e.deltaMode), e.clientX - r.left, e.clientY - r.top), false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [wheelZoom, setView]);

  const onKey = useCallback((e: KeyboardEvent | React.KeyboardEvent) => {
    if (isField(e.target) || e.altKey || e.metaKey || e.ctrlKey) return;
    const step = 80;
    if (e.key === "+" || e.key === "=") zoomBy(1);
    else if (e.key === "-" || e.key === "_") zoomBy(-1);
    else if (e.key === "0") reset();
    else if (e.key === "f" || e.key === "F") fit(true);
    else if (e.key === "ArrowLeft") setView(panBy(viewRef.current, step, 0), true);
    else if (e.key === "ArrowRight") setView(panBy(viewRef.current, -step, 0), true);
    else if (e.key === "ArrowUp") setView(panBy(viewRef.current, 0, step), true);
    else if (e.key === "ArrowDown") setView(panBy(viewRef.current, 0, -step), true);
    else return;
    e.preventDefault();
  }, [zoomBy, reset, fit, setView]);
  useEffect(() => {
    if (!globalKeys) return;
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [globalKeys, onKey]);

  // Drag the background to move; two pointers pinch.
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: "pan" | "pinch"; start: View; d0: number; m0: { x: number; y: number }; p0: { x: number; y: number } } | null>(null);
  const local = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const startPinch = () => {
    const [a, b] = [...pts.current.values()];
    gesture.current = { kind: "pinch", start: viewRef.current, d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, p0: { x: 0, y: 0 } };
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.current.set(e.pointerId, local(e));
    if (pts.current.size === 2) { startPinch(); setDragging(true); return; }
    if (pts.current.size === 1 && !isInteractive(e.target)) {
      box.current!.setPointerCapture(e.pointerId);
      gesture.current = { kind: "pan", start: viewRef.current, d0: 0, m0: local(e), p0: { x: 0, y: 0 } };
      setDragging(true);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, local(e));
    const g = gesture.current; if (!g) return;
    if (g.kind === "pan" && pts.current.size === 1) {
      const p = local(e); setView(panBy(g.start, p.x - g.m0.x, p.y - g.m0.y), false);
    } else if (g.kind === "pinch" && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAt(g.start, g.start.z * (d / g.d0), g.m0.x, g.m0.y);
      setView(panBy(zoomed, m.x - g.m0.x, m.y - g.m0.y), false);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size === 0) { gesture.current = null; setDragging(false); }
    else if (pts.current.size === 1) { const [p] = [...pts.current.values()]; gesture.current = { kind: "pan", start: viewRef.current, d0: 0, m0: p, p0: { x: 0, y: 0 } }; }
  };

  const smooth = anim && !reduced && !dragging;
  return (
    <div className={`ap-canvas ${className ?? ""}`} data-testid="ap-canvas" data-dragging={dragging ? "1" : undefined}>
      <div ref={box} className="ap-canvas-view" tabIndex={0} role="application" aria-label={`${label}. Drag to move, scroll or pinch to change the size, press F to fit.`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={globalKeys ? undefined : onKey}>
        <div className="ap-canvas-content" data-testid="ap-canvas-content" data-zoom={view.z.toFixed(3)}
          style={{ width: contentW, height: contentH, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, transition: smooth ? "transform 180ms ease" : "none" }}>
          {children}
        </div>
      </div>
      <div className="ap-canvas-ctl" data-nopan role="toolbar" aria-label="Size">
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Make smaller" title="Make smaller (-)" data-testid="ap-zoom-out"><ZoomOut aria-hidden className="size-4" /></button>
        <button type="button" onClick={reset} className="ap-canvas-pct" aria-label="Reset to 100%" title="Reset to 100% (0)" data-testid="ap-zoom-pct">{percent(view.z)}</button>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Make bigger" title="Make bigger (+)" data-testid="ap-zoom-in"><ZoomIn aria-hidden className="size-4" /></button>
        <button type="button" onClick={() => fit(true)} className="ap-canvas-fit" aria-label="Fit the whole tree" title="Fit the whole tree (F)" data-testid="ap-zoom-fit"><Scan aria-hidden className="size-4" />Fit</button>
        <button type="button" onClick={reset} className="ap-canvas-100" title="Reset to 100% (0)" data-testid="ap-zoom-reset">100%</button>
        {extra}
      </div>
      <span className="ap-canvas-hint" aria-hidden>Scroll to resize, drag to move</span>
    </div>
  );
});
