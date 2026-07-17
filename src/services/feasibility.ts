import type { Block, Day, Place, TransitLeg } from '@/model/types';
import { haversine_mi } from '@/services/geo';
import { decorate_block_hours } from '@/services/hours';

// THE FEASIBILITY ENGINE (PLAN §4 TIER 1.2–1.3, §6: "FEASIBILITY IS CODE, NOT
// LLM"). AUTO-TRANSIT LEGS AND TIGHT-TRANSFER CONFLICTS WITH ONE-TAP FIXES —
// ALL DETERMINISTIC, RE-DERIVED AT DISPLAY TIME SO EVERY DRAG/UNDO
// REVALIDATES WITH ZERO STORED STATE.
//
// DISTANCES ARE STRAIGHT-LINE HAVERSINE WITH CITY-PACE HEURISTICS; THE MAPBOX
// DIRECTIONS ADAPTER REPLACES compute_leg WITHOUT TOUCHING ANY CALLER.

const DAY_MIN = 1440;
const SNAP = 15;
const WALK_MAX_MI = 0.8;
// A LEG SHORTER THAN THIS IS "SAME PLACE" — NO CONNECTOR AT ALL.
const MIN_LEG_MI = 0.03;

type Coords = NonNullable<Place['coords']>;

// DISTANCE-BASED MODE DEFAULT (§4 TIER 1.3): WALK UNDER 0.8 MI, DRIVE ABOVE.
export function compute_leg(a?: Coords, b?: Coords): TransitLeg | null {
  if (!a || !b) return null;
  const mi = haversine_mi(a, b);
  if (mi < MIN_LEG_MI) return null;
  const distance_mi = Math.round(mi * 10) / 10;
  if (mi <= WALK_MAX_MI) {
    return { mode: 'walk', duration_min: Math.max(2, Math.ceil(mi * 20)), distance_mi };
  }
  return { mode: 'drive', duration_min: Math.ceil(6 + mi * 4), distance_mi };
}

// PER-LEG MODE OVERRIDE: SAME CITY-PACE HEURISTICS, FORCED MODE. RIDESHARE
// ADDS PICKUP WAIT; TRANSIT ADDS WALK-TO-STOP + HEADWAY.
export function leg_for_mode(a?: Coords, b?: Coords, mode?: TransitLeg['mode']): TransitLeg | null {
  if (mode == null) return compute_leg(a, b);
  if (!a || !b) return null;
  const mi = haversine_mi(a, b);
  if (mi < MIN_LEG_MI) return null;
  const distance_mi = Math.round(mi * 10) / 10;
  switch (mode) {
    case 'walk':
      return { mode, duration_min: Math.max(2, Math.ceil(mi * 20)), distance_mi };
    case 'drive':
      return { mode, duration_min: Math.ceil(6 + mi * 4), distance_mi };
    case 'rideshare':
      return { mode, duration_min: Math.ceil(10 + mi * 4), distance_mi };
    case 'transit':
      return { mode, duration_min: Math.ceil(10 + mi * 5), distance_mi };
  }
}

const mode_word: Record<TransitLeg['mode'], string> = {
  walk: 'walk',
  drive: 'drive',
  transit: 'transit',
  rideshare: 'ride',
};

function ceil_snap(min: number): number {
  return Math.ceil(min / SNAP) * SNAP;
}

// FULL DAY DECORATION: SORTS, COMPUTES TRANSIT LEGS WHERE BOTH ENDS HAVE
// COORDS (SEEDED/MANUAL LEGS SURVIVE WHERE THEY DON'T), FLAGS TIGHT TRANSFERS
// WITH A ONE-TAP FIX TARGET, THEN RUNS THE OPENING-HOURS CHECKS.
export function decorate_day(day: Day): Block[] {
  const out = [...day.blocks]
    .sort((a, b) => a.start_time - b.start_time)
    .map((b) => ({ ...b, meta: b.meta ? { ...b.meta } : undefined }) as Block);

  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    const computed = leg_for_mode(a.place?.coords, b.place?.coords, a.transit_mode_override);
    if (computed) a.meta = { ...a.meta, transit_to_next: computed };
    const leg = computed ?? a.meta?.transit_to_next;
    if (!leg) continue;

    const free = b.start_time - a.end_time;
    if (free < leg.duration_min && !b.is_locked) {
      const duration = b.end_time - b.start_time;
      b.meta = {
        ...b.meta,
        conflict: `${leg.duration_min} min ${mode_word[leg.mode]}, only ${Math.max(free, 0)} min free`,
        chip: { label: 'Tight transfer', kind: 'danger' },
        fix: {
          start_time: Math.min(ceil_snap(a.end_time + leg.duration_min), DAY_MIN - duration),
        },
      };
    } else if (b.meta?.chip?.label === 'Tight transfer') {
      // DERIVED STATE THAT NO LONGER HOLDS — CLEAR IT.
      b.meta = { ...b.meta, conflict: undefined, chip: undefined, fix: undefined };
    }
  }

  return out.map((b) => decorate_block_hours(b, day.date));
}

// PACING ENGINE (§4 TIER 2): A DAY'S INTENSITY FROM SCHEDULED HOURS, WALKING
// MILES, AND BACK-TO-BACK TRANSITIONS — DETERMINISTIC, DERIVED AT DISPLAY TIME.
export interface DayPacing {
  intensity: 'relaxed' | 'balanced' | 'packed';
  scheduled_min: number;
  walk_mi: number;
  back_to_back: number;
  cost_total: number;
}

const BACK_TO_BACK_GAP_MIN = 15;

export function day_pacing(blocks: Block[]): DayPacing {
  const sorted = [...blocks].sort((a, b) => a.start_time - b.start_time);
  let scheduled_min = 0;
  let walk_mi = 0;
  let back_to_back = 0;
  let cost_total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    // NOTES AND BUFFERS ARE REST, NOT LOAD.
    if (b.block_type !== 'note' && b.block_type !== 'buffer') {
      scheduled_min += b.end_time - b.start_time;
    }
    if (b.cost != null) cost_total += b.cost;
    const leg = b.meta?.transit_to_next;
    if (leg?.mode === 'walk' && leg.distance_mi) walk_mi += leg.distance_mi;
    const next = sorted[i + 1];
    if (next && next.start_time - b.end_time - (leg?.duration_min ?? 0) < BACK_TO_BACK_GAP_MIN) {
      back_to_back += 1;
    }
  }
  const score = scheduled_min / 60 + walk_mi * 1.5 + back_to_back * 0.75;
  return {
    intensity: score >= 10 ? 'packed' : score < 5 ? 'relaxed' : 'balanced',
    scheduled_min,
    walk_mi: Math.round(walk_mi * 10) / 10,
    back_to_back,
    cost_total,
  };
}

// ONE-TAP FIX PLACEMENT: THE NAIVE SUGGESTION (OPENING TIME / PREV END +
// TRANSIT) MAY ITSELF BE INFEASIBLE — E.G. OPENING TIME LANDS ON A LOCKED
// FLIGHT, OR HOPPING PAST THE FLIGHT NOW NEEDS ITS TRANSIT LEG. ITERATE THE
// CONSTRAINTS (HOURS → LOCKED ANCHORS → TRANSIT) UNTIL THE START IS STABLE,
// SO A SINGLE TAP LANDS THE BLOCK SOMEWHERE THAT ACTUALLY WORKS.
export function resolve_fix_start(day: Day, block: Block, suggested: number): number {
  const duration = block.end_time - block.start_time;
  const others = day.blocks
    .filter((b) => b.id !== block.id)
    .sort((a, b) => a.start_time - b.start_time);
  const weekly = block.place?.hours?.weekly;
  const windows = weekly ? (weekly[new Date(`${day.date}T12:00:00`).getDay()] ?? []) : null;
  const always_open =
    windows == null ||
    windows.length === 0 ||
    windows.some((w) => w.open_min <= 0 && w.close_min >= 1440);

  let start = suggested;
  for (let pass = 0; pass < 8; pass++) {
    let next = start;

    if (!always_open) {
      const inside = windows!.find((w) => next >= w.open_min && next < w.close_min);
      if (!inside) {
        const upcoming = windows!.find((w) => w.open_min > next);
        if (upcoming) next = upcoming.open_min;
      }
    }

    // LOCKED ANCHORS ARE IMMOVABLE — THE SPAN LANDS AFTER ANY IT WOULD OVERLAP.
    for (const b of others) {
      if (b.is_locked && next < b.end_time && next + duration > b.start_time) next = b.end_time;
    }

    // TRANSIT FROM WHATEVER NOW PRECEDES THE BLOCK MUST FIT.
    const prev = [...others].reverse().find((b) => b.end_time <= next);
    if (prev) {
      const leg = compute_leg(prev.place?.coords, block.place?.coords) ?? prev.meta?.transit_to_next;
      if (leg && next < prev.end_time + leg.duration_min) next = prev.end_time + leg.duration_min;
    }

    next = Math.min(ceil_snap(next), DAY_MIN - duration);
    if (next === start) break;
    start = next;
  }
  return start;
}
