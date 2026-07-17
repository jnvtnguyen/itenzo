// "PLAN IT FOR ME" FULL-TRIP GENERATION (PLAN §3.3 DOOR 3, §4 TIER 1.1).
// ONE LLM CALL DRAFTS THEMED, GEOGRAPHICALLY CLUSTERED DAYS AS SEARCH
// INTENTS; EVERY PLACE IS THEN RESOLVED THROUGH THE REAL PLACES PROVIDER —
// THE LLM NEVER INVENTS A VENUE. THE RESULT IS APPLIED THROUGH THE SAME
// STORE PRIMITIVES A THUMB USES, SO EVERYTHING STAYS EDITABLE AND UNDOABLE.
import type { Block, Day, Place, Preferences } from '@/model/types';
import { snap_time } from '@/model/time';
import { ensure_anchor } from '@/services/ai_suggest';
import { resolve_fix_start } from '@/services/feasibility';
import { check_hours } from '@/services/hours';
import { llm_json } from '@/services/llm';
import { haversine_mi, type LngLat } from '@/services/geo';
import { new_session_token, places_provider } from '@/services/places_provider';

// PROXIMITY ONLY *BIASES* THE SEARCH API — A HARD FENCE KEEPS A DRAFTED
// "BOSTON" TRIP FROM PICKING UP VENUES IN FLORIDA (HUGE PHANTOM TRANSIT LEGS
// WERE ALSO WHAT STREWED CONFLICTS ACROSS GENERATED DAYS).
const MAX_DRAFT_MI = 60;

export interface DraftInput {
  destination: string;
  anchor?: LngLat;
  days: Pick<Day, 'id' | 'date'>[];
  travelers: number;
  preferences?: Preferences;
}

export interface DraftBlock {
  block_type: 'meal' | 'activity' | 'buffer' | 'note';
  title: string;
  start_time: number;
  duration_min: number;
  place?: Place;
  notes?: string;
}

export interface DraftDay {
  day_id: string;
  theme: string;
  blocks: DraftBlock[];
}

interface GenItem {
  search_query?: string;
  title?: string;
  block_type?: string;
  start_min?: number;
  duration_min?: number;
}

interface GenDay {
  date?: string;
  theme?: string;
  items?: GenItem[];
}

const SYSTEM = `You are the trip-draft engine inside Itenzo, a travel itinerary app.
Draft a day-by-day itinerary for the given destination and dates.
Respond with ONLY a JSON object, no prose:
{"days":[{"date":"YYYY-MM-DD","theme":string,"items":[{"search_query":string|null,"title":string,"block_type":"meal"|"activity"|"buffer","start_min":number,"duration_min":number}]}]}
Rules:
- One entry per given date, in order. "theme" is a short evocative day label (e.g. "Old Town & Harbor").
- Cluster each day geographically: pick one area/neighborhood per day and include that area's name in each "search_query" (e.g. "art museum North End").
- "search_query" is a SHORT venue search for a places API (2-5 words). Never invent a specific business name. Use null only for placeless items (breaks, "Sunset walk").
- "title" is the block's display name — generic ("Lunch", "Morning museum") since the real venue attaches later.
- Times are minutes since midnight. Start days between 480-570. Meals at local meal hours (breakfast ~510, lunch ~750, dinner ~1140). Leave 15-45 min gaps between items for transit.
- Pace sets density: relaxed = 3-4 items/day, balanced = 4-5, packed = 5-6. Respect interests and budget tier. Vary days; no repeated queries across the trip.`;

function sanitize_type(t: string | undefined): DraftBlock['block_type'] {
  return t === 'meal' || t === 'buffer' || t === 'note' ? t : 'activity';
}

// RESOLVE ONE ITEM'S SEARCH INTENT TO A REAL PLACE NEAR THE TRIP ANCHOR.
// TRIES A FEW CANDIDATES AND PREFERS ONE NOT PROVABLY CLOSED AT THAT TIME.
async function resolve_place(
  query: string,
  anchor: LngLat | undefined,
  date: string,
  start: number,
  duration: number,
  used_ids: Set<string>,
): Promise<Place | null> {
  const token = new_session_token();
  const suggestions = await places_provider.suggest(query, token, { proximity: anchor });
  const candidates = suggestions.filter((s) => !used_ids.has(s.suggestion_id)).slice(0, 3);
  let fallback: Place | null = null;
  for (const candidate of candidates) {
    const place = await places_provider.retrieve(candidate.suggestion_id, token);
    if (!place) continue;
    // HARD DISTANCE FENCE.
    if (anchor && place.coords && haversine_mi(anchor, place.coords) > MAX_DRAFT_MI) continue;
    const verdict = check_hours(place, date, start, start + duration);
    if (verdict.status === 'open' || verdict.status === 'unknown') {
      used_ids.add(candidate.suggestion_id);
      return place;
    }
    // WRONG TIME IS A FIXABLE CONFLICT; CLOSED ALL DAY IS NEVER DRAFTED.
    if (verdict.status !== 'closed_day') fallback = fallback ?? place;
  }
  return fallback;
}

export async function generate_trip_draft(input: DraftInput): Promise<DraftDay[] | null> {
  const payload = {
    destination: input.destination || null,
    dates: input.days.map((d) => d.date),
    travelers: input.travelers,
    preferences: input.preferences ?? null,
  };
  // FULL-TRIP GENERATION IS THE SLOW CALL — GIVE IT ROOM.
  const parsed = await llm_json<{ days?: GenDay[] }>(SYSTEM, JSON.stringify(payload), {
    timeout_ms: 90000,
  });
  if (!parsed?.days) return null;

  // ANCHOR FIRST — A TRIP WHOSE DESTINATION WAS TYPED (NEVER PICKED FROM THE
  // CITY LIST) HAS NO COORDS, AND UNANCHORED SEARCHES ROAM THE WHOLE PLANET.
  const anchor = await ensure_anchor(input.anchor, input.destination);

  const used_ids = new Set<string>();
  const out: DraftDay[] = [];

  for (const day of input.days) {
    const gen = parsed.days.find((g) => g.date === day.date) ?? parsed.days[out.length];
    if (!gen?.items) continue;

    const items = gen.items.slice(0, 7);
    // RESOLVE THE DAY'S PLACES IN PARALLEL — EACH ITEM IS INDEPENDENT.
    const places = await Promise.all(
      items.map((item) => {
        const query = item.search_query?.trim();
        if (!query) return Promise.resolve<Place | null>(null);
        const start = Math.round(item.start_min ?? 540);
        const duration = Math.round(item.duration_min ?? 60);
        return resolve_place(query, anchor, day.date, start, duration, used_ids);
      }),
    );

    // FEASIBILITY PASS (§6: "FEASIBILITY IS CODE, NOT LLM"): EACH BLOCK'S
    // START RESOLVES AGAINST THE DAY AS BUILT SO FAR — TRANSIT FROM THE
    // PREVIOUS STOP, OPENING HOURS, NO OVERLAPS — SO THE DRAFT LANDS CLEAN
    // INSTEAD OF STREWN WITH TIGHT-TRANSFER CONFLICTS.
    const blocks: DraftBlock[] = [];
    const placed: Block[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const duration = Math.min(Math.max(Math.round(item.duration_min ?? 60), 30), 360);
      const raw_start = Math.min(
        Math.max(snap_time(Math.round(item.start_min ?? 540)), 0),
        1440 - duration,
      );
      const place = places[i];
      const title = place?.name ?? item.title?.trim();
      if (!title) continue;
      const pseudo: Block = {
        id: `__draft_${i}__`,
        block_type: sanitize_type(item.block_type),
        title,
        start_time: raw_start,
        end_time: raw_start + duration,
        place: place ?? undefined,
        source: 'ai_suggested',
        is_locked: false,
      };
      // THE PREVIOUS DRAFT BLOCK'S END IS A HARD FLOOR — THE LLM'S GAPS MAY
      // BE TOO OPTIMISTIC ONCE REAL TRANSIT TIMES ATTACH.
      const prev = placed[placed.length - 1];
      const floor = prev ? Math.max(raw_start, prev.end_time) : raw_start;
      const start = resolve_fix_start(
        { id: day.id, date: day.date, blocks: placed },
        pseudo,
        Math.min(floor, 1440 - duration),
      );
      // A DAY CAN GENUINELY RUN OUT OF ROOM (RESOLUTION CLAMPED INTO THE
      // PREVIOUS BLOCK OR PAST MIDNIGHT) — DROP THE ITEM RATHER THAN LAND A
      // GUARANTEED CONFLICT.
      if (prev && start < prev.end_time) continue;
      if (start + duration > 1440) continue;
      blocks.push({
        block_type: pseudo.block_type as DraftBlock['block_type'],
        title,
        start_time: start,
        duration_min: duration,
        place: place ?? undefined,
      });
      placed.push({ ...pseudo, start_time: start, end_time: start + duration });
    }
    if (blocks.length > 0) {
      out.push({ day_id: day.id, theme: (gen.theme ?? '').trim(), blocks });
    }
  }
  return out.length > 0 ? out : null;
}
