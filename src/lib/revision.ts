/**
 * Plan revisions. Pure and client-safe: the plan page composes a ChangeSet from card actions, drag reorders and the
 * model's proposal for a free-text request, previews it with these helpers, and the server applies the same code.
 *
 * A revision never edits a stored plan in place. It produces a new PlanInput, runs as a new plan id with `parentId`
 * set, and the parent keeps its share link. See src/lib/agent/run.ts for how a revision run reuses the parent.
 */
import { legDaysAlong, matchesCity } from "@/lib/routing";
import type { ChangeSet, CityPoolEntry, Plan, PlanInput, Stop } from "@/lib/types";

export const EMPTY_CHANGES: ChangeSet = { lock: [], unlock: [], drop: [], restore: [] };

const uniq = (xs: string[]) => [...new Set(xs)];

export function isEmptyChangeSet(c: ChangeSet): boolean {
  return (
    !c.lock.length &&
    !c.unlock.length &&
    !c.drop.length &&
    !c.restore.length &&
    c.stops === undefined &&
    c.window === undefined &&
    c.budgetTier === undefined &&
    c.order === undefined
  );
}

/** Merge a later change-set over an earlier one. Later lock/drop win over earlier unlock/restore of the same city. */
export function mergeChanges(a: ChangeSet, b: ChangeSet): ChangeSet {
  const lock = uniq([...a.lock.filter((id) => !b.unlock.includes(id)), ...b.lock]);
  const unlock = uniq([...a.unlock.filter((id) => !b.lock.includes(id)), ...b.unlock]);
  const drop = uniq([...a.drop.filter((id) => !b.restore.includes(id)), ...b.drop]);
  const restore = uniq([...a.restore.filter((id) => !b.drop.includes(id)), ...b.restore]);
  return {
    lock: lock.filter((id) => !unlock.includes(id) || b.lock.includes(id)),
    unlock: unlock.filter((id) => !lock.includes(id) || b.unlock.includes(id)),
    drop: drop.filter((id) => !restore.includes(id) || b.drop.includes(id)),
    restore: restore.filter((id) => !drop.includes(id) || b.restore.includes(id)),
    stops: b.stops ?? a.stops,
    window: b.window ?? a.window,
    budgetTier: b.budgetTier ?? a.budgetTier,
    // A city-set change invalidates a manual order (the router can no longer honour it).
    order: b.order ?? (b.drop.length || b.restore.length || b.stops !== undefined ? undefined : a.order),
  };
}

/** Resolve user-typed or model-written city keys against the pool. Unmatched keys are returned as typed. */
export function resolveCities(keys: string[], pool: Pick<CityPoolEntry, "id" | "name">[]): { ids: string[]; unmatched: string[] } {
  const ids: string[] = [];
  const unmatched: string[] = [];
  for (const key of keys) {
    const k = key.trim();
    if (!k) continue;
    const hit = pool.find((c) => matchesCity(c, k)) ?? pool.find((c) => c.name.toLowerCase().startsWith(k.toLowerCase()));
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else unmatched.push(k);
  }
  return { ids, unmatched };
}

const without = (list: string[], ids: string[], pool: Pick<CityPoolEntry, "id" | "name">[]) =>
  list.filter((key) => !ids.some((id) => key === id || pool.some((c) => c.id === id && matchesCity(c, key))));

/** The parent's input with the change-set applied. Pure; the result is a complete PlanInput. */
export function applyChanges(input: PlanInput, c: ChangeSet, pool: Pick<CityPoolEntry, "id" | "name">[]): PlanInput {
  const lockedCities = uniq([...without(input.lockedCities, [...c.unlock, ...c.drop], pool), ...c.lock]);
  const excludedCities = uniq([...without(input.excludedCities, [...c.restore, ...c.lock], pool), ...c.drop]);
  const order = c.order ?? (c.drop.length || c.restore.length || c.stops !== undefined ? undefined : input.order);
  return {
    ...input,
    lockedCities,
    excludedCities,
    stops: c.stops ?? input.stops,
    window: c.window ?? input.window,
    budgetTier: c.budgetTier ?? input.budgetTier,
    order: order && order.length ? order : undefined,
  };
}

export interface ChangeLine {
  kind: "lock" | "unlock" | "drop" | "restore" | "stops" | "window" | "budgetTier" | "order";
  text: string;
}

/** Human lines for the diff preview and the stored revisionNote, e.g. "Drop Tulsa", "Stops 10 → 9". */
export function describeChanges(c: ChangeSet, plan: Pick<Plan, "input" | "stops">, pool: Pick<CityPoolEntry, "id" | "name">[]): ChangeLine[] {
  const name = (id: string) => pool.find((p) => p.id === id)?.name ?? plan.stops.find((s) => s.city.id === id)?.city.name ?? id;
  const out: ChangeLine[] = [];
  for (const id of c.drop) out.push({ kind: "drop", text: `Drop ${name(id)}` });
  for (const id of c.restore) out.push({ kind: "restore", text: `Allow ${name(id)} again` });
  for (const id of c.lock) out.push({ kind: "lock", text: `Lock ${name(id)}` });
  for (const id of c.unlock) out.push({ kind: "unlock", text: `Unlock ${name(id)}` });
  if (c.stops !== undefined && c.stops !== plan.input.stops) out.push({ kind: "stops", text: `Stops ${plan.input.stops} → ${c.stops}` });
  if (c.window !== undefined && c.window !== plan.input.window) out.push({ kind: "window", text: `Window ${plan.input.window ?? "unset"} → ${c.window}` });
  if (c.budgetTier !== undefined && c.budgetTier !== plan.input.budgetTier) out.push({ kind: "budgetTier", text: `Budget ${plan.input.budgetTier} → ${c.budgetTier}` });
  if (c.order) {
    const current = plan.stops.map((s) => s.city.id);
    if (c.order.join("|") !== current.join("|")) {
      const moved = c.order.filter((id, i) => current[i] !== id).map(name);
      out.push({ kind: "order", text: moved.length <= 2 ? `Route reordered: ${moved.join(", ")} moved` : `Route reordered by hand (${moved.length} stops moved)` });
    }
  }
  return out;
}

export function revisionNote(lines: ChangeLine[]): string {
  return lines.map((l) => l.text).join(" · ").slice(0, 300);
}

/**
 * True when the change-set only reorders the same cities: the server then clones the parent with the new order and
 * recomputed travel days instead of running the agent, so it is instant and free.
 */
export function isReorderOnly(c: ChangeSet, plan: Pick<Plan, "stops">): boolean {
  if (!c.order) return false;
  const current = plan.stops.map((s) => s.city.id);
  const same = c.order.length === current.length && current.every((id) => c.order!.includes(id));
  return same && !c.lock.length && !c.unlock.length && !c.drop.length && !c.restore.length && c.stops === undefined && c.window === undefined && c.budgetTier === undefined;
}

/**
 * The stops in a manual order with `order` renumbered and `legDays` recomputed. Used by the route strip while the
 * user drags and by the server's reorder-only clone. Ids not in `stops` are ignored; stops missing from `cityIds`
 * keep their relative order at the end.
 */
export function reorderStops(stops: Stop[], cityIds: string[]): Stop[] {
  const byId = new Map(stops.map((s) => [s.city.id, s]));
  const picked = cityIds.map((id) => byId.get(id)).filter((s): s is Stop => Boolean(s));
  const rest = stops.filter((s) => !picked.includes(s));
  const ordered = [...picked, ...rest];
  const days = legDaysAlong(ordered.map((s) => s.city));
  return ordered.map((s, i) => ({ ...s, order: i + 1, legDays: days[i] }));
}
