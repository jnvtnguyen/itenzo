// CORE ENTITIES FROM PLAN.MD §2.1. SNAKE_CASE FIELDS END-TO-END (§2.1.1) SO THE
// SAME NAMES FLOW INTO THE SUPABASE SCHEMA AND LLM STRUCTURED-OUTPUT SCHEMAS LATER.

export type BlockType =
  | 'flight'
  | 'lodging'
  | 'activity'
  | 'meal'
  | 'transit'
  | 'buffer'
  | 'note'
  | 'custom';

export type BlockSource = 'manual' | 'parsed_email' | 'ai_suggested' | 'imported';

export type TransitMode = 'walk' | 'drive' | 'transit' | 'rideshare';

// ONE CONTIGUOUS OPEN WINDOW, MINUTES SINCE MIDNIGHT.
export interface HoursWindow {
  open_min: number;
  close_min: number;
}

// STRUCTURED WEEKLY HOURS: INDEX 0 = SUNDAY … 6 = SATURDAY; AN EMPTY ARRAY
// MEANS CLOSED THAT DAY (THE "MONDAYS MUSEUMS ARE CLOSED" TRAP, PLAN §4.2).
export interface PlaceHours {
  weekly: HoursWindow[][];
}

export interface Place {
  place_id?: string;
  name: string;
  address?: string;
  coords?: { lat: number; lng: number };
  poi_category?: string;
  // STRUCTURED HOURS DRIVE THE FEASIBILITY CHECKS; hours_label REMAINS AS A
  // DISPLAY-ONLY FALLBACK FOR PLACES WITHOUT METADATA.
  hours?: PlaceHours;
  hours_label?: string;
}

export interface Booking {
  confirmation_number?: string;
  provider?: string;
  status?: 'booked' | 'needs_booking';
}

export interface TransitLeg {
  mode: TransitMode;
  duration_min: number;
  distance_mi?: number;
}

export type ChipKind = 'anchor' | 'meal' | 'danger' | 'neutral';

export interface Block {
  id: string;
  block_type: BlockType;
  title: string;
  // MINUTES SINCE MIDNIGHT, LOCAL TO THE TRIP DAY. END_TIME > START_TIME.
  start_time: number;
  end_time: number;
  place?: Place;
  booking?: Booking;
  source: BlockSource;
  // LOCKED BLOCKS (FLIGHTS, RESERVATIONS) ARE IMMOVABLE ANCHORS.
  is_locked: boolean;
  notes?: string;
  meta?: {
    transit_to_next?: TransitLeg;
    conflict?: string;
    chip?: { label: string; kind: ChipKind };
    // ONE-TAP CONFLICT RESOLUTION: THE START TIME THAT WOULD CLEAR THE
    // CONFLICT (DERIVED BY THE FEASIBILITY ENGINE, NEVER PERSISTED).
    fix?: { start_time: number };
  };
}

export interface Day {
  id: string;
  // ISO DATE, E.G. "2026-06-10".
  date: string;
  theme_label?: string;
  blocks: Block[];
}

export interface ShelfItem {
  id: string;
  title: string;
  block_type: BlockType;
  place?: Place;
  // SUGGESTED VISIT LENGTH USED WHEN THE ITEM IS DRAGGED ONTO THE TIMELINE.
  typical_duration_min?: number;
}

export interface Preferences {
  pace: 'relaxed' | 'balanced' | 'packed';
  budget_tier: 1 | 2 | 3;
  interests: string[];
}

export interface Trip {
  id: string;
  title: string;
  destination: string;
  // CITY-CENTER COORDS CAPTURED WHEN THE DESTINATION IS PICKED — THE DEFAULT
  // PROXIMITY ANCHOR FOR PLACE SEARCH SO "COFFEE" FINDS SPOTS IN *THIS* CITY.
  anchor?: { lat: number; lng: number };
  start_date: string;
  end_date: string;
  travelers: number;
  days: Day[];
  idea_shelf: ShelfItem[];
  preferences?: Preferences;
}
