"use client";

import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import type { WaitRow } from "./unanswered-rows";

// The mounting points of the Unanswered screen. Other slices add their pieces in NEW files and register them here, so this screen never imports them and they never import it:
//
//   registerUnansweredSlot("RowActions", MyComponent)          // once, from a module the lead imports in unanswered-slots-mount.tsx
//
// A slot nobody registered renders nothing (or a neutral placeholder for the cards), so every piece can ship behind its own flag. The screen passes each slot the props below; the
// pieces check their own flag with `flags` (every inbox_* flag of the caller, already resolved on the server). The same applies to the actions the keyboard calls (claim, snooze).

export type Flags = Record<string, boolean>;
/** A person on the list, as the lists hand it over. `dealValue` is the open deal worth more than zero, when there is one. */
export type UiRow = WaitRow & { dealValue?: number | null; lastAt?: number };

export type SlotProps = {
  /** The action menu or buttons beside a person (claim, snooze, assign, note, clear). `onChanged` makes the list read again. */
  RowActions: { row: UiRow; flags: Flags; showAccount: boolean; onChanged: () => void };
  /** The lead panel, if another slice replaces ours. Rarely needed: the screen already opens the shared panel through usePersonActions. */
  OpenLeadPanel: { rows: UiRow[]; index: number | null; onIndex: (n: number | null) => void; onClose: () => void };
  /** The floating bar that appears when people are selected: the actions for several people at once. */
  BulkActions: { rows: UiRow[]; flags: Flags; clear: () => void; onChanged: () => void };
  ReceiptCard: CardProps; CurveCard: CardProps; ScorecardCard: CardProps; BenchmarkCard: CardProps; VerifiedPageCard: CardProps;
};
export type CardProps = { flags: Flags; multi: boolean; showPeople: boolean; open: (title: string, params: Record<string, string>) => void; go: (view: string) => void };
export type SlotName = keyof SlotProps;
export const CARD_SLOTS: readonly SlotName[] = ["ReceiptCard", "CurveCard", "ScorecardCard", "BenchmarkCard", "VerifiedPageCard"];

const registry = new Map<SlotName, ComponentType<never>>();
const listeners = new Set<() => void>();
export function registerUnansweredSlot<N extends SlotName>(name: N, component: ComponentType<SlotProps[N]>): void { registry.set(name, component as ComponentType<never>); listeners.forEach((l) => l()); }
export const hasUnansweredSlot = (name: SlotName) => registry.has(name);

/** Re-renders the caller when a slot is registered later (a lazily loaded piece). */
export function useSlotsVersion(): number {
  const [v, tick] = useState(0);
  useEffect(() => { const l = () => tick((x) => x + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return v;
}

/** Draws the registered piece, or nothing. */
export function Slot<N extends SlotName>({ name, ...props }: { name: N } & SlotProps[N]): ReactNode {
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const C = registry.get(name) as ComponentType<SlotProps[N]> | undefined;
  return C ? <C {...(props as unknown as SlotProps[N])} /> : null;
}

// ---- actions the keyboard (and the bulk bar) can call: "claim" and "snooze" are written by the actions slice and registered here ----
export type ActionName = "claim" | "snooze";
type ActionFn = (row: UiRow) => void | Promise<void>;
const actions = new Map<ActionName, ActionFn>();
export function registerUnansweredAction(name: ActionName, fn: ActionFn): void { actions.set(name, fn); }
/** Runs the action; false when no slice has registered it (the screen then says it is not available yet). */
export function runUnansweredAction(name: ActionName, row: UiRow): boolean { const fn = actions.get(name); if (!fn) return false; void fn(row); return true; }
export const hasUnansweredAction = (name: ActionName) => actions.has(name);

// ---- what the screen tells every piece ----
export type RoomContext = { flags: Flags; seePeople: boolean; kind: string; me: string | null };
const Ctx = createContext<RoomContext>({ flags: {}, seePeople: false, kind: "", me: null });
export const RoomProvider = Ctx.Provider;
export const useRoom = () => useContext(Ctx);
