import type { HoursWindow, PlaceHours } from '@/model/types';

// CONVERTS MAPBOX SEARCH BOX `metadata.open_hours` (FROM THE `visit` ATTRIBUTE
// SET) INTO OUR STRUCTURED PlaceHours. VERIFIED AGAINST THE LIVE API: `day` IS
// 0=SUNDAY..6=SATURDAY (SAME AS Date.getDay(), CROSS-CHECKED VIA weekday_text)
// AND `time` IS AN "HHMM" STRING.

export interface MapboxOpenHours {
  periods?: {
    open?: { day?: number; time?: string };
    close?: { day?: number; time?: string };
  }[];
}

function hhmm_to_min(time?: string): number | null {
  if (!time || time.length < 3) return null;
  const h = Number(time.slice(0, time.length - 2));
  const m = Number(time.slice(-2));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return Math.min(1440, h * 60 + m);
}

export function parse_open_hours(raw?: MapboxOpenHours): PlaceHours | undefined {
  const periods = raw?.periods ?? [];
  if (periods.length === 0) return undefined;

  const weekly: HoursWindow[][] = Array.from({ length: 7 }, () => []);
  for (const period of periods) {
    const day = period.open?.day;
    const open_min = hhmm_to_min(period.open?.time);
    if (day == null || day < 0 || day > 6 || open_min == null) continue;

    // A LONE MIDNIGHT OPEN WITH NO CLOSE IS THE 24/7 CONVENTION.
    if (period.close == null) {
      if (periods.length === 1 && open_min === 0) {
        return { weekly: Array.from({ length: 7 }, () => [{ open_min: 0, close_min: 1440 }]) };
      }
      weekly[day].push({ open_min, close_min: 1440 });
      continue;
    }

    const close_day = period.close.day ?? day;
    const close_min = hhmm_to_min(period.close.time);
    if (close_min == null) continue;

    if (close_day === day && close_min > open_min) {
      weekly[day].push({ open_min, close_min });
    } else {
      // OVERNIGHT WINDOW (BAR OPEN 6 PM – 2 AM) — SPLIT AT MIDNIGHT SO EACH
      // DAY'S CHECK STAYS LOCAL TO THAT DAY.
      weekly[day].push({ open_min, close_min: 1440 });
      const spill_day = close_day === day ? (day + 1) % 7 : close_day % 7;
      if (close_min > 0) weekly[spill_day].push({ open_min: 0, close_min });
    }
  }

  if (weekly.every((windows) => windows.length === 0)) return undefined;
  for (const windows of weekly) windows.sort((a, b) => a.open_min - b.open_min);
  return { weekly };
}
