import type { Place } from '@/model/types';
import { haversine_mi, type LngLat } from '@/services/geo';
import { local_catalog } from '@/services/local_places';
import { parse_open_hours, type MapboxOpenHours } from '@/services/open_hours';
import { categories_for } from '@/services/place_categories';

// SWAPPABLE PLACES PROVIDER (PLAN.MD §7). PRIMARY: MAPBOX SEARCH BOX API —
// /SUGGEST WHILE TYPING, /RETRIEVE ON SELECTION, /CATEGORY FOR BROWSE-BY-INTENT
// ("DINNER NEARBY"), PLUS FORWARD GEOCODING FOR THE TRIP DESTINATION. EVERY
// LOOKUP IS BIASED BY A PROXIMITY ANCHOR SO RESULTS TRACK THE TRIP'S CITY, NOT
// A HARDCODED ONE. WITHOUT A TOKEN, AN OFFLINE CATALOG KEEPS THE FLOW WORKING.

export interface PlaceSuggestion {
  suggestion_id: string;
  name: string;
  address?: string;
  poi_category?: string;
}

export interface CityResult {
  // SHORT NAME FOR TITLES ("San Francisco").
  name: string;
  // FULL DISAMBIGUATED LABEL FOR THE DESTINATION FIELD AND SUGGESTION ROWS
  // ("San Francisco, California, United States").
  full_name: string;
  coords: LngLat;
}

export interface SearchOpts {
  // BIAS RESULTS TOWARD THIS POINT (THE TRIP / DAY ANCHOR).
  proximity?: LngLat;
}

export interface PlacesProvider {
  suggest(query: string, session_token: string, opts?: SearchOpts): Promise<PlaceSuggestion[]>;
  retrieve(suggestion_id: string, session_token: string): Promise<Place | null>;
  // BROWSE A CANONICAL CATEGORY NEAR THE ANCHOR — RETURNS FULL PLACES DIRECTLY
  // (NO RETRIEVE STEP), NEAREST FIRST.
  category(canonical_id: string, opts?: SearchOpts & { limit?: number }): Promise<Place[]>;
  // FORWARD-GEOCODE A CITY/REGION FOR THE DESTINATION FIELD.
  search_cities(query: string): Promise<CityResult[]>;
}

const SEARCHBOX = 'https://api.mapbox.com/search/searchbox/v1';
const GEOCODE = 'https://api.mapbox.com/search/geocode/v6';

function prox_param(opts?: SearchOpts): string {
  return opts?.proximity ? `&proximity=${opts.proximity.lng},${opts.proximity.lat}` : '';
}

// RETRIEVE/CATEGORY REQUEST THE `visit` ATTRIBUTE SET, WHICH CARRIES
// STRUCTURED OPENING HOURS — THE FUEL FOR THE HOURS FEASIBILITY CHECKS.
const ATTRIBUTE_SETS = '&attribute_sets=basic,visit';

interface SearchboxFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mapbox_id?: string;
    name?: string;
    full_address?: string;
    place_formatted?: string;
    poi_category?: string[];
    metadata?: { open_hours?: MapboxOpenHours };
  };
}

function feature_to_place(f: SearchboxFeature): Place | null {
  if (!f.properties?.name) return null;
  const [lng, lat] = f.geometry?.coordinates ?? [undefined, undefined];
  return {
    place_id: f.properties.mapbox_id,
    name: f.properties.name,
    address: f.properties.full_address ?? f.properties.place_formatted,
    coords: lat != null && lng != null ? { lat, lng } : undefined,
    poi_category: f.properties.poi_category?.[0],
    hours: parse_open_hours(f.properties.metadata?.open_hours),
  };
}

class MapboxPlacesProvider implements PlacesProvider {
  constructor(private token: string) {}

  async suggest(query: string, session_token: string, opts?: SearchOpts): Promise<PlaceSuggestion[]> {
    const url =
      `${SEARCHBOX}/suggest?q=${encodeURIComponent(query)}` +
      `&access_token=${this.token}&session_token=${session_token}` +
      `&limit=6&types=poi${prox_param(opts)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      suggestions?: {
        mapbox_id: string;
        name: string;
        full_address?: string;
        place_formatted?: string;
        poi_category?: string[];
      }[];
    };
    return (data.suggestions ?? []).map((s) => ({
      suggestion_id: s.mapbox_id,
      name: s.name,
      address: s.full_address ?? s.place_formatted,
      poi_category: s.poi_category?.[0],
    }));
  }

  async retrieve(suggestion_id: string, session_token: string): Promise<Place | null> {
    const url =
      `${SEARCHBOX}/retrieve/${encodeURIComponent(suggestion_id)}` +
      `?access_token=${this.token}&session_token=${session_token}${ATTRIBUTE_SETS}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: SearchboxFeature[] };
    return data.features?.[0] ? feature_to_place(data.features[0]) : null;
  }

  async category(canonical_id: string, opts?: SearchOpts & { limit?: number }): Promise<Place[]> {
    const url =
      `${SEARCHBOX}/category/${encodeURIComponent(canonical_id)}` +
      `?access_token=${this.token}&limit=${opts?.limit ?? 8}${prox_param(opts)}${ATTRIBUTE_SETS}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: SearchboxFeature[] };
    const places = (data.features ?? []).map(feature_to_place).filter((p): p is Place => p != null);
    return sort_by_proximity(places, opts?.proximity);
  }

  async search_cities(query: string): Promise<CityResult[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const url =
      `${GEOCODE}/forward?q=${encodeURIComponent(q)}` +
      `&access_token=${this.token}&limit=5&types=place,locality,region,district`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      features?: { properties?: { name?: string; full_address?: string; place_formatted?: string; coordinates?: { longitude: number; latitude: number } }; geometry?: { coordinates?: [number, number] } }[];
    };
    return (data.features ?? [])
      .map((f) => {
        const name = f.properties?.name;
        const full_name =
          f.properties?.full_address ??
          (name && f.properties?.place_formatted ? `${name}, ${f.properties.place_formatted}` : name);
        const c = f.properties?.coordinates;
        const geo = f.geometry?.coordinates;
        const coords = c
          ? { lat: c.latitude, lng: c.longitude }
          : geo
            ? { lat: geo[1], lng: geo[0] }
            : null;
        return name && full_name && coords ? { name, full_name, coords } : null;
      })
      .filter((r): r is CityResult => r != null);
  }
}

function sort_by_proximity(places: Place[], anchor?: LngLat): Place[] {
  if (!anchor) return places;
  return [...places].sort((a, b) => {
    const da = a.coords ? haversine_mi(anchor, a.coords) : Infinity;
    const db = b.coords ? haversine_mi(anchor, b.coords) : Infinity;
    return da - db;
  });
}

// OFFLINE FALLBACK OVER THE BUNDLED BOSTON CATALOG — KEEPS THE WHOLE FLOW
// (SUGGEST, BROWSE, CITY LOOKUP) WORKING WITH NO TOKEN AND FULLY DETERMINISTIC.
class LocalPlacesProvider implements PlacesProvider {
  async suggest(query: string, _session: string, opts?: SearchOpts): Promise<PlaceSuggestion[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits = local_catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.poi_category ?? '').includes(q) ||
        (p.address ?? '').toLowerCase().includes(q),
    );
    return sort_by_proximity(hits, opts?.proximity)
      .slice(0, 5)
      .map((p) => ({
        suggestion_id: p.place_id!,
        name: p.name,
        address: p.address,
        poi_category: p.poi_category,
      }));
  }

  async retrieve(suggestion_id: string): Promise<Place | null> {
    return local_catalog.find((p) => p.place_id === suggestion_id) ?? null;
  }

  async category(canonical_id: string, opts?: SearchOpts & { limit?: number }): Promise<Place[]> {
    // MAP THE MAPBOX CANONICAL ID BACK TO CATALOG poi_category SUBSTRINGS VIA
    // THE SAME TABLE THE CHIPS USE.
    const all = [...categories_for('meal'), ...categories_for('activity')];
    const match = all.find((c) => c.id === canonical_id)?.local_match ?? [canonical_id];
    const hits = local_catalog.filter((p) =>
      match.some((m) => (p.poi_category ?? '').includes(m)),
    );
    return sort_by_proximity(hits, opts?.proximity).slice(0, opts?.limit ?? 8);
  }

  async search_cities(query: string): Promise<CityResult[]> {
    // THE OFFLINE CATALOG IS BOSTON-ONLY; RECOGNIZE IT SO THE DEMO/TESTS ANCHOR
    // CORRECTLY WITHOUT A NETWORK CALL.
    if (/bost|mass|cambridge|new england/i.test(query)) {
      return [
        {
          name: 'Boston',
          full_name: 'Boston, Massachusetts, United States',
          coords: { lat: 42.3601, lng: -71.0589 },
        },
      ];
    }
    return [];
  }
}

const mapbox_token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

export const places_provider: PlacesProvider = mapbox_token
  ? new MapboxPlacesProvider(mapbox_token)
  : new LocalPlacesProvider();

// TRUE WHEN LIVE MAPBOX SEARCH IS ACTIVE — LETS THE UI SOFTEN COPY (E.G. HIDE
// THE "BOSTON DEMO CATALOG" HINT) WHEN REAL, ANYWHERE-IN-THE-WORLD SEARCH IS ON.
export const places_are_live = mapbox_token != null;

// ONE TOKEN PER COMPOSER SESSION SO A SUGGEST→RETRIEVE FLOW BILLS AS A SINGLE
// MAPBOX SEARCH SESSION.
export function new_session_token(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
