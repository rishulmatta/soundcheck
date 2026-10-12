"use client";

import { useCallback, useMemo, useState } from "react";
import type { ChangeSet, Plan, Stop } from "@/lib/types";
import { EMPTY_CHANGES, applyChanges, describeChanges, isEmptyChangeSet, mergeChanges, reorderStops, resolveCities, type ChangeLine } from "@/lib/revision";

/** One removable line in the draft: the text from describeChanges plus what removing it clears. */
export interface DraftItem extends ChangeLine {
  key: string;
  /** City id for lock/unlock/drop/restore lines. */
  id?: string;
}

type Field = "stops" | "window" | "budgetTier" | "order";

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * The pending revision on the plan page. It holds the raw ChangeSet; every other value is derived from it, so the
 * card buttons, the route strip, the revise bar and a model proposal all edit one object and "Re-run" sends it as is.
 */
export function useRevisionDraft(plan: Plan) {
  const [changes, setChanges] = useState<ChangeSet>(EMPTY_CHANGES);
  // Every routable city is in plan.candidates, so it doubles as the pool for names and ids.
  const pool = plan.candidates;
  const currentOrder = useMemo(() => plan.stops.map((s) => s.city.id), [plan.stops]);

  const baseLocked = useMemo(() => new Set(resolveCities(plan.input.lockedCities, pool).ids), [plan.input.lockedCities, pool]);
  const baseExcluded = useMemo(() => new Set(resolveCities(plan.input.excludedCities, pool).ids), [plan.input.excludedCities, pool]);

  /** Drop entries that would be no-ops against the parent input, so a toggled button leaves no chip behind. */
  const normalize = useCallback(
    (c: ChangeSet): ChangeSet => ({
      ...c,
      lock: c.lock.filter((id) => !baseLocked.has(id)),
      unlock: c.unlock.filter((id) => baseLocked.has(id)),
      drop: c.drop.filter((id) => !baseExcluded.has(id)),
      restore: c.restore.filter((id) => baseExcluded.has(id)),
      stops: c.stops === plan.input.stops ? undefined : c.stops,
      window: c.window === plan.input.window ? undefined : c.window,
      budgetTier: c.budgetTier === plan.input.budgetTier ? undefined : c.budgetTier,
      order: c.order && !same(c.order, currentOrder) ? c.order : undefined,
    }),
    [baseLocked, baseExcluded, plan.input.stops, plan.input.window, plan.input.budgetTier, currentOrder],
  );

  const add = useCallback((partial: Partial<ChangeSet>) => {
    setChanges((prev) => normalize(mergeChanges(prev, { ...EMPTY_CHANGES, ...partial })));
  }, [normalize]);

  const setField = useCallback(
    <K extends Field>(key: K, value: ChangeSet[K] | undefined) => setChanges((prev) => normalize({ ...prev, [key]: value })),
    [normalize],
  );
  const setOrder = useCallback((cityIds: string[]) => setField("order", cityIds), [setField]);
  const clear = useCallback(() => setChanges(EMPTY_CHANGES), []);

  const isLocked = useCallback((id: string) => (baseLocked.has(id) && !changes.unlock.includes(id)) || changes.lock.includes(id), [baseLocked, changes.lock, changes.unlock]);
  const isDropped = useCallback((id: string) => (baseExcluded.has(id) && !changes.restore.includes(id)) || changes.drop.includes(id), [baseExcluded, changes.drop, changes.restore]);
  const toggleLock = useCallback((id: string) => add(isLocked(id) ? { unlock: [id] } : { lock: [id] }), [add, isLocked]);
  const toggleDrop = useCallback((id: string) => add(isDropped(id) ? { restore: [id] } : { drop: [id] }), [add, isDropped]);

  const items = useMemo<DraftItem[]>(() => {
    const out: DraftItem[] = [];
    const one = (partial: Partial<ChangeSet>) => describeChanges({ ...EMPTY_CHANGES, ...partial }, plan, pool);
    for (const kind of ["drop", "restore", "lock", "unlock"] as const) {
      for (const id of changes[kind]) {
        const line = one({ [kind]: [id] })[0];
        if (line) out.push({ ...line, key: `${kind}:${id}`, id });
      }
    }
    for (const field of ["stops", "window", "budgetTier", "order"] as const) {
      if (changes[field] === undefined) continue;
      const line = one({ [field]: changes[field] })[0];
      if (line) out.push({ ...line, key: field });
    }
    return out;
  }, [changes, plan, pool]);

  /** Remove one line from the draft, leaving the rest. */
  const remove = useCallback((item: DraftItem) => {
    setChanges((prev) => {
      if (item.id && (item.kind === "lock" || item.kind === "unlock" || item.kind === "drop" || item.kind === "restore")) {
        return { ...prev, [item.kind]: prev[item.kind].filter((x) => x !== item.id) };
      }
      if (item.kind === "stops" || item.kind === "window" || item.kind === "budgetTier" || item.kind === "order") return { ...prev, [item.kind]: undefined };
      return prev;
    });
  }, []);

  const lines = useMemo(() => describeChanges(changes, plan, pool), [changes, plan, pool]);
  const empty = useMemo(() => isEmptyChangeSet(changes), [changes]);
  const previewInput = useMemo(() => applyChanges(plan.input, changes, pool), [plan.input, changes, pool]);
  const viewStops = useMemo<Stop[]>(() => (changes.order ? reorderStops(plan.stops, changes.order) : plan.stops), [plan.stops, changes.order]);

  return {
    changes,
    add,
    setField,
    setOrder,
    clear,
    remove,
    items,
    lines,
    empty,
    count: items.length,
    previewInput,
    viewStops,
    reordered: Boolean(changes.order),
    isLocked,
    isDropped,
    toggleLock,
    toggleDrop,
  };
}

export type RevisionDraft = ReturnType<typeof useRevisionDraft>;
