import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back_button';
import { BlockComposer, type ComposerResult } from '@/components/block_composer';
import { BottomBar } from '@/components/bottom_bar';
import { DatePager } from '@/components/date_pager';
import { DayMap } from '@/components/day_map';
import { IdeaShelf } from '@/components/idea_shelf';
import { Text } from '@/components/text';
import { TimelineCanvas, resolve_push, type TimelineCanvasHandle } from '@/components/timeline_canvas';
import { DAY_MIN, MIN_BLOCK_MIN, PX_PER_MIN } from '@/components/timeline_metrics';
import { Wordmark } from '@/components/wordmark';
import { fmt_date_range, fmt_duration, snap_time } from '@/model/time';
import type { Block, BlockType, Day, ShelfItem } from '@/model/types';
import { decorate_day, resolve_fix_start } from '@/services/feasibility';
import { use_trip, use_trip_store } from '@/store/trip_store';
import { color, font, hairline_width, radius, space } from '@/theme/tokens';

const DEFAULT_DAY_START = 540;

function next_free_start(day: Day): number {
  const last = day.blocks[day.blocks.length - 1];
  if (!last) return DEFAULT_DAY_START;
  return Math.min(snap_time(last.end_time + 30), DAY_MIN - 60);
}

function walk_miles_of(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    const leg = b.meta?.transit_to_next;
    return leg?.mode === 'walk' && leg.distance_mi ? sum + leg.distance_mi : sum;
  }, 0);
}

type ComposerState =
  | { mode: 'add'; default_start: number }
  | { mode: 'edit'; block: Block }
  // A SHELVED IDEA EDITS IN THE SAME COMPOSER — SAME TYPES, SAME PLACE SEARCH.
  | { mode: 'shelf'; item: ShelfItem }
  | null;

export default function TripScreen() {
  const insets = useSafeAreaInsets();
  const { trip_id } = useLocalSearchParams<{ trip_id: string }>();
  const trip = use_trip(trip_id);

  const store = use_trip_store();
  const can_undo = use_trip_store((s) => s.past.length > 0);
  const can_redo = use_trip_store((s) => s.future.length > 0);

  const [selected_day_id, set_selected_day_id] = useState<string | null>(null);
  // TIMELINE ⇄ MAP TOGGLE (PLAN §UX DAY MAP VIEW).
  const [view_mode, set_view_mode] = useState<'timeline' | 'map'>('timeline');
  const [composer, set_composer] = useState<ComposerState>(null);
  // BUMPED ON EVERY OPEN SO THE COMPOSER FORM REMOUNTS WITH FRESH STATE.
  const [composer_seq, set_composer_seq] = useState(0);
  const [shelf_drag_item, set_shelf_drag_item] = useState<ShelfItem | null>(null);
  const [shelf_preview, set_shelf_preview] = useState<
    { start_time: number; duration_min: number; title: string; block_type: BlockType } | null
  >(null);

  const canvas_ref = useRef<TimelineCanvasHandle>(null);
  const ghost_x = useSharedValue(0);
  const ghost_y = useSharedValue(0);

  const ghost_style = useAnimatedStyle(() => ({
    transform: [{ translateX: ghost_x.value - 86 }, { translateY: ghost_y.value - 30 }],
  }));

  const move_ghost = (window_x: number, window_y: number) => {
    'worklet';
    ghost_x.value = window_x;
    ghost_y.value = window_y;
  };

  const open_composer = (state: ComposerState) => {
    set_composer_seq((s) => s + 1);
    set_composer(state);
  };

  const day = useMemo(() => {
    if (!trip) return undefined;
    return trip.days.find((d) => d.id === selected_day_id) ?? trip.days[0];
  }, [trip, selected_day_id]);

  // THE FEASIBILITY ENGINE RUNS AT DISPLAY TIME — TRANSIT LEGS, TIGHT-TRANSFER
  // CONFLICTS, AND HOURS CHECKS RE-DERIVE ON EVERY DRAG, RESIZE, OR UNDO WITH
  // ZERO STORED STATE (PLAN §4 TIER 1.1–1.3).
  const display_blocks = useMemo(() => (day ? decorate_day(day) : []), [day]);

  // START EACH DAY'S VIEW JUST ABOVE ITS FIRST BLOCK (OR AT 8 AM WHEN EMPTY).
  const day_id = day?.id;
  const first_start = day?.blocks[0]?.start_time ?? 480;
  useEffect(() => {
    // ALSO RE-RUNS WHEN THE MAP TOGGLE HANDS BACK TO THE (FRESHLY REMOUNTED)
    // TIMELINE, SO THE VIEW LANDS ON THE DAY'S FIRST BLOCK AGAIN.
    canvas_ref.current?.scroll_to_min(Math.max(0, first_start - 45));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day_id, view_mode]);

  if (!trip || !day) {
    return (
      <View style={[styles.missing, { paddingTop: insets.top + 40 }]}>
        <Text style={{ fontSize: 14, color: color.ink_muted }}>This trip has wandered off.</Text>
      </View>
    );
  }

  const day_index = trip.days.findIndex((d) => d.id === day.id);
  const walk_miles = walk_miles_of(display_blocks);

  const close_composer = () => set_composer(null);

  // ONE-TAP CONFLICT FIX: SHIFT THE BLOCK TO THE ENGINE'S SUGGESTED START,
  // PUSHING FOLLOWERS OUT OF THE WAY — SAME PRIMITIVE AS A DRAG, SO UNDO WORKS.
  const handle_fix_block = (block: Block) => {
    const fix = block.meta?.fix;
    if (!fix) return;
    const duration = block.end_time - block.start_time;
    // THE RAW SUGGESTION MAY ITSELF COLLIDE (LOCKED ANCHOR, MISSING TRANSIT,
    // STILL-CLOSED HOURS) — RESOLVE IT TO A GENUINELY FEASIBLE START FIRST.
    const start = resolve_fix_start(day, block, Math.min(fix.start_time, DAY_MIN - duration));
    const pushed = resolve_push(day.blocks, block.id, start, start + duration);
    const updates = [
      { block_id: block.id, start_time: start, end_time: start + duration },
      ...[...pushed.entries()].map(([block_id, [s, e]]) => ({
        block_id,
        start_time: s,
        end_time: e,
      })),
    ];
    store.set_day_times(trip.id, day.id, updates);
  };

  const handle_submit = (result: ComposerResult) => {
    const booking = result.confirmation_number
      ? { confirmation_number: result.confirmation_number, status: 'booked' as const }
      : undefined;
    if (composer?.mode === 'shelf') {
      store.update_shelf_item(trip.id, composer.item.id, {
        title: result.title,
        block_type: result.block_type,
        place: result.place,
        typical_duration_min: result.duration_min,
      });
      close_composer();
      return;
    }
    if (composer?.mode === 'edit') {
      const prior_meta = composer.block.meta;
      store.update_block(trip.id, day.id, composer.block.id, {
        block_type: result.block_type,
        title: result.title,
        start_time: result.start_time,
        end_time: result.start_time + result.duration_min,
        place: result.place ?? undefined,
        notes: result.notes,
        booking,
        // KEEP TRANSIT/CONFLICT META; ONLY THE BOOKED CHIP TRACKS THE BOOKING.
        meta: booking
          ? { ...prior_meta, chip: { label: 'Booked', kind: 'anchor' } }
          : prior_meta?.chip?.label === 'Booked'
            ? { ...prior_meta, chip: undefined }
            : prior_meta,
      });
    } else {
      store.add_block(trip.id, day.id, {
        block_type: result.block_type,
        title: result.title,
        start_time: result.start_time,
        duration_min: result.duration_min,
        place: result.place,
        notes: result.notes,
        booking,
        // FLIGHTS AND STAYS ENTER AS LOCKED ANCHORS (§2.2).
        is_locked: result.block_type === 'flight' || result.block_type === 'lodging',
      });
    }
    close_composer();
  };

  const handle_shelve = (result: ComposerResult) => {
    if (composer?.mode === 'edit') {
      store.shelve_block(trip.id, day.id, composer.block.id);
    } else {
      store.add_shelf_item(trip.id, {
        title: result.title,
        block_type: result.block_type,
        place: result.place,
        typical_duration_min: result.duration_min,
      });
    }
    close_composer();
  };

  const handle_shelf_hover = (window_y: number) => {
    const item = shelf_drag_item;
    if (!item) return;
    // THE DROP CARD TRACKS THE FINGER 1:1; THE SNAPPED TIME BELOW ONLY DRIVES
    // THE RAIL LABEL, PUSH PREVIEW, AND THE COMMITTED DROP.
    canvas_ref.current?.move_shelf_finger(window_y);
    const duration = Math.max(item.typical_duration_min ?? 60, MIN_BLOCK_MIN);
    // CENTER THE PREVIEW CARD UNDER THE FINGER — MAP THE CARD'S TOP EDGE, NOT
    // THE TOUCH POINT ITSELF, TO A TIME.
    const min = canvas_ref.current?.time_at_window_y(window_y, (duration * PX_PER_MIN) / 2);
    if (min == null) {
      if (shelf_preview) set_shelf_preview(null);
      return;
    }
    const start = Math.min(Math.max(min, 0), DAY_MIN - duration);
    if (shelf_preview?.start_time !== start || shelf_preview.duration_min !== duration) {
      set_shelf_preview({
        start_time: start,
        duration_min: duration,
        title: item.title,
        block_type: item.block_type,
      });
    }
  };

  const handle_shelf_drop = (window_x: number, window_y: number) => {
    const item = shelf_drag_item;
    set_shelf_drag_item(null);
    set_shelf_preview(null);
    if (!item) return;
    const duration = Math.max(item.typical_duration_min ?? 60, MIN_BLOCK_MIN);
    // SAME HALF-HEIGHT OFFSET AS THE HOVER PREVIEW SO THE DROP LANDS EXACTLY
    // WHERE THE PREVIEW SHOWED IT.
    const min = canvas_ref.current?.time_at_window_y(window_y, (duration * PX_PER_MIN) / 2);
    if (min == null) return;
    const start = Math.min(Math.max(min, 0), DAY_MIN - duration);
    // SAME PUSH TREATMENT AS A TIMELINE DRAG — NEIGHBORS MAKE ROOM FOR THE DROP.
    const pseudo = {
      id: '__shelf_drop__',
      block_type: item.block_type,
      title: item.title,
      start_time: start,
      end_time: start + duration,
      source: 'manual' as const,
      is_locked: false,
    };
    const pushed = resolve_push([...day.blocks, pseudo], pseudo.id, start, start + duration);
    const push_updates = [...pushed.entries()].map(([block_id, [s, e]]) => ({
      block_id,
      start_time: s,
      end_time: e,
    }));
    store.schedule_shelf_item(trip.id, item.id, day.id, start, push_updates);
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.header_row}>
          <BackButton />
          <Wordmark size={15} />
          <View style={{ flex: 1 }} />
          <Pressable onPress={store.undo} disabled={!can_undo} hitSlop={6}>
            <MaterialCommunityIcons
              name="arrow-u-left-top"
              size={18}
              color={can_undo ? color.ink_secondary : color.ink_ghost}
            />
          </Pressable>
          <Pressable onPress={store.redo} disabled={!can_redo} hitSlop={6}>
            <MaterialCommunityIcons
              name="arrow-u-right-top"
              size={18}
              color={can_redo ? color.ink_secondary : color.ink_ghost}
            />
          </Pressable>
        </View>
        <Text style={styles.trip_title}>{trip.title}</Text>
        <Text style={styles.trip_meta}>
          {fmt_date_range(trip.start_date, trip.end_date)} · {trip.travelers}{' '}
          {trip.travelers === 1 ? 'traveler' : 'travelers'}
        </Text>
      </View>

      <View style={{ paddingVertical: 12 }}>
        <DatePager days={trip.days} selected_day_id={day.id} on_select={set_selected_day_id} />
      </View>

      <View style={styles.day_header}>
        <Text style={styles.day_eyebrow}>
          Day {day_index + 1}
          {day.theme_label ? ` · ${day.theme_label}` : ''}
        </Text>
        <View style={styles.day_header_right}>
          {walk_miles > 0 && (
            <Text style={styles.walk_total}>{Math.round(walk_miles * 10) / 10} mi on foot</Text>
          )}
          <View style={styles.view_toggle}>
            {(['timeline', 'map'] as const).map((mode) => {
              const active = view_mode === mode;
              return (
                <Pressable
                  key={mode}
                  testID={`view_toggle_${mode}`}
                  onPress={() => set_view_mode(mode)}
                  hitSlop={4}
                  style={[styles.view_toggle_seg, active && styles.view_toggle_seg_active]}>
                  <MaterialCommunityIcons
                    name={mode === 'timeline' ? 'view-agenda-outline' : 'map-outline'}
                    size={13}
                    color={active ? color.brand_text_strong : color.ink_muted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {view_mode === 'map' ? (
        <DayMap
          blocks={display_blocks}
          on_edit_block={(block) => open_composer({ mode: 'edit', block })}
        />
      ) : (
        <TimelineCanvas
          ref={canvas_ref}
          // RAW BLOCKS — THE CANVAS RUNS THE FEASIBILITY DECORATION ITSELF SO
          // ITS DRAG PREVIEWS AND COMMITS SHARE ONE PIPELINE.
          blocks={day.blocks}
          day_date={day.date}
          shelf_preview={shelf_preview}
          on_edit_block={(block) => open_composer({ mode: 'edit', block })}
          on_fix_block={handle_fix_block}
          on_commit_times={(updates) => store.set_day_times(trip.id, day.id, updates)}
          on_fill_gap={(start_time) => open_composer({ mode: 'add', default_start: start_time })}
          on_add_first={() => open_composer({ mode: 'add', default_start: DEFAULT_DAY_START })}
          on_drag_state={() => {}}
        />
      )}

      {/* THE SHELF ONLY MAKES SENSE OVER THE TIMELINE — YOU CAN'T DRAG AN
          IDEA ONTO THE MAP. */}
      {view_mode === 'timeline' && (
        <IdeaShelf
          items={trip.idea_shelf}
          on_ghost_move={move_ghost}
          on_open={(item) => open_composer({ mode: 'shelf', item })}
          on_drag_start={set_shelf_drag_item}
          on_drag_hover={handle_shelf_hover}
          on_drag_end={handle_shelf_drop}
          on_drag_cancel={() => {
            set_shelf_drag_item(null);
            set_shelf_preview(null);
          }}
        />
      )}

      <BottomBar
        on_quick_add={() => open_composer({ mode: 'add', default_start: next_free_start(day) })}
      />

      {/* THE FINGER GHOST ONLY SHOWS OFF-CANVAS — ONCE THE TIMELINE PREVIEWS
          THE DROP AS A LIFTED BLOCK CARD, THE GHOST HANDS OVER TO IT. */}
      {shelf_drag_item != null && shelf_preview == null && (
        <Animated.View pointerEvents="none" style={[styles.ghost, ghost_style]}>
          <Text numberOfLines={1} style={styles.ghost_title}>
            {shelf_drag_item.title}
          </Text>
          <Text style={styles.ghost_meta}>
            ~{fmt_duration(shelf_drag_item.typical_duration_min ?? 60)} · drop on the timeline
          </Text>
        </Animated.View>
      )}

      <BlockComposer
        visible={composer != null}
        instance_key={composer_seq}
        day={day}
        day_index={day_index}
        all_days={trip.days}
        trip_anchor={trip.anchor}
        block={composer?.mode === 'edit' ? composer.block : undefined}
        shelf_item={composer?.mode === 'shelf' ? composer.item : undefined}
        default_start={composer?.mode === 'add' ? composer.default_start : DEFAULT_DAY_START}
        on_close={close_composer}
        on_submit={handle_submit}
        on_shelve={handle_shelve}
        on_delete={
          composer?.mode === 'edit'
            ? () => {
                store.delete_block(trip.id, day.id, composer.block.id);
                close_composer();
              }
            : composer?.mode === 'shelf'
              ? () => {
                  store.delete_shelf_item(trip.id, composer.item.id);
                  close_composer();
                }
              : undefined
        }
        on_duplicate={
          composer?.mode === 'edit'
            ? () => {
                store.duplicate_block(trip.id, day.id, composer.block.id);
                close_composer();
              }
            : undefined
        }
        on_move_to_day={
          composer?.mode === 'edit'
            ? (to_day_id) => {
                store.move_block_to_day(trip.id, day.id, composer.block.id, to_day_id);
                close_composer();
              }
            : undefined
        }
        on_schedule={
          composer?.mode === 'shelf'
            ? () => {
                store.schedule_shelf_item(trip.id, composer.item.id, day.id, next_free_start(day));
                close_composer();
              }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  missing: { flex: 1, alignItems: 'center', backgroundColor: color.canvas },
  header: { paddingHorizontal: space.gutter },
  header_row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trip_title: { fontFamily: font.serif, fontSize: 24, color: color.ink, marginTop: 14 },
  trip_meta: { fontSize: 12, color: color.ink_muted, marginTop: 2 },

  day_header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.gutter,
    paddingBottom: 6,
  },
  day_eyebrow: {
    fontSize: 11,
    color: color.brand_text_strong,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  walk_total: { fontSize: 11, color: color.ink_muted },
  day_header_right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  view_toggle: {
    flexDirection: 'row',
    borderRadius: radius.chip,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    backgroundColor: color.card_surface,
    overflow: 'hidden',
  },
  view_toggle_seg: { paddingVertical: 4, paddingHorizontal: 9 },
  view_toggle_seg_active: { backgroundColor: color.brand_tint },

  ghost: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 172,
    backgroundColor: color.brand_tint,
    borderWidth: hairline_width,
    borderColor: color.brand_border,
    borderRadius: radius.card,
    paddingVertical: 10,
    paddingHorizontal: 12,
    zIndex: 100,
    elevation: 100,
    transform: [{ rotate: '-1.2deg' }],
  },
  ghost_title: { fontSize: 13, fontWeight: '500', color: color.brand_text_strong },
  ghost_meta: { fontSize: 10, color: color.brand_text, marginTop: 2 },
});
