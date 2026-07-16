import { fmt_time, weekday_long } from '@/model/time';
import type { Block, Place } from '@/model/types';

// OPENING-HOURS FEASIBILITY (PLAN §4 TIER 1.2 — "FEASIBILITY IS CODE, NOT
// LLM"). DETERMINISTIC CHECKS OF A BLOCK'S SCHEDULED SPAN AGAINST ITS PLACE'S
// STRUCTURED HOURS; RE-EVALUATED ON EVERY RENDER SO DRAGS REVALIDATE LIVE.

const TIGHT_ARRIVAL_MIN = 30;

export type HoursVerdict =
  | { status: 'unknown' }
  | { status: 'open'; label: string }
  | { status: 'ends_after_close'; label: string }
  | { status: 'closes_soon'; label: string; conflict: string }
  | { status: 'closed_day'; label: string; conflict: string }
  | { status: 'closed_time'; label: string; conflict: string };

export function check_hours(
  place: Place | undefined,
  date: string,
  start_time: number,
  end_time: number,
): HoursVerdict {
  const weekly = place?.hours?.weekly;
  if (!weekly) return { status: 'unknown' };
  const windows = weekly[new Date(`${date}T12:00:00`).getDay()] ?? [];

  if (windows.length === 0) {
    const day_name = weekday_long(date);
    return {
      status: 'closed_day',
      label: `Closed ${day_name}s`,
      conflict: `${place!.name} is closed on ${day_name}s`,
    };
  }

  // ALWAYS-OPEN PLACES (PARKS, TRAILS) SKIP THE CHIP NOISE ENTIRELY.
  if (windows.some((w) => w.open_min <= 0 && w.close_min >= 1440)) {
    return { status: 'unknown' };
  }

  const window = windows.find((w) => start_time >= w.open_min && start_time < w.close_min);
  if (!window) {
    const next = windows.find((w) => w.open_min > start_time);
    return {
      status: 'closed_time',
      label: next ? `Opens ${fmt_time(next.open_min)}` : `Closed by ${fmt_time(start_time)}`,
      conflict: next
        ? `Doesn't open until ${fmt_time(next.open_min)}`
        : `Already closed at ${fmt_time(start_time)}`,
    };
  }

  if (window.close_min - start_time < TIGHT_ARRIVAL_MIN) {
    return {
      status: 'closes_soon',
      label: `Closes ${fmt_time(window.close_min)}`,
      conflict: `Closes ${window.close_min - start_time} min after you arrive`,
    };
  }

  if (end_time > window.close_min) {
    return { status: 'ends_after_close', label: `Closes ${fmt_time(window.close_min)}` };
  }

  return { status: 'open', label: `Open until ${fmt_time(window.close_min)}` };
}

// DISPLAY-TIME DECORATION: RETURNS THE BLOCK WITH AN HOURS CHIP/CONFLICT
// APPLIED. PURE AND NON-PERSISTED — THE STORE NEVER SEES THESE, SO MOVING A
// BLOCK TO A VALID TIME CLEARS THE FLAG WITH ZERO BOOKKEEPING.
export function decorate_block_hours(block: Block, date: string): Block {
  const verdict = check_hours(block.place, date, block.start_time, block.end_time);
  if (verdict.status === 'unknown') return block;

  if (verdict.status === 'open') {
    if (block.meta?.chip) return block;
    return {
      ...block,
      meta: { ...block.meta, chip: { label: verdict.label, kind: 'anchor' } },
    };
  }

  if (verdict.status === 'ends_after_close') {
    return {
      ...block,
      meta: { ...block.meta, chip: { label: verdict.label, kind: 'meal' } },
    };
  }

  // HARD PROBLEMS (CLOSED / TIGHT): DANGER CHIP + CONFLICT LINE. AN EXISTING
  // TRANSIT CONFLICT KEEPS PRIORITY — ONE RED REASON AT A TIME. "OPENS LATER"
  // CONFLICTS CARRY A ONE-TAP FIX TO THE OPENING TIME.
  const windows = block.place!.hours!.weekly[new Date(`${date}T12:00:00`).getDay()] ?? [];
  const next_open = windows.find((w) => w.open_min > block.start_time);
  return {
    ...block,
    meta: {
      ...block.meta,
      chip: { label: verdict.label, kind: 'danger' },
      conflict: block.meta?.conflict ?? verdict.conflict,
      fix:
        block.meta?.fix ??
        (verdict.status === 'closed_time' && next_open
          ? { start_time: next_open.open_min }
          : undefined),
    },
  };
}
