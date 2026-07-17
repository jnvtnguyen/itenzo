// THE CONVERSATIONAL/GAP SUGGESTION ENGINE (PLAN §3.2, §6). THE LLM NEVER
// INVENTS PLACES: IT TURNS THE TRIP CONTEXT (AND AN OPTIONAL USER ASK) INTO
// SHORT SEARCH INTENTS; THE PLACES PROVIDER SUPPLIES REAL VENUES NEAR THE
// ANCHOR; HOURS ARE CHECKED IN CODE BEFORE ANYTHING RENDERS AS ADDABLE.
import { snap_time, weekday_long } from '@/model/time';
import type { Block, BlockType, Place, Preferences } from '@/model/types';
import { haversine_mi, type LngLat } from '@/services/geo';
import { check_hours } from '@/services/hours';
import { llm_json } from '@/services/llm';
import { new_session_token, places_provider } from '@/services/places_provider';

export interface SuggestContext {
  destination: string;
  day_date: string;
  // THE DAY'S CURRENT BLOCKS — CONTEXT FOR "WHERE WILL I BE AROUND THEN".
  blocks: Block[];
  anchor?: LngLat;
  // WHEN SET, SUGGESTIONS TARGET THIS FREE WINDOW; OTHERWISE THE LLM PICKS A
  // SENSIBLE SLOT ITSELF.
  gap?: { from_min: number; to_min: number };
  preferences?: Preferences;
  travelers: number;
}

export interface SuggestionCard {
  place: Place;
  block_type: BlockType;
  start_time: number;
  duration_min: number;
  // THE ONE-LINE "WHY" — EXPLAINABILITY DRIVES TRUST (§3.2).
  why: string;
  distance_mi?: number;
}

export interface SuggestMoreOpts {
  // EVERYTHING ALREADY SHOWN — NEVER RE-SUGGESTED, AND THE LLM IS TOLD TO
  // VARY AWAY FROM IT.
  exclude?: { ids: string[]; names: string[] };
  // EACH "MORE IDEAS" ROUND CASTS A WIDER NET: 0 = CLOSE BY, EACH ROUND
  // EXTENDS THE DISTANCE FENCE (A GREAT SPOT 20 MI OUT BEATS NOTHING).
  round?: number;
}

interface PlanOption {
  search_query?: string;
  block_type?: string;
  start_min?: number;
  duration_min?: number;
  reason?: string;
}

const SYSTEM = `You are the planning engine inside Itenzo, a travel itinerary app.
Given a trip context (and possibly a specific user request), propose 4 to 6 varied things to do.
Respond with ONLY a JSON object, no prose: {"options":[{"search_query":string,"block_type":"meal"|"activity","start_min":number,"duration_min":number,"reason":string}]}
Rules:
- "search_query" is a SHORT venue search for a places API (2-4 words, e.g. "specialty coffee shop", "art museum", "ramen restaurant"). Never invent a specific business name unless the user explicitly named one.
- Times are minutes since midnight. If a free window is given, every option must fit entirely inside it. Meals at conventional local hours.
- "reason" is one concrete sentence under 70 characters explaining why this, here, now (mention the time of day, a nearby stop, or a stated interest).
- Respect the traveler's pace, interests, and budget tier when given. Vary the options.
- If "already_suggested" is non-empty, the traveler saw those and wants MORE — propose clearly different kinds of options (other categories, other vibes), never repeats. When "more_round" > 0, farther-afield ideas (a short drive out) are welcome.`;

// PROXIMITY IS A *BIAS* ON THE SEARCH API, NOT A FENCE — ODD QUERIES CAN
// STILL RETURN A MATCH IN ANOTHER STATE (OR COUNTRY). ANYTHING FARTHER THAN
// THIS FROM THE ANCHOR IS REJECTED OUTRIGHT. GENEROUS ON PURPOSE: A METRO
// AREA PLUS DAY-TRIP RANGE, NOT JUST THE BLOCK YOU'RE STANDING ON.
const MAX_SUGGEST_MI = 100;

// THE TRIP MAY HAVE NO COORDS AT ALL (DESTINATION TYPED, NEVER PICKED FROM
// THE CITY LIST) — GEOCODE THE DESTINATION TEXT SO SEARCHES STAY IN THE
// RIGHT CITY INSTEAD OF ROAMING THE GLOBE.
export async function ensure_anchor(
  anchor: LngLat | undefined,
  destination: string,
): Promise<LngLat | undefined> {
  if (anchor) return anchor;
  const q = destination.trim();
  if (!q) return undefined;
  const cities = await places_provider.search_cities(q);
  return cities[0]?.coords;
}

// RESOLVE ONE INTENT TO A REAL PLACE: TAKE THE PROVIDER'S TOP CANDIDATES,
// SKIP ANYTHING ALREADY ON THE DAY (OR ALREADY PICKED) OR OUTSIDE THE TRIP'S
// RADIUS, PREFER THE FIRST ONE THAT ISN'T PROVABLY CLOSED AT THE TIME.
async function resolve_option(
  option: Required<Pick<PlanOption, 'search_query'>> & PlanOption,
  ctx: SuggestContext,
  anchor: LngLat | undefined,
  used_ids: Set<string>,
  used_names: Set<string>,
  start: number,
  duration: number,
  max_mi: number,
): Promise<Place | null> {
  const token = new_session_token();
  const suggestions = await places_provider.suggest(option.search_query, token, {
    proximity: anchor,
  });
  const candidates = suggestions
    .filter((s) => !used_ids.has(s.suggestion_id) && !used_names.has(s.name.toLowerCase()))
    .slice(0, 5);
  let fallback: Place | null = null;
  for (const candidate of candidates) {
    const place = await places_provider.retrieve(candidate.suggestion_id, token);
    if (!place) continue;
    // HARD DISTANCE FENCE — NO "COFFEE" FROM ANOTHER CONTINENT.
    if (anchor && place.coords && haversine_mi(anchor, place.coords) > max_mi) continue;
    const verdict = check_hours(place, ctx.day_date, start, start + duration);
    if (verdict.status === 'open' || verdict.status === 'unknown') {
      used_ids.add(candidate.suggestion_id);
      return place;
    }
    // WRONG TIME IS A FIXABLE CONFLICT; CLOSED ALL DAY IS NEVER SUGGESTED.
    if (verdict.status !== 'closed_day') fallback = fallback ?? place;
  }
  return fallback;
}

export async function ai_suggestions(
  ctx: SuggestContext,
  user_query?: string,
  more?: SuggestMoreOpts,
): Promise<SuggestionCard[] | null> {
  const round = more?.round ?? 0;
  const payload = {
    destination: ctx.destination || null,
    date: ctx.day_date,
    weekday: weekday_long(ctx.day_date),
    travelers: ctx.travelers,
    preferences: ctx.preferences ?? null,
    free_window: ctx.gap ? { from_min: ctx.gap.from_min, to_min: ctx.gap.to_min } : null,
    user_request: user_query?.trim() || null,
    already_suggested: more?.exclude?.names ?? [],
    more_round: round,
    day_plan: ctx.blocks.map((b) => ({
      title: b.title,
      from_min: b.start_time,
      to_min: b.end_time,
      place: b.place?.name ?? null,
    })),
  };

  const parsed = await llm_json<{ options?: PlanOption[] }>(SYSTEM, JSON.stringify(payload));
  if (!parsed?.options) return null;

  // ANCHOR FIRST — WITHOUT ONE, EVERY SEARCH BELOW WOULD ROAM UNBIASED.
  const anchor = await ensure_anchor(ctx.anchor, ctx.destination);
  // EACH ROUND EXTENDS THE FENCE (100 → 200 → 300 MI, CAPPED).
  const max_mi = Math.min(MAX_SUGGEST_MI * (round + 1), 300);

  // THE DAY'S EXISTING PLACES — AND EVERYTHING ALREADY SHOWN — NEVER GET
  // RE-SUGGESTED.
  const used_ids = new Set<string>();
  const used_names = new Set<string>();
  for (const b of ctx.blocks) if (b.place?.place_id) used_ids.add(b.place.place_id);
  for (const id of more?.exclude?.ids ?? []) used_ids.add(id);
  for (const name of more?.exclude?.names ?? []) used_names.add(name.toLowerCase());

  const cards: SuggestionCard[] = [];
  for (const option of parsed.options.slice(0, 6)) {
    const query = option.search_query?.trim();
    if (!query) continue;
    const duration = Math.min(Math.max(Math.round(option.duration_min ?? 60), 30), 300);
    let start = snap_time(Math.round(option.start_min ?? ctx.gap?.from_min ?? 540));
    if (ctx.gap) {
      start = Math.min(Math.max(start, ctx.gap.from_min), Math.max(ctx.gap.to_min - duration, ctx.gap.from_min));
      start = snap_time(start);
    }
    start = Math.min(Math.max(start, 0), 1440 - duration);

    const place = await resolve_option(
      { ...option, search_query: query },
      ctx,
      anchor,
      used_ids,
      used_names,
      start,
      duration,
      max_mi,
    );
    if (!place) continue;
    cards.push({
      place,
      block_type: option.block_type === 'meal' ? 'meal' : 'activity',
      start_time: start,
      duration_min: duration,
      why: (option.reason ?? '').trim() || `Fits your ${weekday_long(ctx.day_date)}`,
      distance_mi:
        anchor && place.coords
          ? Math.round(haversine_mi(anchor, place.coords) * 10) / 10
          : undefined,
    });
  }
  return cards;
}
