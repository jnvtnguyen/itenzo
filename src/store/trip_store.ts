import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { add_days, days_between } from '@/model/time';
import type { Block, BlockType, Preferences, ShelfItem, Trip } from '@/model/types';

// THE BOSTON DEMO TRIP SEEDS ONLY WHEN EXPLICITLY REQUESTED (THE HEADLESS
// SUITE EXPORTS WITH EXPO_PUBLIC_SEED_DEMO=1) — REAL SESSIONS START EMPTY AND
// PERSIST THE USER'S OWN TRIPS INSTEAD. PERSISTENCE IS ALSO OFF IN SEED MODE
// SO EVERY SUITE PAGE LOAD RESETS TO THE FIXTURE.
const seed_demo = process.env.EXPO_PUBLIC_SEED_DEMO === '1';

let uid_counter = 0;
export function uid(prefix: string): string {
  uid_counter += 1;
  return `${prefix}_${Date.now().toString(36)}${uid_counter}`;
}

const UNDO_LIMIT = 50;

function clone_trips(trips: Trip[]): Trip[] {
  return JSON.parse(JSON.stringify(trips));
}

function sort_blocks(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => a.start_time - b.start_time);
}

export interface NewBlockInput {
  block_type: BlockType;
  title: string;
  start_time: number;
  duration_min: number;
  place?: Block['place'];
  notes?: string;
  is_locked?: boolean;
  booking?: Block['booking'];
  cost?: number;
}

interface TripStore {
  trips: Trip[];
  past: Trip[][];
  future: Trip[][];

  create_trip(input: {
    title: string;
    destination: string;
    anchor?: { lat: number; lng: number };
    start_date: string;
    end_date: string;
    travelers?: number;
    preferences?: Preferences;
  }): string;
  update_trip(
    trip_id: string,
    patch: Partial<Pick<Trip, 'title' | 'destination' | 'anchor' | 'travelers'>>,
  ): void;
  delete_trip(trip_id: string): void;
  add_block(trip_id: string, day_id: string, input: NewBlockInput): string;
  update_block(trip_id: string, day_id: string, block_id: string, patch: Partial<Block>): void;
  delete_block(trip_id: string, day_id: string, block_id: string): void;
  duplicate_block(trip_id: string, day_id: string, block_id: string): void;
  move_block_to_day(trip_id: string, from_day_id: string, block_id: string, to_day_id: string): void;
  set_block_time(trip_id: string, day_id: string, block_id: string, start_time: number, end_time: number): void;
  // COMMITS A DRAG THAT PUSHED NEIGHBORS AS ONE UNDOABLE MUTATION.
  set_day_times(
    trip_id: string,
    day_id: string,
    updates: { block_id: string; start_time: number; end_time: number }[],
  ): void;
  shelve_block(trip_id: string, day_id: string, block_id: string): void;
  schedule_shelf_item(
    trip_id: string,
    shelf_item_id: string,
    day_id: string,
    start_time: number,
    // NEIGHBORS PUSHED ASIDE BY THE DROP — APPLIED IN THE SAME UNDO STEP.
    push_updates?: { block_id: string; start_time: number; end_time: number }[],
  ): void;
  add_shelf_item(trip_id: string, item: Omit<ShelfItem, 'id'>): void;
  update_shelf_item(trip_id: string, shelf_item_id: string, patch: Partial<Omit<ShelfItem, 'id'>>): void;
  delete_shelf_item(trip_id: string, shelf_item_id: string): void;

  undo(): void;
  redo(): void;
}

// EVERY MUTATION SNAPSHOTS THE WHOLE TRIPS ARRAY (SMALL DATA, BIG SIMPLICITY WIN)
// SO UNDO/REDO COVERS ALL TIER 0 PRIMITIVES UNIFORMLY (PLAN.MD §4 0E).
function mutate(
  state: Pick<TripStore, 'trips' | 'past' | 'future'>,
  fn: (trips: Trip[]) => void,
): Pick<TripStore, 'trips' | 'past' | 'future'> {
  const next = clone_trips(state.trips);
  fn(next);
  // STAMP THE TRIPS THAT ACTUALLY CHANGED — LAST-WRITER-WINS FUEL FOR CLOUD
  // SYNC. THE STRINGIFY DIFF IS FINE AT THIS SCALE (A HANDFUL OF SMALL TRIPS).
  const prev_by_id = new Map(state.trips.map((t) => [t.id, JSON.stringify(t)]));
  for (const trip of next) {
    if (prev_by_id.get(trip.id) !== JSON.stringify(trip)) {
      trip.updated_at = new Date().toISOString();
    }
  }
  return {
    trips: next,
    past: [...state.past.slice(-UNDO_LIMIT + 1), state.trips],
    future: [],
  };
}

// TRIP-LEVEL OPS (CREATE / SETTINGS / DELETE) LIVE *OUTSIDE* THE UNDO
// TIMELINE — UNDO IS FOR ITINERARY EDITS. THE CHANGE APPLIES TO THE PRESENT
// AND TO EVERY PAST/FUTURE SNAPSHOT ALIKE, SO A LATER UNDO OF A BLOCK EDIT
// CAN NEVER DELETE A FRESHLY CREATED TRIP OR RESURRECT A DELETED ONE.
function mutate_everywhere(
  state: Pick<TripStore, 'trips' | 'past' | 'future'>,
  fn: (trips: Trip[]) => void,
): Pick<TripStore, 'trips' | 'past' | 'future'> {
  const apply = (trips: Trip[]) => {
    const next = clone_trips(trips);
    fn(next);
    return next;
  };
  const next = apply(state.trips);
  // STAMP ONLY THE PRESENT — SNAPSHOTS GET RESTAMPED IF UNDO RESTORES THEM.
  const prev_by_id = new Map(state.trips.map((t) => [t.id, JSON.stringify(t)]));
  for (const trip of next) {
    if (prev_by_id.get(trip.id) !== JSON.stringify(trip)) {
      trip.updated_at = new Date().toISOString();
    }
  }
  return {
    trips: next,
    past: state.past.map(apply),
    future: state.future.map(apply),
  };
}

function find_day(trips: Trip[], trip_id: string, day_id: string) {
  return trips.find((t) => t.id === trip_id)?.days.find((d) => d.id === day_id);
}

const store_definition: StateCreator<TripStore> = (set) => ({
  trips: [],
  past: [],
  future: [],

  create_trip(input) {
    // BUILT ONCE, OUTSIDE THE APPLY FN — DAY IDS MUST BE IDENTICAL IN EVERY
    // SNAPSHOT THE TRIP IS ADDED TO.
    const day_count = Math.max(1, days_between(input.start_date, input.end_date) + 1);
    const new_trip: Trip = {
      id: uid('trip'),
      title: input.title,
      destination: input.destination,
      anchor: input.anchor,
      start_date: input.start_date,
      end_date: input.end_date,
      travelers: input.travelers ?? 1,
      preferences: input.preferences,
      idea_shelf: [],
      days: Array.from({ length: day_count }, (_, i) => ({
        id: uid('day'),
        date: add_days(input.start_date, i),
        blocks: [],
      })),
    };
    set((state) =>
      mutate_everywhere(state, (trips) => {
        trips.push(clone_trips([new_trip])[0]);
      }),
    );
    return new_trip.id;
  },

  update_trip(trip_id, patch) {
    set((state) =>
      mutate_everywhere(state, (trips) => {
        const trip = trips.find((t) => t.id === trip_id);
        if (!trip) return;
        Object.assign(trip, patch);
      }),
    );
  },

  delete_trip(trip_id) {
    set((state) =>
      mutate_everywhere(state, (trips) => {
        const idx = trips.findIndex((t) => t.id === trip_id);
        if (idx >= 0) trips.splice(idx, 1);
      }),
    );
  },

  add_block(trip_id, day_id, input) {
    const block_id = uid('b');
    set((state) =>
      mutate(state, (trips) => {
        const day = find_day(trips, trip_id, day_id);
        if (!day) return;
        day.blocks = sort_blocks([
          ...day.blocks,
          {
            id: block_id,
            block_type: input.block_type,
            title: input.title,
            start_time: input.start_time,
            end_time: input.start_time + input.duration_min,
            place: input.place,
            notes: input.notes,
            booking: input.booking,
            cost: input.cost,
            source: 'manual',
            is_locked: input.is_locked ?? false,
            // A CONFIRMED BOOKING EARNS THE GREEN "BOOKED" CHIP (§3.0 STATUS CHIPS).
            meta: input.booking?.confirmation_number
              ? { chip: { label: 'Booked', kind: 'anchor' } }
              : undefined,
          },
        ]);
      }),
    );
    return block_id;
  },

  update_block(trip_id, day_id, block_id, patch) {
    set((state) =>
      mutate(state, (trips) => {
        const day = find_day(trips, trip_id, day_id);
        if (!day) return;
        day.blocks = sort_blocks(
          day.blocks.map((b) => (b.id === block_id ? { ...b, ...patch } : b)),
        );
      }),
    );
  },

  delete_block(trip_id, day_id, block_id) {
    set((state) =>
      mutate(state, (trips) => {
        const day = find_day(trips, trip_id, day_id);
        if (!day) return;
        day.blocks = day.blocks.filter((b) => b.id !== block_id);
      }),
    );
  },

  duplicate_block(trip_id, day_id, block_id) {
    set((state) =>
      mutate(state, (trips) => {
        const day = find_day(trips, trip_id, day_id);
        const source = day?.blocks.find((b) => b.id === block_id);
        if (!day || !source) return;
        const duration = source.end_time - source.start_time;
        day.blocks = sort_blocks([
          ...day.blocks,
          {
            ...source,
            id: uid('b'),
            start_time: source.end_time,
            end_time: source.end_time + duration,
            is_locked: false,
            booking: undefined,
            meta: undefined,
          },
        ]);
      }),
    );
  },

  move_block_to_day(trip_id, from_day_id, block_id, to_day_id) {
    set((state) =>
      mutate(state, (trips) => {
        const from = find_day(trips, trip_id, from_day_id);
        const to = find_day(trips, trip_id, to_day_id);
        const block = from?.blocks.find((b) => b.id === block_id);
        if (!from || !to || !block) return;
        from.blocks = from.blocks.filter((b) => b.id !== block_id);
        to.blocks = sort_blocks([...to.blocks, { ...block, meta: undefined }]);
      }),
    );
  },

  set_block_time(trip_id, day_id, block_id, start_time, end_time) {
    set((state) =>
      mutate(state, (trips) => {
        const day = find_day(trips, trip_id, day_id);
        if (!day) return;
        day.blocks = sort_blocks(
          day.blocks.map((b) => (b.id === block_id ? { ...b, start_time, end_time } : b)),
        );
      }),
    );
  },

  set_day_times(trip_id, day_id, updates) {
    set((state) =>
      mutate(state, (trips) => {
        const day = find_day(trips, trip_id, day_id);
        if (!day || updates.length === 0) return;
        const by_id = new Map(updates.map((u) => [u.block_id, u]));
        day.blocks = sort_blocks(
          day.blocks.map((b) => {
            const u = by_id.get(b.id);
            return u ? { ...b, start_time: u.start_time, end_time: u.end_time } : b;
          }),
        );
      }),
    );
  },

  shelve_block(trip_id, day_id, block_id) {
    set((state) =>
      mutate(state, (trips) => {
        const trip = trips.find((t) => t.id === trip_id);
        const day = trip?.days.find((d) => d.id === day_id);
        const block = day?.blocks.find((b) => b.id === block_id);
        if (!trip || !day || !block) return;
        day.blocks = day.blocks.filter((b) => b.id !== block_id);
        trip.idea_shelf.push({
          id: uid('shelf'),
          title: block.title,
          block_type: block.block_type,
          place: block.place,
          typical_duration_min: block.end_time - block.start_time,
        });
      }),
    );
  },

  schedule_shelf_item(trip_id, shelf_item_id, day_id, start_time, push_updates) {
    set((state) =>
      mutate(state, (trips) => {
        const trip = trips.find((t) => t.id === trip_id);
        const day = trip?.days.find((d) => d.id === day_id);
        const item = trip?.idea_shelf.find((s) => s.id === shelf_item_id);
        if (!trip || !day || !item) return;
        trip.idea_shelf = trip.idea_shelf.filter((s) => s.id !== shelf_item_id);
        const by_id = new Map((push_updates ?? []).map((u) => [u.block_id, u]));
        day.blocks = sort_blocks([
          ...day.blocks.map((b) => {
            const u = by_id.get(b.id);
            return u ? { ...b, start_time: u.start_time, end_time: u.end_time } : b;
          }),
          {
            id: uid('b'),
            block_type: item.block_type,
            title: item.title,
            start_time,
            end_time: start_time + (item.typical_duration_min ?? 60),
            place: item.place,
            source: 'manual',
            is_locked: false,
          },
        ]);
      }),
    );
  },

  add_shelf_item(trip_id, item) {
    set((state) =>
      mutate(state, (trips) => {
        const trip = trips.find((t) => t.id === trip_id);
        if (!trip) return;
        trip.idea_shelf.push({ ...item, id: uid('shelf') });
      }),
    );
  },

  update_shelf_item(trip_id, shelf_item_id, patch) {
    set((state) =>
      mutate(state, (trips) => {
        const trip = trips.find((t) => t.id === trip_id);
        if (!trip) return;
        trip.idea_shelf = trip.idea_shelf.map((s) =>
          s.id === shelf_item_id ? { ...s, ...patch } : s,
        );
      }),
    );
  },

  delete_shelf_item(trip_id, shelf_item_id) {
    set((state) =>
      mutate(state, (trips) => {
        const trip = trips.find((t) => t.id === trip_id);
        if (!trip) return;
        trip.idea_shelf = trip.idea_shelf.filter((s) => s.id !== shelf_item_id);
      }),
    );
  },

  undo() {
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        // RESTAMP: THE RESTORED SNAPSHOT IS NOW THE NEWEST TRUTH — WITHOUT
        // THIS, CLOUD SYNC'S LAST-WRITER-WINS WOULD RESURRECT THE UNDONE STATE.
        trips: restamp(previous),
        past: state.past.slice(0, -1),
        future: [state.trips, ...state.future],
      };
    });
  },

  redo() {
    set((state) => {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        trips: restamp(next),
        past: [...state.past, state.trips],
        future: rest,
      };
    });
  },
});

function restamp(trips: Trip[]): Trip[] {
  const now = new Date().toISOString();
  return trips.map((t) => ({ ...t, updated_at: now }));
}

// OFFLINE-FIRST PERSISTENCE (PLAN §7): THE TRIPS ARRAY SNAPSHOTS TO
// ASYNC-STORAGE (LOCALSTORAGE-BACKED ON WEB). EVERY CALL IS GUARDED SO A DEV
// CLIENT BUILT BEFORE THIS NATIVE MODULE EXISTED KEEPS WORKING IN-MEMORY
// INSTEAD OF CRASHING.
function make_storage(): StateStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const async_storage = require('@react-native-async-storage/async-storage')
      .default as typeof import('@react-native-async-storage/async-storage').default;
    return {
      async getItem(key: string) {
        try {
          return await async_storage.getItem(key);
        } catch {
          return null;
        }
      },
      async setItem(key: string, value: string) {
        try {
          await async_storage.setItem(key, value);
        } catch {}
      },
      async removeItem(key: string) {
        try {
          await async_storage.removeItem(key);
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

const storage = seed_demo ? null : make_storage();

export const use_trip_store = storage
  ? create<TripStore>()(
      persist(store_definition, {
        name: 'itenzo_trips_v1',
        storage: createJSONStorage(() => storage),
        // UNDO HISTORY IS SESSION-ONLY — ONLY THE TRIPS THEMSELVES PERSIST.
        partialize: (state) => ({ trips: state.trips }),
      }),
    )
  : create<TripStore>()(store_definition);

export function use_trip(trip_id: string): Trip | undefined {
  return use_trip_store((state) => state.trips.find((t) => t.id === trip_id));
}
