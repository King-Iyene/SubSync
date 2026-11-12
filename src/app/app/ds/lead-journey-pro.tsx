"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { BRANCH_START, fitFont, flowSpeed, journeyGeometry, sampleParticles, thicknessAt, warmth, type Branch, type Geo, type Particle } from "@/lib/analytics/lead-journey-geo";
import "./lead-journey-pro.css";

// Lead journey, river view. One glowing river runs from "arrived" to "won"; its width is the number of leads. Where leads are lost, a branch peels off and fades into a labelled delta.
// The river is drawn on a canvas in its own zone; every number and label is a normal button in a separate layer around it (callout cards and drop-off labels with leader lines), so
// particles can never cover text. Particles are a sample (at most 300); every number shown is the exact count passed in. Quiet when off screen, hidden or reduced motion.

export type JourneyPoint = { step: string; label: string; count: number; dropped: number; dropShare: number | null; medianFromPrev: number | null };
const QUESTION: Record<string, string> = { arrived: "Who came in?", touched: "Who got a first touch?", replied: "Who replied?", booked: "Who booked?", showed: "Who showed up?", won: "Who became a customer?" };
const fmt = (n: number) => n.toLocaleString("en-US");
const MAX_PARTICLES = 300;

type Hot = { kind: "seg" | "drop"; i: number } | null;
const hsl = (w: number, dark: boolean, a: number, gold = false) => (gold ? `hsla(42,42%,${dark ? 62 : 38}%,${a})` : `hsla(${Math.round(150 - w * 112)},${dark ? 26 : 30}%,${dark ? 62 : 36}%,${a})`);

function reducedMotion() { return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

export function LeadJourneyPro({ steps, onOpen, label = "Lead journey", pulseKey }: { steps: JourneyPoint[]; onOpen: (step: string, dropped: boolean) => void; label?: string; pulseKey?: number }) {
  const wrap = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), slider = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(0);
  const [hot, setHot] = useState<Hot>(null);
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null);
  const [run, setRun] = useState(0);
  const [reduced, setReduced] = useState(false);
  const hotRef = useRef<Hot>(null);
  const prog = useRef(1), playing = useRef(false), pulse = useRef(0), visible = useRef(true);
  const prevArrived = useRef<number | null>(null);
  const kick = useRef<() => void>(() => {});
  useEffect(() => { hotRef.current = hot; }, [hot]);

  const geo = useMemo<Geo | null>(() => (width > 0 ? journeyGeometry(steps.map((s) => ({ count: s.count, dropped: s.dropped })), width) : null), [steps, width]);
  const particles = useMemo<Particle[]>(() => sampleParticles(steps.map((s) => ({ count: s.count, dropped: s.dropped })), MAX_PARTICLES), [steps]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    setReduced(reducedMotion());
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // A new lead arrived: a short pulse at the start of the river.
  useEffect(() => {
    const a = steps[0]?.count ?? 0;
    if (prevArrived.current !== null && a > prevArrived.current) { pulse.current = performance.now(); kick.current(); }
    prevArrived.current = a;
  }, [steps, pulseKey]);

  // The drawing loop.
  useEffect(() => {
    const cv = canvas.current, st = stage.current; if (!cv || !geo || !st) return;
    const g = geo, n = steps.length, segs = n - 1;
    if (segs < 1) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(g.width * dpr); cv.height = Math.round(g.height * dpr);
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const dark = () => (st.closest("[data-theme]")?.getAttribute("data-theme") ?? "light") === "dark";
    const base = g.vertical ? [0, 1, -1, 0, g.width, 0] : [1, 0, 0, 1, 0, 0];
    const setBase = (c: CanvasRenderingContext2D) => c.setTransform(dpr * base[0], dpr * base[1], dpr * base[2], dpr * base[3], dpr * base[4], dpr * base[5]);
    const wait = steps.map((s, i) => (i === 0 ? null : s.medianFromPrev));
    const segW = (i: number) => warmth(wait[i + 1] ?? null);
    const isWin = (i: number) => i === segs - 1 && steps[n - 1].count > 0;
    const colour = (i: number, a: number, d: boolean) => hsl(segW(i), d, a, isWin(i));
    const bezC = (b: Branch) => ({ c1m: b.m0 + 0.25 * g.seg, c2m: b.m1 - 0.1 * g.seg, c2c: b.c0 + (b.c1 - b.c0) * 0.55 });
    const bez = (b: Branch, t: number) => {
      const { c1m, c2m, c2c } = bezC(b), u = 1 - t;
      return { m: u * u * u * b.m0 + 3 * u * u * t * c1m + 3 * u * t * t * c2m + t * t * t * b.m1, c: u * u * u * b.c0 + 3 * u * u * t * b.c0 + 3 * u * t * t * c2c + t * t * t * b.c1 };
    };
    const branchPath = (x: CanvasRenderingContext2D, b: Branch) => { const { c1m, c2m, c2c } = bezC(b); x.beginPath(); x.moveTo(b.m0, b.c0); x.bezierCurveTo(c1m, b.c0, c2m, c2c, b.m1, b.c1); };
    const thickAt = (i: number, s: number) => thicknessAt(g.thick[i], g.thick[i + 1], s);
    const segPath = (x: CanvasRenderingContext2D, i: number, k: number) => {
      x.beginPath(); x.moveTo(g.m[i], g.rT);
      for (let q = 0; q <= k; q++) x.lineTo(g.m[i] + (q / k) * g.seg, g.rT);
      for (let q = k; q >= 0; q--) x.lineTo(g.m[i] + (q / k) * g.seg, g.rT + thickAt(i, q / k));
      x.closePath();
    };

    let staticLayer: HTMLCanvasElement | null = null, staticDark: boolean | null = null;
    const sprites = new Map<string, HTMLCanvasElement>();
    const sprite = (key: string, col: string) => {
      let s = sprites.get(key); if (s) return s;
      s = document.createElement("canvas"); s.width = s.height = 32; const x = s.getContext("2d")!;
      x.fillStyle = col; x.beginPath(); x.arc(16, 16, 6, 0, Math.PI * 2); x.fill(); sprites.set(key, s); return s;
    };
    const buildStatic = (d: boolean) => {
      const off = document.createElement("canvas"); off.width = cv.width; off.height = cv.height;
      const x = off.getContext("2d")!; setBase(x);
      for (let i = 0; i < segs; i++) {
        if (g.thick[i] <= 0) continue;
        const ramp = segs > 1 ? 0.5 + 0.45 * (i / (segs - 1)) : 0.8, m0 = g.m[i], m1 = g.m[i + 1];
        const gr = x.createLinearGradient(m0, 0, m1, 0); gr.addColorStop(0, colour(i, ramp * (d ? 0.62 : 0.7), d)); gr.addColorStop(1, colour(Math.min(segs - 1, i + 1), ramp * (d ? 0.62 : 0.7), d));
        x.save(); x.shadowBlur = 0; x.fillStyle = gr; segPath(x, i, 28); x.fill(); x.restore();
        x.fillStyle = gr; segPath(x, i, 28); x.fill();
        x.strokeStyle = colour(i, d ? 0.9 : 0.8, d); x.lineWidth = 1.2; x.beginPath(); x.moveTo(m0, g.rT); x.lineTo(m1, g.rT); x.stroke();
      }
      g.branches.forEach((b) => {
        if (!b) return; const i = b.i - 1;
        const gr = x.createLinearGradient(b.m0, b.c0, b.m1, b.c1); gr.addColorStop(0, colour(i, d ? 0.55 : 0.6, d)); gr.addColorStop(1, colour(i, 0, d));
        x.save(); x.lineCap = "butt"; x.strokeStyle = gr; x.lineWidth = b.d; x.shadowBlur = 0;
        branchPath(x, b); x.stroke(); x.restore();
      });
      // Stations: a thin tick across the river and a dot where the leader line lands.
      steps.forEach((s, i) => {
        const t = Math.max(g.thick[i], 3); x.fillStyle = hsl(segW(Math.min(i, segs - 1)), d, 0.95, i === n - 1 && s.count > 0);
        x.fillRect(g.m[i] - 1, g.rT - 2, 2, t + 4); x.beginPath(); x.arc(g.m[i], g.rT, 3.5, 0, Math.PI * 2); x.fill();
      });
      return off;
    };

    const place = (p: Particle, time: number) => {
      const i = p.seg, sp = flowSpeed(wait[i + 1] ?? null), rate = 0.16 * sp * p.j;
      const ph = (p.ph + time * rate) % 1, t0 = g.thick[i], t1 = g.thick[i + 1];
      const share = t0 > 0 ? Math.min(1, t1 / t0) : 1;
      const lostShare = Math.max(0, t0 - t1);
      let m: number, c: number, a = 1, size = 6 + Math.min(6, t0 / 14);
      const b = p.lost ? g.branches[i + 1] : null;
      if (b) {
        if (ph < BRANCH_START) { m = g.m[i] + ph * g.seg; c = g.rT + t1 + Math.min(lostShare, b.d) * p.u; a = Math.min(1, ph / 0.05); }
        else { const t = (ph - BRANCH_START) / (1 - BRANCH_START), q = bez(b, t), off = (p.u - 0.5) * b.d * (1 - 0.7 * t); m = q.m + off * t; c = q.c + off * (1 - t); a = Math.pow(1 - t, 1.4); size *= 1 - 0.4 * t; }
      } else { m = g.m[i] + ph * g.seg; c = g.rT + p.u * share * thickAt(i, ph); a = Math.min(1, ph / 0.06, (1 - ph) / 0.06); }
      return { m, c, a, size, i };
    };

    const draw = (time: number, now: number) => {
      const d = dark();
      if (!staticLayer || staticDark !== d) { staticLayer = buildStatic(d); staticDark = d; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      const headM = g.m[0] - 12 + prog.current * (g.m[n - 1] - g.m[0] + 24 + g.seg * 0.2);
      ctx.save(); setBase(ctx); ctx.beginPath(); ctx.rect(-10, -10, headM + 10, Math.max(g.width, g.height) + 20); ctx.clip();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(staticLayer, 0, 0); ctx.restore();
      const h = hotRef.current;
      if (h) {
        if (h.kind === "seg" && g.thick[h.i] > 0) { ctx.fillStyle = colour(h.i, 0.28, d); segPath(ctx, h.i, 20); ctx.fill(); }
        else if (h.kind === "drop") { const b = g.branches[h.i]; if (b) { ctx.strokeStyle = colour(h.i - 1, 0.35, d); ctx.lineWidth = b.d; branchPath(ctx, b); ctx.stroke(); } }
      }
      ctx.globalCompositeOperation = d ? "lighter" : "source-over";
      for (const p of particles) {
        const q = place(p, time); if (q.a <= 0.02) continue;
        const win = q.i === segs - 1 && !p.lost && steps[n - 1].count > 0;
        const key = `${win ? "g" : Math.round(segW(q.i) * 10)}${d ? "d" : "l"}`;
        const s = sprite(key, hsl(segW(q.i), d, 0.9, win));
        ctx.globalAlpha = q.a * (d ? 0.95 : 0.85) * (h && h.kind === "seg" && h.i !== q.i ? 0.45 : 1);
        const sz = q.size * (win ? 1.3 : 1); ctx.drawImage(s, q.m - sz / 2, q.c - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      const pa = (now - pulse.current) / 1800;
      if (pulse.current && pa >= 0 && pa < 1) { ctx.strokeStyle = hsl(0.1, d, 1 - pa); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(g.m[0], g.rT + g.thick[0] / 2, 8 + pa * 34, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    };

    let raf = 0, last = 0, clock = 2;
    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now; clock += dt;
      if (playing.current) { prog.current = Math.min(1, prog.current + dt / 4.5); if (slider.current) slider.current.value = String(Math.round(prog.current * 100)); if (prog.current >= 1) playing.current = false; }
      draw(clock, now);
      if (!reducedMotion() && visible.current && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const start = () => { if (raf) return; last = 0; raf = requestAnimationFrame(frame); };
    kick.current = start;
    const io = new IntersectionObserver((e) => { visible.current = e[0]?.isIntersecting ?? true; if (visible.current) start(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } });
    io.observe(cv);
    const vis = () => { if (!document.hidden) start(); };
    document.addEventListener("visibilitychange", vis);
    const mo = new MutationObserver(() => start());
    const themed = st.closest("[data-theme]"); if (themed) mo.observe(themed, { attributes: true, attributeFilter: ["data-theme"] });
    start();
    return () => { if (raf) cancelAnimationFrame(raf); io.disconnect(); mo.disconnect(); document.removeEventListener("visibilitychange", vis); kick.current = () => {}; };
  }, [geo, steps, particles]);

  // Calm version: redraw once when the hover changes.
  useEffect(() => { kick.current(); }, [hot, reduced]);

  const replay = useCallback(() => { prog.current = 0; playing.current = true; if (slider.current) slider.current.value = "0"; setRun((r) => r + 1); kick.current(); }, []);
  const scrub = (v: number) => { playing.current = false; prog.current = v / 100; kick.current(); };

  const hitAt = (px: number, py: number): Hot | undefined => {
    const g = geo; if (!g || g.n < 2) return undefined;
    const inRiver = px >= g.riverRect.x && px <= g.riverRect.x + g.riverRect.w && py >= g.riverRect.y && py <= g.riverRect.y + g.riverRect.h;
    if (!inRiver) return undefined;
    const { m, c } = g.toAbstract(px, py);
    const i = Math.min(g.n - 2, Math.max(0, Math.floor((m - g.m[0]) / g.seg)));
    const s = (m - g.m[i]) / g.seg, th = thicknessAt(g.thick[i], g.thick[i + 1], s);
    const br = g.branches[i + 1];
    let next: Hot = null;
    if (m >= g.m[0] - 6 && m <= g.m[g.n - 1] + 6) {
      if (c <= g.rT + th + 6 && c >= g.rT - 6) next = { kind: "seg", i };
      else if (br && s >= BRANCH_START - 0.02 && s <= 0.95 && c > g.rT + th) next = { kind: "drop", i: i + 1 };
    }
    return next;
  };
  const onMove = (e: React.PointerEvent) => {
    const st = stage.current, g = geo; if (!st || !g || g.n < 2) return;
    const r = st.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    if (e.pointerType === "mouse" && !reduced) {
      const rx = ((py / r.height) - 0.5) * -2.2, ry = ((px / r.width) - 0.5) * 2.2;
      st.style.setProperty("--ljp-rx", `${rx.toFixed(2)}deg`); st.style.setProperty("--ljp-ry", `${ry.toFixed(2)}deg`);
      if (canvas.current) canvas.current.style.transform = `translate(${(-ry * 2.5).toFixed(1)}px, ${(rx * 2.5).toFixed(1)}px)`;
    }
    const next = hitAt(px, py);
    if (next === undefined) { setHot(null); setTipAt(null); return; }
    setHot((h) => (h && next && h.kind === next.kind && h.i === next.i ? h : next)); setTipAt(next ? { x: px, y: py } : null);
  };
  const onLeave = () => { setHot(null); setTipAt(null); const st = stage.current; if (st) { st.style.setProperty("--ljp-rx", "0deg"); st.style.setProperty("--ljp-ry", "0deg"); } if (canvas.current) canvas.current.style.transform = ""; };
  const onClickStage = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (!hot || !tipAt) return;
    if (hot.kind === "seg") onOpen(steps[hot.i + 1].step, false); else onOpen(steps[hot.i].step, true);
  };

  const tipText = (h: NonNullable<Hot>) => {
    if (h.kind === "seg") {
      const a = steps[h.i], b = steps[h.i + 1], pct = a.count > 0 ? Math.round((b.count / a.count) * 100) : 0;
      return { title: `${QUESTION[a.step] ?? a.label} then ${(QUESTION[b.step] ?? b.label).toLowerCase()}`, a: `${pct}% moved on (${fmt(b.count)} of ${fmt(a.count)})`, b: b.medianFromPrev === null ? "Wait not recorded yet" : `Typically ${fmtDuration(b.medianFromPrev)} after the step before` };
    }
    const s = steps[h.i];
    return { title: `Lost before "${s.label}"`, a: `${fmt(s.dropped)} ${s.dropped === 1 ? "lead" : "leads"}${s.dropShare === null ? "" : ` (${Math.round(s.dropShare * 100)}% of the step before)`}`, b: "Click to see the people" };
  };

  return (
    <div ref={wrap} className="ljp" data-testid="lead-journey-pro" data-reduced={reduced ? 1 : 0}>
      <div className="ljp-bar">
        <label className="ljp-scrub"><span>Replay position</span>
          <input ref={slider} type="range" min={0} max={100} defaultValue={100} onInput={(e) => scrub(Number((e.target as HTMLInputElement).value))} aria-label="Replay position: how the river builds up" data-testid="ljp-scrub" />
        </label>
        <button type="button" className="s6-btn" onClick={replay} data-testid="flow-replay">Replay</button>
      </div>
      <div ref={stage} className="ljp-stage" style={{ height: geo ? geo.height : 360, cursor: hot ? "pointer" : undefined }} role="group" aria-label={label} onPointerMove={onMove} onPointerLeave={onLeave} onClick={onClickStage} data-vertical={geo?.vertical ? 1 : 0} data-testid="flow" data-hot={hot ? `${hot.kind}${hot.i}` : ""}>
        <div className="ljp-mesh" aria-hidden />
        <canvas ref={canvas} className="ljp-canvas" style={geo ? { width: geo.width, height: geo.height } : undefined} aria-hidden data-testid="ljp-canvas" />
        {geo && (
          <>
            <svg className="ljp-leaders" width={geo.width} height={geo.height} aria-hidden>
              {geo.leaders.map((l) => <g key={`${l.kind}${l.i}`}><line x1={l.x0} y1={l.y0} x2={l.x1} y2={l.y1} data-on={hot && ((l.kind === "card" && hot.kind === "seg" && (hot.i === l.i - 1 || (l.i === 0 && hot.i === 0))) || (l.kind === "drop" && hot.kind === "drop" && hot.i === l.i)) ? 1 : 0} /><circle cx={l.x0} cy={l.y0} r={2.2} /></g>)}
            </svg>
            <div className="ljp-text" key={run} data-testid="ljp-text">
              {steps.map((s, i) => {
                const r = geo.cards[i], text = fmt(s.count), fs = fitFont(text.length, r.w - 20);
                return (
                  <div key={s.step} className="ljp-card" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} data-testid="flow-step" data-step={s.step} data-card={i}>
                    <button type="button" onClick={() => onOpen(s.step, false)} aria-label={`${s.label}: ${text} ${s.count === 1 ? "lead" : "leads"}. Open the people.`} onMouseEnter={() => setHot({ kind: "seg", i: Math.max(0, i - 1) })} onMouseLeave={() => setHot(null)} onFocus={() => setHot({ kind: "seg", i: Math.max(0, i - 1) })} onBlur={() => setHot(null)} data-win={i === steps.length - 1 && s.count > 0 ? 1 : 0}>
                      <span className="ljp-count" data-testid="flow-count" style={{ fontSize: fs }}>{text}</span>
                      <span className="ljp-q">{QUESTION[s.step] ?? s.label}</span>
                    </button>
                  </div>
                );
              })}
              {geo.drops.map((r, i) => {
                if (!r) return null; const s = steps[i], text = fmt(s.dropped), fs = fitFont(text.length, r.w - 18, 20, 11);
                return (
                  <div key={`d${i}`} className="ljp-drop" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} data-testid="ljp-drop">
                    <button type="button" data-testid="flow-bucket" onClick={() => onOpen(s.step, true)} aria-label={`${text} lost before ${s.label}. Open the people.`} onMouseEnter={() => setHot({ kind: "drop", i })} onMouseLeave={() => setHot(null)} onFocus={() => setHot({ kind: "drop", i })} onBlur={() => setHot(null)}>
                      <b className="tnum" style={{ fontSize: fs }}>{text}</b><span>dropped</span>
                    </button>
                  </div>
                );
              })}
            </div>
            {hot && tipAt && (() => { const t = tipText(hot), x = Math.min(Math.max(8, tipAt.x + 14), geo.width - 188), y = Math.min(Math.max(geo.riverRect.y + 4, tipAt.y + 12), geo.riverRect.y + geo.riverRect.h - 78); return (
              <div className="ljp-tip" style={{ left: x, top: y }} role="status" data-testid="ljp-tip"><strong>{t.title}</strong><span>{t.a}</span><span>{t.b}</span></div>
            ); })()}
          </>
        )}
      </div>
      <div className="sr-only">
        <table><caption>{label}</caption><thead><tr><th>Step</th><th>Leads</th><th>Dropped before this step</th><th>Typical wait after the step before</th></tr></thead>
          <tbody>{steps.map((s) => <tr key={s.step}><td>{s.label}</td><td>{s.count}</td><td>{s.dropped}</td><td>{s.medianFromPrev === null ? "not recorded" : fmtDuration(s.medianFromPrev)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
