import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapView } from '@/components/map_view';
import { FieldCard, Text, TextInput } from '@/components/text';
import { use_keyboard_reveal } from '@/components/use_keyboard_height';
import { fmt_duration, fmt_time, weekday_long } from '@/model/time';
import type { Block, BlockType, Day, Place, ShelfItem } from '@/model/types';
import { flight_lookup, normalize_flight_number } from '@/services/flight_lookup';
import { fmt_distance_mi, haversine_mi, type LngLat } from '@/services/geo';
import { check_hours } from '@/services/hours';
import { categories_for, type PlaceCategory } from '@/services/place_categories';
import {
  new_session_token,
  places_provider,
  type PlaceSuggestion,
} from '@/services/places_provider';
import { typical_duration_min } from '@/services/typical_duration';
import { color, hairline_width, radius, space } from '@/theme/tokens';

// THE SEARCH ANCHOR: BIAS PLACE RESULTS TOWARD WHERE THE TRAVELER ACTUALLY IS
// AROUND THIS BLOCK'S TIME — THE NEAREST-IN-TIME BLOCK ON THIS DAY THAT HAS
// COORDS. THIS IS WHAT MAKES "COFFEE" FIND SPOTS BY YOUR AFTERNOON STOP
// INSTEAD OF THE WRONG CITY. THE FULL FALLBACK CHAIN (COMPOSED BELOW):
// THIS DAY'S BLOCKS → TRIP DESTINATION → OTHER DAYS' BLOCKS → DEVICE LOCATION.
function nearest_anchor(
  blocks: Block[],
  start_time: number,
  exclude_id: string | undefined,
): LngLat | undefined {
  let best: { anchor: LngLat; gap: number } | null = null;
  for (const b of blocks) {
    if (b.id === exclude_id || !b.place?.coords) continue;
    const gap = Math.abs(b.start_time - start_time);
    if (!best || gap < best.gap) best = { anchor: b.place.coords, gap };
  }
  return best?.anchor;
}

// COORDS FROM THE DAY CLOSEST (BY INDEX) TO THE CURRENT ONE THAT HAS ANY
// PLACED BLOCK — TRIP CONTEXT FOR A DESTINATION-LESS TRIP.
function anchor_from_other_days(all_days: Day[], day_id: string): LngLat | undefined {
  const idx = all_days.findIndex((d) => d.id === day_id);
  const order = [...all_days.keys()].sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx));
  for (const i of order) {
    if (all_days[i].id === day_id) continue;
    for (const b of all_days[i].blocks) {
      if (b.place?.coords) return b.place.coords;
    }
  }
  return undefined;
}

const TYPE_OPTIONS: { type: BlockType; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { type: 'activity', label: 'Activity', icon: 'map-marker-outline' },
  { type: 'meal', label: 'Meal', icon: 'silverware-fork-knife' },
  { type: 'flight', label: 'Flight', icon: 'airplane' },
  { type: 'lodging', label: 'Stay', icon: 'bed-outline' },
  { type: 'note', label: 'Note', icon: 'note-text-outline' },
  // BUFFERS ARE DELIBERATE REST — THE PACING ENGINE COUNTS THEM AS DOWNTIME.
  { type: 'buffer', label: 'Buffer', icon: 'timer-sand' },
];

export interface ComposerResult {
  block_type: BlockType;
  title: string;
  start_time: number;
  duration_min: number;
  place?: Place;
  notes?: string;
  confirmation_number?: string;
  cost?: number;
  needs_booking?: boolean;
  is_locked: boolean;
}

interface ComposerProps {
  visible: boolean;
  // CHANGES ON EVERY OPEN SO THE FORM REMOUNTS WITH FRESH STATE (KEY-BASED
  // RESET INSTEAD OF SETSTATE-IN-EFFECT, PER REACT-HOOKS GUIDANCE).
  instance_key: number;
  day: Day;
  day_index: number;
  all_days: Day[];
  // THE TRIP'S CITY-CENTER COORDS — THE FALLBACK PROXIMITY ANCHOR FOR SEARCH.
  trip_anchor?: LngLat;
  // WHEN SET, THE COMPOSER IS IN EDIT MODE FOR THIS BLOCK.
  block?: Block;
  // WHEN SET, THE COMPOSER EDITS A SHELVED IDEA INSTEAD — SAME FORM, SAME
  // PLACE SEARCH; NO START TIME (IDEAS AREN'T SCHEDULED YET).
  shelf_item?: ShelfItem;
  default_start: number;
  on_close: () => void;
  on_submit: (result: ComposerResult) => void;
  on_shelve: (result: ComposerResult) => void;
  on_delete?: () => void;
  on_duplicate?: () => void;
  on_move_to_day?: (to_day_id: string) => void;
  // SHELF MODE: SCHEDULE THE IDEA ONTO THE CURRENT DAY.
  on_schedule?: () => void;
}

// THE BLOCK COMPOSER (MANUAL_ADD MOCKUP). EVERY LATER FEATURE — PARSING, AI
// SUGGESTIONS, GENERATION — ADDS BLOCKS THROUGH THIS SAME SHAPE OF INPUT (§3.3).
export function BlockComposer(props: ComposerProps) {
  return (
    // fade, NOT slide: THE SHEET SLIDES ITSELF UP (SEE sheet_ty) WHILE THE
    // DARK BACKDROP ONLY FADES — animationType="slide" DRAGGED THE BACKDROP
    // UP WITH THE SHEET, WHICH LOOKED BROKEN.
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.on_close}>
      <ComposerForm key={props.instance_key} {...props} />
    </Modal>
  );
}

function ComposerForm({
  day,
  day_index,
  all_days,
  trip_anchor,
  block,
  shelf_item,
  default_start,
  on_close,
  on_submit,
  on_shelve,
  on_delete,
  on_duplicate,
  on_move_to_day,
  on_schedule,
}: ComposerProps) {
  const insets = useSafeAreaInsets();
  const shelf_editing = shelf_item != null;
  const editing = block != null;

  const [block_type, set_block_type] = useState<BlockType>(
    block?.block_type ?? shelf_item?.block_type ?? 'activity',
  );
  // A FLIGHT TITLE THAT MATCHES THE AUTO FORMAT ("DL 1204 · JFK → BOS") ISN'T
  // TREATED AS HAND-TYPED — THE ROUTE FIELDS KEEP OWNING IT ON EDIT.
  const auto_flight_title_re = /^(?:[A-Z0-9]{2}\s?\d{1,4} · )?[A-Z]{3}\s*→\s*[A-Z]{3}$/;
  const [title, set_title] = useState(() => {
    const initial = block?.title ?? shelf_item?.title ?? '';
    return block?.block_type === 'flight' && auto_flight_title_re.test(initial) ? '' : initial;
  });
  const [start_time, set_start_time] = useState(block?.start_time ?? default_start);
  const [duration_min, set_duration_min] = useState(
    block ? block.end_time - block.start_time : (shelf_item?.typical_duration_min ?? 60),
  );
  // ONCE THE USER TOUCHES DURATION, PICKING A PLACE STOPS OVERWRITING IT.
  const [duration_touched, set_duration_touched] = useState(editing || shelf_editing);

  // PLACE SEARCH (§3.3.1): TYPE → DEBOUNCED SUGGESTIONS → TAP ATTACHES THE
  // FULL PLACE WITH COORDS/CATEGORY/HOURS VIA THE SWAPPABLE PROVIDER.
  const initial_place = block?.place ?? shelf_item?.place ?? null;
  const [place_query, set_place_query] = useState(initial_place?.name ?? '');
  const [place, set_place] = useState<Place | null>(initial_place);
  const [suggestions, set_suggestions] = useState<PlaceSuggestion[]>([]);
  // BROWSE-BY-INTENT STATE: A TAPPED CATEGORY CHIP LISTS NEARBY PLACES DIRECTLY.
  const [active_category, set_active_category] = useState<string | null>(null);
  const [browse_results, set_browse_results] = useState<Place[]>([]);
  const [browse_loading, set_browse_loading] = useState(false);
  const suggest_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggest_seq = useRef(0);
  const browse_seq = useRef(0);
  const session_ref = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (suggest_timer.current) clearTimeout(suggest_timer.current);
    },
    [],
  );

  // LAST-RESORT ANCHOR: THE DEVICE'S OWN LOCATION (ONLY REQUESTED WHEN THE
  // TRIP OFFERS NO CONTEXT AT ALL — SEE THE EFFECT BELOW).
  const [device_anchor, set_device_anchor] = useState<LngLat | null>(null);

  // WHERE SEARCH IS ANCHORED — RECOMPUTES AS THE START STEPPER MOVES SO BROWSE
  // TRACKS THE NEAREST STOP IN TIME. FALLBACK CHAIN: THIS DAY'S BLOCKS → TRIP
  // DESTINATION → OTHER DAYS' BLOCKS → DEVICE LOCATION.
  const search_anchor = useMemo(
    () =>
      nearest_anchor(day.blocks, start_time, block?.id) ??
      trip_anchor ??
      anchor_from_other_days(all_days, day.id) ??
      device_anchor ??
      undefined,
    [day.blocks, start_time, block?.id, trip_anchor, all_days, day.id, device_anchor],
  );

  useEffect(() => {
    if (search_anchor != null || device_anchor != null) return;
    let cancelled = false;
    (async () => {
      try {
        const Location = await import('expo-location');
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos =
          (await Location.getLastKnownPositionAsync()) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
        if (pos && !cancelled) {
          set_device_anchor({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
        // NATIVE MODULE OR PERMISSION UNAVAILABLE (E.G. A DEV CLIENT BUILT
        // BEFORE expo-location WAS ADDED) — SEARCH JUST RUNS UNANCHORED.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [search_anchor, device_anchor]);

  const browse_categories = categories_for(block_type);

  // SHELVED IDEAS PICK FROM THE IDEA-ISH TYPES ONLY — FLIGHTS AND STAYS ARE
  // BOOKINGS, NOT IDEAS.
  const type_options = shelf_editing
    ? TYPE_OPTIONS.filter((o) => o.type === 'activity' || o.type === 'meal' || o.type === 'note')
    : TYPE_OPTIONS;

  // KEYBOARD STORY (SHARED SHEET PATTERN — SEE use_keyboard_reveal): THE
  // SHEET NEVER MOVES; THE FIELD AREA GAINS SCROLL RANGE AND FOCUSED INPUTS
  // SLIDE JUST CLEAR OF THE KEYBOARD.
  const { keyboard_height, fields_ref, track_scroll, field_props } = use_keyboard_reveal();

  // ATTACH A RESOLVED PLACE FROM EITHER PATH (TEXT SUGGESTION OR BROWSE CARD),
  // CLEARING BOTH RESULT LISTS AND PREFILLING A TYPICAL DURATION. PICKING IS
  // THE END OF TYPING — PUT THE KEYBOARD AWAY SO THE RESULT IS VISIBLE.
  const attach_place = (resolved: Place) => {
    Keyboard.dismiss();
    set_place(resolved);
    set_place_query(resolved.name);
    set_suggestions([]);
    set_browse_results([]);
    set_active_category(null);
    if (!duration_touched) {
      set_duration_min(typical_duration_min(resolved.poi_category, block_type));
    }
  };

  // ONE-TAP CLEAR FOR THE PLACE FIELD — SWAPPING A LOADED PLACE SHOULDN'T
  // MEAN BACKSPACING THROUGH ITS WHOLE NAME.
  const clear_place = () => {
    set_place(null);
    set_place_query('');
    set_suggestions([]);
    set_browse_results([]);
    set_active_category(null);
  };

  const handle_place_query = (value: string) => {
    set_place_query(value);
    if (place && value !== place.name) set_place(null);
    // TYPING AND BROWSING ARE MUTUALLY EXCLUSIVE — A KEYSTROKE DROPS THE BROWSE.
    if (active_category) {
      set_active_category(null);
      set_browse_results([]);
    }
    if (suggest_timer.current) clearTimeout(suggest_timer.current);
    const q = value.trim();
    if (q.length < 2) {
      set_suggestions([]);
      return;
    }
    const seq = ++suggest_seq.current;
    suggest_timer.current = setTimeout(async () => {
      session_ref.current = session_ref.current ?? new_session_token();
      const results = await places_provider.suggest(q, session_ref.current, {
        proximity: search_anchor,
      });
      // STALE-RESPONSE GUARD: ONLY THE LATEST QUERY'S RESULTS RENDER.
      if (seq === suggest_seq.current) set_suggestions(results);
    }, 220);
  };

  // A PLACE PROVABLY CLOSED ON THIS WHOLE DAY ("MONDAYS MUSEUMS ARE CLOSED")
  // NEVER SHOWS IN BROWSE — WRONG *TIME* IS FINE (THE CONFLICT FIX HANDLES
  // IT), WRONG *DAY* ISN'T. UNKNOWN HOURS PASS THROUGH.
  const open_on_day = (p: Place): boolean => {
    const weekly = p.hours?.weekly;
    if (!weekly) return true;
    return (weekly[new Date(`${day.date}T12:00:00`).getDay()] ?? []).length > 0;
  };

  const toggle_category = async (cat: PlaceCategory) => {
    // BROWSING IS THE END OF TYPING — PUT THE KEYBOARD AWAY SO THE RESULT
    // LIST ISN'T HIDING BEHIND IT.
    Keyboard.dismiss();
    // TAP THE ACTIVE CHIP AGAIN TO COLLAPSE THE BROWSE.
    if (active_category === cat.id) {
      set_active_category(null);
      set_browse_results([]);
      return;
    }
    set_active_category(cat.id);
    set_suggestions([]);
    set_browse_loading(true);
    const seq = ++browse_seq.current;
    const results = await places_provider.category(cat.id, {
      proximity: search_anchor,
      limit: 8,
    });
    if (seq !== browse_seq.current) return;
    set_browse_results(results.filter(open_on_day));
    set_browse_loading(false);
  };

  const pick_suggestion = async (s: PlaceSuggestion) => {
    set_suggestions([]);
    set_place_query(s.name);
    const full = await places_provider.retrieve(s.suggestion_id, session_ref.current ?? '');
    // THE RETRIEVE ENDS THE BILLING SESSION; THE NEXT KEYSTROKE STARTS A NEW ONE.
    session_ref.current = null;
    attach_place(full ?? { name: s.name, address: s.address, poi_category: s.poi_category });
  };
  const [notes, set_notes] = useState(block?.notes ?? '');
  const [confirmation_number, set_confirmation_number] = useState(
    block?.booking?.confirmation_number ?? '',
  );
  // BUDGET LAYER (§4 TIER 2): FREE-FORM COST TEXT, PARSED ON SAVE.
  const [cost_text, set_cost_text] = useState(
    block?.cost != null ? String(block.cost) : '',
  );
  // "BOOK AHEAD" — RESERVATION-REQUIRED VENUES GET THE AMBER CHIP AND JOIN
  // THE NEEDS-BOOKING STORY (§4 TIER 2).
  const [needs_booking, set_needs_booking] = useState(
    block?.booking?.status === 'needs_booking',
  );
  // FLIGHT ROUTE AS SEPARATE FIELDS ("LAX" → "BOS") — AN EXISTING FLIGHT'S
  // TITLE ("DL 1204 · JFK → BOS") SEEDS THEM (AND THE NUMBER) BACK ON EDIT.
  const title_route = (block?.title ?? '').match(/([A-Z]{3})\s*→\s*([A-Z]{3})/);
  const title_flight_no = (block?.title ?? '').match(/^([A-Z0-9]{2}\s?\d{1,4})\b/);
  const [flight_from, set_flight_from] = useState(title_route?.[1] ?? '');
  const [flight_to, set_flight_to] = useState(title_route?.[2] ?? '');
  const [flight_query, set_flight_query] = useState(
    block?.block_type === 'flight' ? (title_flight_no?.[1] ?? '') : '',
  );
  const [lookup_state, set_lookup_state] = useState<'idle' | 'found' | 'missing'>('idle');

  const handle_flight_lookup = async () => {
    Keyboard.dismiss();
    const info = await flight_lookup.lookup(flight_query);
    if (!info) {
      set_lookup_state('missing');
      return;
    }
    set_lookup_state('found');
    set_flight_from(info.origin);
    set_flight_to(info.destination);
    set_start_time(info.departure_time);
    // OVERNIGHT ARRIVALS WRAP PAST MIDNIGHT; KEEP A SANE MINIMUM.
    set_duration_min(Math.max(30, (info.arrival_time - info.departure_time + 1440) % 1440));
  };

  // FLIGHTS TITLE THEMSELVES FROM NUMBER + ROUTE ("DL 1204 · LAX → BOS") —
  // A HAND-TYPED TITLE STILL WINS.
  const flight_route =
    flight_from.trim() && flight_to.trim()
      ? `${flight_from.trim().toUpperCase()} → ${flight_to.trim().toUpperCase()}`
      : '';
  const flight_auto_title =
    block_type === 'flight'
      ? [flight_query.trim() ? normalize_flight_number(flight_query) : '', flight_route]
          .filter((part) => part.length > 0)
          .join(' · ')
      : '';

  const is_anchor_type = block_type === 'flight' || block_type === 'lodging';
  // LOCKED ANCHORS (§2.2): ANY TIMED RESERVATION CAN PIN ITSELF IN PLACE —
  // FLIGHTS AND STAYS DEFAULT ON, EVERYTHING ELSE OFF; THE TOGGLE OVERRIDES.
  const [lock_override, set_lock_override] = useState<boolean | null>(null);
  const locked = lock_override ?? block?.is_locked ?? is_anchor_type;
  const resolved_title = title.trim() || flight_auto_title || (place?.name ?? place_query.trim());
  const can_submit = resolved_title.length > 0;

  // DRAG-TO-DISMISS: A DOWNWARD PAN ON THE SHEET HEADER SLIDES IT AWAY. PAST A
  // DISTANCE/VELOCITY THRESHOLD IT COMMITS TO CLOSING; OTHERWISE IT SPRINGS BACK.
  // STARTS OFF-SCREEN AND SLIDES UP ON MOUNT (THE MODAL ITSELF ONLY FADES).
  const sheet_ty = useSharedValue(900);
  useEffect(() => {
    sheet_ty.value = withTiming(0, { duration: 260 });
  }, [sheet_ty]);
  const sheet_style = useAnimatedStyle(() => ({ transform: [{ translateY: sheet_ty.value }] }));
  // THESE ASSIGNMENTS RUN INSIDE GESTURE WORKLETS AT EVENT TIME, NOT RENDER —
  // THE IMMUTABILITY LINT CAN'T SEE THAT.
  /* eslint-disable react-hooks/immutability */
  const dismiss_drag = Gesture.Pan()
    .onUpdate((e) => {
      sheet_ty.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 800) {
        sheet_ty.value = withTiming(900, { duration: 200 }, (done) => {
          if (done) runOnJS(on_close)();
        });
      } else {
        sheet_ty.value = withTiming(0, { duration: 160 });
      }
    });
  /* eslint-enable react-hooks/immutability */

  // LIVE FEASIBILITY PREVIEW: THE HINT UNDER THE PLACE FIELD RE-CHECKS HOURS
  // AS THE TIME STEPPERS MOVE, BEFORE THE BLOCK EVER LANDS ON THE TIMELINE.
  // SHELVED IDEAS HAVE NO SCHEDULED TIME YET, SO THERE'S NOTHING TO CHECK.
  const hours_verdict =
    place && !shelf_editing
      ? check_hours(place, day.date, start_time, start_time + duration_min)
      : null;

  const parsed_cost = Number.parseFloat(cost_text.replace(/[^0-9.]/g, ''));
  const build_result = (): ComposerResult => ({
    block_type,
    title: resolved_title,
    start_time,
    duration_min,
    // A FREE-TEXT PLACE NAME IS STILL A VALID PLACE — SEARCH IS OPTIONAL.
    place: place ?? (place_query.trim() ? { name: place_query.trim() } : undefined),
    notes: notes.trim() || undefined,
    confirmation_number: confirmation_number.trim() || undefined,
    cost: Number.isFinite(parsed_cost) && parsed_cost > 0 ? parsed_cost : undefined,
    needs_booking,
    is_locked: locked,
  });

  return (
    // RN Modal RENDERS OUTSIDE THE ROOT GestureHandlerRootView ON iOS, SO THE
    // SHEET NEEDS ITS OWN FOR THE DRAG-TO-DISMISS GESTURE TO REGISTER.
    <GestureHandlerRootView style={styles.backdrop_wrap}>
      <Pressable style={styles.backdrop} onPress={on_close} />
        {/* NO KEYBOARD AVOIDANCE — THE KEYBOARD OVERLAYS THE SHEET INSTEAD OF
            SHOVING/SQUEEZING IT (THE SHIFT GLITCHED ON iOS). THE SEARCH AND
            TITLE FIELDS SIT IN THE TOP HALF, SO TYPING STAYS VISIBLE. box-none
            KEEPS THE EMPTY AREA TAPPABLE AS BACKDROP. */}
        <View pointerEvents="box-none" style={styles.avoider}>
          <Animated.View style={[styles.sheet, sheet_style, { paddingBottom: insets.bottom + 16 }]}>
            <GestureDetector gesture={dismiss_drag}>
              {/* TAPPING THE HEADER (OR ANY NON-INPUT SPACE UP HERE) PUTS THE
                  KEYBOARD AWAY — DRAGGING IT STILL DISMISSES THE SHEET. */}
              <Pressable onPress={Keyboard.dismiss} style={styles.drag_header}>
                <View style={styles.handle} />
                <Text style={styles.sheet_title}>
                  {shelf_editing
                    ? 'Editing Shelved Idea'
                    : editing
                      ? 'Editing Block'
                      : `Create Block on ${weekday_long(day.date)}`}
                </Text>
                <Text style={styles.sheet_subtitle}>
                  {shelf_editing
                    ? 'Save it here, or drag its card onto the timeline'
                    : `Day ${day_index + 1}${day.theme_label ? ` · ${day.theme_label}` : ''}`}
                </Text>
              </Pressable>
            </GestureDetector>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.type_row}>
              {type_options.map((option) => {
                const selected = option.type === block_type;
                return (
                  <Pressable
                    key={option.type}
                    onPress={() => set_block_type(option.type)}
                    style={[styles.type_tile, selected && styles.type_tile_selected]}>
                    <MaterialCommunityIcons
                      name={option.icon}
                      size={16}
                      color={selected ? color.brand_text : color.ink_muted}
                    />
                    <Text style={[styles.type_label, selected && styles.type_label_selected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* NO SCROLL INDICATOR ANYWHERE — THE OVERLAY BAR SAT RIGHT ON THE
                CARDS' RIGHT BORDERS AND LOOKED BROKEN. KEYBOARD-HEIGHT BOTTOM
                PADDING (SEE reveal_focused ABOVE) IS WHAT KEEPS EVERY FOCUSED
                CARD REACHABLE ABOVE THE KEYBOARD. */}
            <ScrollView
              ref={fields_ref}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onScroll={track_scroll}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.fields_content,
                keyboard_height > 0 && { paddingBottom: keyboard_height + 24 },
              ]}
              style={styles.fields_scroll}>
            {block_type === 'flight' && (
              <FieldCard
                {...field_props('flight')}
                style={[styles.field_card, styles.place_card]}
                focus_style={styles.place_card_focused}>
                <View style={styles.place_eyebrow_row}>
                  <MaterialCommunityIcons name="airplane" size={11} color={color.ink_faint} />
                  <Text style={styles.field_eyebrow}>FLIGHT NUMBER · OPTIONAL</Text>
                </View>
                <View style={styles.place_input_row}>
                  <TextInput
                    style={[styles.field_input, { flex: 1, fontSize: 13 }]}
                    value={flight_query}
                    onChangeText={(v) => {
                      set_flight_query(v);
                      set_lookup_state('idle');
                    }}
                    placeholder="DL 1204"
                    placeholderTextColor={color.ink_faint}
                    autoCapitalize="characters"
                    onSubmitEditing={handle_flight_lookup}
                  />
                  <Pressable onPress={handle_flight_lookup} hitSlop={6}>
                    <Text style={styles.lookup_button}>Look up</Text>
                  </Pressable>
                </View>
                {lookup_state === 'found' && (
                  <Text style={styles.place_hint}>Times filled from the flight — adjust freely</Text>
                )}
                {lookup_state === 'missing' && (
                  <Text style={styles.lookup_miss}>Not found — set the times below by hand</Text>
                )}
                {lookup_state === 'idle' && (
                  <Text style={[styles.place_hint, { color: color.ink_faint }]}>
                    Times and route fill automatically
                  </Text>
                )}
              </FieldCard>
            )}

            {/* MANUAL ROUTE: SEPARATE FROM/TO AIRPORT FIELDS — THEY COMBINE
                INTO THE TITLE ("DL 1204 · LAX → BOS") UNLESS ONE IS TYPED. */}
            {block_type === 'flight' && (
              <View style={styles.time_row}>
                <FieldCard {...field_props('flight_from')} style={[styles.field_card, { flex: 1 }]}>
                  <Text style={styles.field_eyebrow}>FROM</Text>
                  <TextInput
                    style={styles.field_input}
                    value={flight_from}
                    onChangeText={set_flight_from}
                    placeholder="LAX"
                    placeholderTextColor={color.ink_faint}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={4}
                  />
                </FieldCard>
                <FieldCard {...field_props('flight_to')} style={[styles.field_card, { flex: 1 }]}>
                  <Text style={styles.field_eyebrow}>TO</Text>
                  <TextInput
                    style={styles.field_input}
                    value={flight_to}
                    onChangeText={set_flight_to}
                    placeholder="BOS"
                    placeholderTextColor={color.ink_faint}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={4}
                  />
                </FieldCard>
              </View>
            )}

            <FieldCard {...field_props('title')} style={styles.field_card}>
              <Text style={styles.field_eyebrow}>TITLE</Text>
              <TextInput
                style={styles.field_input}
                value={title}
                onChangeText={set_title}
                placeholder={
                  block_type === 'flight'
                    ? flight_auto_title || 'DL 1204 · LAX → BOS'
                    : (place?.name ?? (place_query.trim() || 'Dinner with Sarah'))
                }
                placeholderTextColor={color.ink_faint}
              />
            </FieldCard>

            {block_type !== 'flight' && block_type !== 'note' && block_type !== 'buffer' && (
              <FieldCard
                {...field_props('place')}
                style={[styles.field_card, styles.place_card]}
                focus_style={styles.place_card_focused}>
                <View style={styles.place_eyebrow_row}>
                  <MaterialCommunityIcons name="magnify" size={11} color={color.ink_faint} />
                  <Text style={styles.field_eyebrow}>PLACE · OPTIONAL</Text>
                </View>
                <View style={styles.place_input_row}>
                  <TextInput
                    style={[styles.field_input, { flex: 1, fontSize: 13 }]}
                    value={place_query}
                    onChangeText={handle_place_query}
                    placeholder="Search by name, or browse nearby below"
                    placeholderTextColor={color.ink_faint}
                  />
                  {place != null && (
                    <MaterialCommunityIcons name="check-circle-outline" size={18} color={color.anchor} />
                  )}
                  {(place != null || place_query.length > 0) && (
                    <Pressable onPress={clear_place} hitSlop={8}>
                      <MaterialCommunityIcons name="close-circle" size={18} color={color.ink_ghost} />
                    </Pressable>
                  )}
                </View>

                {/* BROWSE-BY-INTENT: TAP A CHIP TO LIST NEARBY PLACES OF THAT
                    KIND — "DINNER NEARBY" WITHOUT KNOWING A NAME. */}
                {place == null && browse_categories.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.browse_row}>
                    {browse_categories.map((cat) => {
                      const on = active_category === cat.id;
                      return (
                        <Pressable
                          key={cat.id}
                          onPress={() => toggle_category(cat)}
                          testID={`browse_${cat.id}`}
                          style={[styles.browse_chip, on && styles.browse_chip_on]}>
                          <MaterialCommunityIcons
                            name={cat.icon}
                            size={13}
                            color={on ? color.brand_text_strong : color.ink_muted}
                          />
                          <Text style={[styles.browse_chip_label, on && styles.browse_chip_label_on]}>
                            {cat.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}

                {suggestions.length > 0 && (
                  <View style={styles.suggest_list}>
                    {suggestions.map((s) => (
                      <Pressable
                        key={s.suggestion_id}
                        onPress={() => pick_suggestion(s)}
                        style={styles.suggest_row}>
                        <Text numberOfLines={1} style={styles.suggest_name}>
                          {s.name}
                        </Text>
                        {s.address != null && (
                          <Text numberOfLines={1} style={styles.suggest_addr}>
                            {s.address}
                          </Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                )}

                {active_category != null && (
                  <View style={styles.suggest_list} testID="browse_results">
                    {browse_loading && browse_results.length === 0 ? (
                      <Text style={[styles.place_hint, { color: color.ink_faint, marginTop: 0 }]}>
                        Finding places nearby…
                      </Text>
                    ) : browse_results.length === 0 ? (
                      <Text style={[styles.place_hint, { color: color.ink_faint, marginTop: 0 }]}>
                        Nothing nearby — try another category or search by name
                      </Text>
                    ) : (
                      browse_results.map((p, i) => {
                        const dist =
                          search_anchor && p.coords
                            ? fmt_distance_mi(haversine_mi(search_anchor, p.coords))
                            : null;
                        return (
                          <Pressable
                            key={p.place_id ?? `${p.name}_${i}`}
                            onPress={() => attach_place(p)}
                            style={styles.browse_result_row}>
                            <View style={{ flex: 1 }}>
                              <Text numberOfLines={1} style={styles.suggest_name}>
                                {p.name}
                              </Text>
                              {p.address != null && (
                                <Text numberOfLines={1} style={styles.suggest_addr}>
                                  {p.address}
                                </Text>
                              )}
                            </View>
                            {dist != null && <Text style={styles.browse_dist}>{dist}</Text>}
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                )}

                {place == null ? (
                  <Text style={[styles.place_hint, { color: color.ink_faint }]}>
                    Hours, map, and typical duration attach automatically
                  </Text>
                ) : hours_verdict == null || hours_verdict.status === 'unknown' ? (
                  <Text style={styles.place_hint}>{place.address ?? 'Place attached'}</Text>
                ) : hours_verdict.status === 'open' ? (
                  <Text style={styles.place_hint}>
                    {hours_verdict.label} on {weekday_long(day.date)}
                  </Text>
                ) : hours_verdict.status === 'ends_after_close' ? (
                  <Text style={styles.hint_warn}>{hours_verdict.label} — runs past close</Text>
                ) : (
                  <Text style={styles.hint_danger}>{hours_verdict.conflict}</Text>
                )}
                {/* THE MAP ATTACHES WITH THE PLACE — A SEARCHED PICK DROPS A
                    PIN IMMEDIATELY, BEFORE THE BLOCK EVER LANDS ON THE DAY. */}
                {place?.coords != null && (
                  <MapView
                    pins={[{ lat: place.coords.lat, lng: place.coords.lng }]}
                    style={styles.place_map}
                    test_id="composer_map"
                  />
                )}
              </FieldCard>
            )}

            <View style={styles.time_row}>
              {!shelf_editing && (
                <StepperField
                  eyebrow="STARTS"
                  value={fmt_time(start_time)}
                  on_minus={() => set_start_time((v) => Math.max(0, v - 15))}
                  on_plus={() => set_start_time((v) => Math.min(1440 - duration_min, v + 15))}
                />
              )}
              <StepperField
                eyebrow={shelf_editing ? 'TYPICAL DURATION' : 'DURATION'}
                value={fmt_duration(duration_min)}
                on_minus={() => {
                  set_duration_touched(true);
                  set_duration_min((v) => Math.max(30, v - 15));
                }}
                on_plus={() => {
                  set_duration_touched(true);
                  set_duration_min((v) => Math.min(shelf_editing ? 720 : 1440 - start_time, v + 15));
                }}
              />
            </View>

            {/* COST ON ITS OWN FULL-WIDTH ROW (BUDGET LAYER, §4 TIER 2).
                IDEAS HAVE NONE; NOTES AND BUFFERS HAVE NO PRICE. */}
            {!shelf_editing && block_type !== 'note' && block_type !== 'buffer' && (
              <FieldCard
                {...field_props('cost')}
                style={[styles.field_card, { marginTop: space.card_gap, marginBottom: 0 }]}>
                <Text style={styles.field_eyebrow}>COST · OPTIONAL</Text>
                <TextInput
                  style={styles.field_input}
                  value={cost_text}
                  onChangeText={set_cost_text}
                  placeholder="$0"
                  placeholderTextColor={color.ink_faint}
                  keyboardType="decimal-pad"
                />
              </FieldCard>
            )}

            {/* THE TOGGLE ROW: RESERVATION (AMBER, BOOKING SEMANTICS) AND
                LOCK (GREEN, ANCHOR SEMANTICS — DRAGS AND ONE-TAP FIXES FLOW
                AROUND A LOCKED BLOCK) SIDE BY SIDE AS MATCHING PILLS. */}
            {!shelf_editing && (
              <View style={[styles.time_row, { marginTop: space.card_gap }]}>
                {(block_type === 'meal' || block_type === 'activity') && (
                  <Pressable
                    onPress={() => set_needs_booking(!needs_booking)}
                    style={[styles.toggle_tile, needs_booking && styles.booking_toggle_on]}>
                    <MaterialCommunityIcons
                      name={needs_booking ? 'calendar-check' : 'calendar-clock-outline'}
                      size={15}
                      color={needs_booking ? color.meal_text : color.ink_muted}
                    />
                    <Text style={[styles.toggle_label, needs_booking && styles.booking_label_on]}>
                      Reservation
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => set_lock_override(!locked)}
                  style={[styles.toggle_tile, locked && styles.lock_toggle_on]}>
                  <MaterialCommunityIcons
                    name={locked ? 'lock' : 'lock-open-variant-outline'}
                    size={15}
                    color={locked ? color.anchor_text : color.ink_muted}
                  />
                  <Text style={[styles.toggle_label, locked && styles.lock_label_on]}>
                    Lock in Place
                  </Text>
                </Pressable>
              </View>
            )}

            {is_anchor_type && (
              <FieldCard {...field_props('confirmation')} style={[styles.field_card, { marginTop: space.card_gap }]}>
                <Text style={styles.field_eyebrow}>CONFIRMATION · OPTIONAL</Text>
                <TextInput
                  style={styles.field_input}
                  value={confirmation_number}
                  onChangeText={set_confirmation_number}
                  placeholder="GKX4LM"
                  placeholderTextColor={color.ink_faint}
                  autoCapitalize="characters"
                />
              </FieldCard>
            )}

            {!shelf_editing && (
              <FieldCard
                {...field_props('notes')}
                style={[styles.field_card, { marginTop: is_anchor_type ? 0 : space.card_gap }]}>
                <Text style={styles.field_eyebrow}>NOTES · OPTIONAL</Text>
                <TextInput
                  style={[styles.field_input, { minHeight: 34 }]}
                  value={notes}
                  onChangeText={set_notes}
                  placeholder="Write any notes you need to remember"
                  placeholderTextColor={color.ink_faint}
                  multiline
                />
              </FieldCard>
            )}

            {editing && all_days.length > 1 && on_move_to_day && (
              <View style={{ marginTop: 4 }}>
                <Text style={[styles.field_eyebrow, { marginBottom: 6 }]}>MOVE TO</Text>
                <View style={styles.move_row}>
                  {all_days.map((d, i) =>
                    d.id === day.id ? null : (
                      <Pressable key={d.id} onPress={() => on_move_to_day(d.id)} style={styles.move_chip}>
                        <Text style={styles.move_chip_label}>Day {i + 1}</Text>
                      </Pressable>
                    ),
                  )}
                </View>
              </View>
            )}
            </ScrollView>

            <Pressable
              disabled={!can_submit}
              onPress={() => on_submit(build_result())}
              style={[styles.cta, !can_submit && { opacity: 0.4 }]}>
              <Text style={styles.cta_label}>
                {shelf_editing ? 'Save idea' : editing ? 'Save changes' : 'Save to timeline'}
              </Text>
            </Pressable>

            {shelf_editing ? (
              <View style={styles.edit_actions}>
                {on_schedule && (
                  <Pressable onPress={on_schedule}>
                    <Text style={styles.edit_action}>Add to Day {day_index + 1}</Text>
                  </Pressable>
                )}
                {on_delete && (
                  <Pressable onPress={on_delete}>
                    <Text style={[styles.edit_action, { color: color.danger_text }]}>Delete</Text>
                  </Pressable>
                )}
              </View>
            ) : editing ? (
              <View style={styles.edit_actions}>
                {on_duplicate && (
                  <Pressable onPress={on_duplicate}>
                    <Text style={styles.edit_action}>Duplicate</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => on_shelve(build_result())}>
                  <Text style={styles.edit_action}>Shelve</Text>
                </Pressable>
                {on_delete && (
                  <Pressable onPress={on_delete}>
                    <Text style={[styles.edit_action, { color: color.danger_text }]}>Delete</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <Pressable
                disabled={!can_submit}
                onPress={() => on_shelve(build_result())}
                style={styles.shelve_row}>
                <MaterialCommunityIcons name="bookmark-outline" size={12} color={color.ink_muted} />
                <Text style={styles.shelve_label}>Or shelve it for later</Text>
              </Pressable>
            )}
        </Animated.View>
      </View>
    </GestureHandlerRootView>
  );
}

function StepperField({
  eyebrow,
  value,
  on_minus,
  on_plus,
}: {
  eyebrow: string;
  value: string;
  on_minus: () => void;
  on_plus: () => void;
}) {
  return (
    <View style={styles.stepper_card}>
      <Text style={styles.field_eyebrow}>{eyebrow}</Text>
      <View style={styles.stepper_row}>
        <Pressable onPress={on_minus} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-left" size={18} color={color.brand_text} />
        </Pressable>
        <Text style={styles.stepper_value}>{value}</Text>
        <Pressable onPress={on_plus} hitSlop={8}>
          <MaterialCommunityIcons name="chevron-right" size={18} color={color.brand_text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop_wrap: { flex: 1, justifyContent: 'flex-end' },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(44, 44, 42, 0.35)',
  },
  sheet: {
    backgroundColor: color.canvas,
    borderTopLeftRadius: radius.surface,
    borderTopRightRadius: radius.surface,
    paddingHorizontal: space.gutter,
    paddingTop: 12,
    maxHeight: '100%',
  },
  // THE DRAG-TO-DISMISS ZONE — GENEROUS PADDING SO THE WHOLE HEADER IS GRABBABLE.
  drag_header: { paddingBottom: 4 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.handle,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheet_title: { fontSize: 16, fontWeight: '500', color: color.ink },
  sheet_subtitle: { fontSize: 12, color: color.ink_muted, marginTop: 4 },

  type_row: { gap: 8, paddingVertical: 12 },
  type_tile: {
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.row,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    gap: 3,
  },
  type_tile_selected: { backgroundColor: color.brand_tint, borderColor: color.brand_border },
  type_label: { fontSize: 11, color: color.ink_muted },
  type_label_selected: { color: color.brand_text_strong, fontWeight: '500' },

  // flexShrink LETS THE KEYBOARD COMPRESS THE FIELD AREA (IT SCROLLS) WHILE
  // THE TITLE AND CTA STAY ON SCREEN.
  fields_scroll: { maxHeight: 430, flexGrow: 0, flexShrink: 1 },
  // BREATHING ROOM UNDER THE LAST CARD SO A FOCUSED FIELD SCROLLED INTO VIEW
  // SHOWS ITS FULL BORDER PLUS PADDING ABOVE THE KEYBOARD.
  fields_content: { paddingBottom: 20 },
  lookup_button: { fontSize: 13, fontWeight: '500', color: color.brand_text },
  lookup_miss: { fontSize: 11, color: color.meal_text, marginTop: 8 },
  field_card: {
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: space.card_gap,
  },
  field_eyebrow: { fontSize: 11, color: color.ink_faint, letterSpacing: 0.5 },
  field_input: { fontSize: 14, color: color.ink, marginTop: 3, paddingVertical: 0 },

  place_card: { borderColor: color.brand_border },
  // PLACE/FLIGHT CARDS ALREADY WEAR brand_border AT REST, SO FOCUS DEEPENS
  // THEM TO FULL BRAND.
  place_card_focused: { borderColor: color.brand },
  place_eyebrow_row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  place_input_row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  place_hint: { fontSize: 11, color: color.anchor, marginTop: 8 },
  place_map: { height: 118, borderRadius: 10, marginTop: 10 },
  hint_warn: { fontSize: 11, color: color.meal_text, marginTop: 8 },
  hint_danger: { fontSize: 11, color: color.danger_text, marginTop: 8 },

  browse_row: { gap: 6, paddingTop: 10, paddingRight: 4 },
  browse_chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: radius.chip,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    backgroundColor: color.canvas,
  },
  browse_chip_on: { backgroundColor: color.brand_tint, borderColor: color.brand_border },
  browse_chip_label: { fontSize: 12, color: color.ink_muted },
  browse_chip_label_on: { color: color.brand_text_strong, fontWeight: '500' },

  suggest_list: {
    marginTop: 8,
    borderTopWidth: hairline_width,
    borderTopColor: color.hairline,
  },
  suggest_row: {
    paddingVertical: 8,
    borderBottomWidth: hairline_width,
    borderBottomColor: color.hairline_soft,
  },
  browse_result_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: hairline_width,
    borderBottomColor: color.hairline_soft,
  },
  browse_dist: { fontSize: 11, color: color.ink_faint },
  suggest_name: { fontSize: 13, fontWeight: '500', color: color.ink },
  suggest_addr: { fontSize: 11, color: color.ink_muted, marginTop: 1 },

  time_row: { flexDirection: 'row', gap: space.card_gap },
  stepper_card: {
    flex: 1,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  stepper_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  stepper_value: { fontSize: 14, color: color.ink },

  // TOGGLE PILLS: RESERVATION WEARS THE AMBER FAMILY (§3.0 CHIPS), LOCK THE
  // GREEN ANCHOR FAMILY — SAME SHAPE, SEMANTIC COLOR ONLY WHEN ON.
  toggle_tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.card,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    backgroundColor: color.card_surface,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  toggle_label: { fontSize: 12, color: color.ink_muted },
  booking_toggle_on: { backgroundColor: color.meal_tint, borderColor: color.meal },
  booking_label_on: { color: color.meal_text, fontWeight: '500' },
  lock_toggle_on: { backgroundColor: color.anchor_tint, borderColor: color.anchor_pin },
  lock_label_on: { color: color.anchor_text, fontWeight: '500' },

  move_row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  move_chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.chip,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
  },
  move_chip_label: { fontSize: 12, color: color.ink_secondary },

  cta: {
    backgroundColor: color.brand,
    borderRadius: radius.cta,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 8,
  },
  cta_label: { fontSize: 15, fontWeight: '500', color: color.white },

  shelve_row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  shelve_label: { fontSize: 12, color: color.ink_muted },
  edit_actions: { flexDirection: 'row', justifyContent: 'center', gap: 28 },
  edit_action: { fontSize: 13, color: color.brand_text },
});
