// REANIMATED SHARED-VALUE WRITES IN THIS FILE ALL HAPPEN INSIDE GESTURE
// CALLBACKS AND WORKLET HELPERS — EVENT TIME, NOT RENDER — WHICH THE
// IMMUTABILITY LINT CANNOT SEE THROUGH.
/* eslint-disable react-hooks/immutability */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { StatusChip } from '@/components/chip';
import { RollingText } from '@/components/rolling_text';
import { Text } from '@/components/text';
import { CARD_LEFT, CARD_RIGHT, CONFLICT_MIN_PX, DAY_MIN, MIN_BLOCK_MIN, PX_PER_MIN } from '@/components/timeline_metrics';
import { fmt_time, fmt_time_range } from '@/model/time';
import type { Block } from '@/model/types';
import { block_edge_color, color, hairline_width, radius } from '@/theme/tokens';

const SNAP_MIN = 15;
const LONG_PRESS_MS = 200;
// NATIVE RESIZE NEEDS ITS OWN SHORT HOLD BEFORE THE PULL ENGAGES — WITHOUT
// IT, SCROLL SWIPES THAT HAPPEN TO START ON A GRIP RANDOMLY RESIZED BLOCKS.
const RESIZE_HOLD_MS = 160;
const MIN_DURATION = MIN_BLOCK_MIN;

// HEIGHT BREAKPOINTS FOR CONTENT DENSITY — SHORT BLOCKS COLLAPSE TO ONE LINE
// THE WAY CALENDAR EVENTS DO.
const COMPACT_PX = 46;
const MEDIUM_PX = 86;

// PIECEWISE-LINEAR Y→MINUTE MAPPING OVER THE COMPRESSED LAYOUT'S BREAKPOINTS.
function y_to_min(y: number, ys: number[], mins: number[]): number {
  'worklet';
  if (ys.length === 0) return 0;
  if (y <= ys[0]) return mins[0];
  for (let i = 1; i < ys.length; i++) {
    if (y <= ys[i]) {
      const span = ys[i] - ys[i - 1];
      if (span <= 0) return mins[i];
      const t = (y - ys[i - 1]) / span;
      return mins[i - 1] + t * (mins[i] - mins[i - 1]);
    }
  }
  return mins[mins.length - 1];
}

export function BlockCard({
  block,
  top,
  height,
  // PUSH PREVIEW (PIXELS) WHILE A SIBLING IS BEING DRAGGED THROUGH THIS BLOCK.
  offset_px,
  // PUSH PREVIEW (MINUTES): THE START THIS BLOCK WOULD GET IF THE ACTIVE DRAG
  // DROPPED NOW — ITS TIME TEXT FOLLOWS LIVE, JUST LIKE THE DRAGGED BLOCK'S.
  pushed_start,
  // LIVE FEASIBILITY VERDICT FOR THE SPOT CURRENTLY UNDER THE DRAG — WARNS
  // "THIS WILL CONFLICT" BEFORE THE DROP; THE FIX PILL ONLY APPEARS AFTER.
  preview_conflict,
  // THE HEIGHT THE PREVIEW LAYOUT RESERVED FOR THIS CARD AT THE HOVERED SPOT.
  preview_height,
  // THE TOP THE PREVIEW LAYOUT RESERVED — THE RELEASE GLIDE TARGET.
  preview_top,
  // RESIZE CANNOT GROW PAST THE NEXT LOCKED ANCHOR.
  max_end,
  // LOCKED SPANS: A DRAG MAY HOP OVER THEM BUT NEVER LAND OVERLAPPING ONE.
  locked_starts,
  locked_ends,
  min_top_px,
  max_top_px,
  map_ys,
  map_mins,
  on_press,
  on_fix,
  on_preview,
  on_drop,
  on_drag_state,
  on_drag_edge,
  drag_scroll,
}: {
  block: Block;
  top: number;
  height: number;
  offset_px: number;
  pushed_start: number | null;
  preview_conflict: string | null;
  preview_height: number | null;
  preview_top: number | null;
  max_end: number;
  locked_starts: number[];
  locked_ends: number[];
  min_top_px: number;
  max_top_px: number;
  map_ys: number[];
  map_mins: number[];
  on_press: () => void;
  // ONE-TAP CONFLICT RESOLUTION (FEASIBILITY ENGINE); ABSENT WHEN NO FIX EXISTS.
  on_fix?: () => void;
  on_preview: (start_time: number, end_time: number) => void;
  on_drop: (start_time: number, end_time: number) => void;
  on_drag_state: (active: boolean) => void;
  // EDGE AUTO-SCROLL: REPORTS THE FINGER'S WINDOW Y; THE CANVAS SCROLLS AND
  // FEEDS THE ACCUMULATED OFFSET BACK THROUGH drag_scroll.
  on_drag_edge: (window_y: number) => void;
  drag_scroll: SharedValue<number>;
}) {
  const duration = block.end_time - block.start_time;
  const conflict = block.meta?.conflict;
  // ONLY CONFLICTED BLOCKS CARRY A HEIGHT FLOOR (MATCHES compute_layout).
  const floor_px = conflict != null ? CONFLICT_MIN_PX : 0;

  const [dragging, set_dragging] = useState(false);
  const [resizing, set_resizing] = useState(false);
  // TRUE ONCE THE LONG-PRESS MATURES — THE CARD LIFTS *BEFORE* ANY MOVEMENT SO
  // YOU CAN SEE THE DRAG IS ARMED.
  const [lift_ready, set_lift_ready] = useState(false);
  const [preview_start, set_preview_start] = useState<number | null>(null);
  const [preview_duration, set_preview_duration] = useState<number | null>(null);

  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);
  const snapped_start = useSharedValue(block.start_time);
  const snapped_duration = useSharedValue(duration);

  // ONE POSITION/SIZE AUTHORITY. THE CARD'S SLOT IS ALWAYS ITS CURRENT
  // BEST-KNOWN TARGET — THE PREVIEW SLOT WHILE THIS CARD IS BEING
  // DRAGGED/RESIZED, THE (POSSIBLY PUSH-OFFSET) LAYOUT SLOT OTHERWISE — AND
  // anim_top/anim_h SIMPLY GLIDE TOWARD IT. GESTURES LAYER A FINGER
  // TRANSLATION (ty) ON TOP OR DRIVE THE HEIGHT DIRECTLY, AND RELEASE ABSORBS
  // + RE-TARGETS ON THE UI THREAD *UNCONDITIONALLY*. NOTHING WAITS FOR A PROP
  // TO CHANGE: COMPRESSED-GAP LAYOUTS CAN COMMIT AN HOURS-BIG TIME MOVE WITH
  // AN IDENTICAL PIXEL TOP, AND THE OLD ABSORB-ON-CHANGE MODEL MAROONED THE
  // CARD (STALE ty) AWAY FROM ITS RAIL LABEL AND TRANSIT CONNECTOR THERE.
  const slot_top = preview_top ?? top + offset_px;
  const slot_h = preview_height ?? height;
  const slot_top_sv = useSharedValue(slot_top);
  const slot_h_sv = useSharedValue(slot_h);
  const anim_top = useSharedValue(slot_top);
  const anim_h = useSharedValue(slot_h);
  useLayoutEffect(() => {
    slot_top_sv.value = slot_top;
    slot_h_sv.value = slot_h;
    // AN ACTIVE RESIZE OWNS THE HEIGHT; AN ACTIVE MOVE OWNS THE POSITION (THE
    // CARD RIDES THE FINGER) WHILE ITS HEIGHT STILL TRACKS THE SLOT LIVE, SO
    // CONFLICT FLOORS GROW/SHRINK UNDER THE FINGER WITHOUT OVERLAPPING
    // NEIGHBORS.
    if (resizing) return;
    anim_h.value = withTiming(slot_h, { duration: 120 });
    if (dragging) return;
    anim_top.value = withTiming(slot_top, { duration: 160 });
  }, [slot_top, slot_h, dragging, resizing, slot_top_sv, slot_h_sv, anim_top, anim_h]);

  // ONCE A TOUCH BECOMES A GRAB (PAN ACTIVATED, OR THE HOLD MATURED), ITS
  // RELEASE MUST NOT COUNT AS A TAP. RNGH CANCELS THE INNER PRESSABLE ON
  // WEB/ANDROID WHEN THE PAN ACTIVATES, BUT iOS STILL DELIVERS onPress AFTER
  // THE DROP — WHICH POPPED THE EDIT SHEET AFTER EVERY DRAG.
  const press_consumed = useRef(false);

  // HOLD-TO-LIFT TIMER: MANUAL ACTIVATION ONLY FIRES ON MOVEMENT, SO A PLAIN
  // TIMER PROVIDES THE "ARMED" INDICATOR WHILE THE FINGER IS STILL. THE MOVE
  // LIFT ONLY ARMS FOR GRABS THAT CAN BECOME MOVES — A NATIVE STRIP GRAB STAYS
  // A RESIZE, SO THE TILT INDICATOR WOULD LIE. STRIP GRABS ARM THEIR OWN
  // "ABOUT TO RESIZE" SIGNAL INSTEAD (BRAND BORDER + GROWN GRIP).
  const [resize_armed, set_resize_armed] = useState(false);
  const lift_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resize_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const begin_touch = (arm_lift: boolean, arm_resize: boolean) => {
    // A FRESH TOUCH STARTS AS A POTENTIAL TAP AGAIN.
    press_consumed.current = false;
    if (lift_timer.current) clearTimeout(lift_timer.current);
    if (resize_timer.current) clearTimeout(resize_timer.current);
    if (arm_resize) {
      resize_timer.current = setTimeout(() => {
        press_consumed.current = true;
        set_resize_armed(true);
      }, RESIZE_HOLD_MS);
    }
    if (!arm_lift) return;
    lift_timer.current = setTimeout(() => {
      press_consumed.current = true;
      set_lift_ready(true);
      lifted.value = withTiming(1, { duration: 120 });
    }, LONG_PRESS_MS);
  };
  const cancel_lift = () => {
    if (lift_timer.current) {
      clearTimeout(lift_timer.current);
      lift_timer.current = null;
    }
    if (resize_timer.current) {
      clearTimeout(resize_timer.current);
      resize_timer.current = null;
    }
    set_lift_ready(false);
    set_resize_armed(false);
  };
  useEffect(
    () => () => {
      if (lift_timer.current) clearTimeout(lift_timer.current);
      if (resize_timer.current) clearTimeout(resize_timer.current);
    },
    [],
  );

  const start_gesture = (kind: 'drag' | 'resize') => {
    press_consumed.current = true;
    if (kind === 'drag') set_dragging(true);
    else set_resizing(true);
    on_drag_state(true);
  };

  const handle_press = () => {
    if (press_consumed.current) return;
    on_press();
  };

  const preview_move = (next_start: number) => {
    set_preview_start(next_start);
    on_preview(next_start, next_start + duration);
  };

  const preview_resize = (next_duration: number) => {
    set_preview_duration(next_duration);
    on_preview(block.start_time, block.start_time + next_duration);
  };

  const finish_drag = (next_start: number) => {
    set_dragging(false);
    set_preview_start(null);
    on_drag_state(false);
    on_drop(next_start, next_start + duration);
  };

  const finish_resize = (next_duration: number) => {
    set_resizing(false);
    set_preview_duration(null);
    on_drag_state(false);
    on_drop(block.start_time, block.start_time + next_duration);
  };

  const cancel_gesture = () => {
    set_dragging(false);
    set_resizing(false);
    set_preview_start(null);
    set_preview_duration(null);
    on_drag_state(false);
  };

  // ONE PAN FOR BOTH MOVE AND RESIZE, MANUALLY ACTIVATED — NESTED DETECTORS
  // AND GESTURE RACES ARE UNRELIABLE ON RNGH WEB. THE TOUCH'S START POSITION
  // PICKS THE MODE: BOTTOM STRIP = RESIZE (ACTIVATES ON FIRST MOVEMENT),
  // ANYWHERE ELSE = MOVE (ACTIVATES AFTER A LONG-PRESS HOLD, SO QUICK SWIPES
  // STILL SCROLL THE CANVAS). HOLDING THE BOTTOM STRIP PAST THE LONG-PRESS
  // CONVERTS TO MOVE — GRABBING LOW ON A CARD TO DRAG IT MUST NOT RESIZE.
  const MODE_MOVE = 0;
  const MODE_RESIZE = 1;
  const mode = useSharedValue(MODE_MOVE);
  const pressed_at = useSharedValue(0);
  // TOUCH-DOWN POSITION — MOVEMENT BEFORE THE HOLD MATURES MEANS SCROLL
  // INTENT, AND THE PAN MUST FAIL FAST SO THE TIMELINE SCROLLS.
  const down_x = useSharedValue(0);
  const down_y = useSharedValue(0);
  // ROOMY ENOUGH THAT FINGER JITTER DURING A DELIBERATE HOLD DOESN'T FAIL IT.
  const SCROLL_SLOP_PX = 14;
  // THE RESIZE STRIP SHRINKS ON SHORT CARDS SO MOST OF THE CARD STAYS
  // GRABBABLE. FINGERS NEED A MUCH TALLER TARGET THAN A MOUSE — AND A VISIBLE
  // GRIP (BELOW) TO AIM AT.
  const resize_strip =
    Platform.OS === 'web'
      ? Math.min(18, Math.max(10, height * 0.25))
      : Math.min(34, Math.max(22, height * 0.35));
  // ON TOUCH DEVICES A STRIP GRAB STAYS A RESIZE EVEN WHEN HELD — PRESSING THE
  // HANDLE AND PAUSING BEFORE PULLING IS THE NATURAL GESTURE, AND CONVERTING
  // IT TO A MOVE MADE RESIZE FEEL BROKEN. THE WEB KEEPS THE CONVERSION: MICE
  // ARE PRECISE, AND HOLDING LOW ON A FLOOR-INFLATED CONFLICT CARD TO DRAG IT
  // IS COMMON THERE.
  const hold_converts_to_move = Platform.OS === 'web';

  // GESTURE GEOMETRY LIVES IN WORKLET HELPERS SO BOTH FINGER MOVES AND EDGE
  // AUTO-SCROLL TICKS (WHICH ARRIVE WITHOUT A TOUCH EVENT) DRIVE THE SAME MATH.
  const gesture_on = useSharedValue(0);
  const last_translation = useSharedValue(0);

  const apply_move = (translation: number) => {
    'worklet';
    const eff = translation + drag_scroll.value;
    ty.value = Math.min(Math.max(eff, min_top_px - top), max_top_px - top);
    const raw = y_to_min(top + ty.value, map_ys, map_mins);
    let next = Math.min(Math.max(Math.round(raw / SNAP_MIN) * SNAP_MIN, 0), DAY_MIN - duration);
    // LOCKED SPANS ARE HOLES, NOT WALLS: LANDING INSIDE ONE SNAPS TO THE
    // NEARER FREE SIDE, SO BLOCKS CAN STILL SLOT BEFORE OR AFTER ANCHORS.
    for (let i = 0; i < locked_starts.length; i++) {
      const ls = locked_starts[i];
      const le = locked_ends[i];
      if (next < le && next + duration > ls) {
        const before = ls - duration;
        const after = le;
        const overlap_from_top = next + duration - ls;
        const overlap_from_bottom = le - next;
        next = overlap_from_top <= overlap_from_bottom && before >= 0 ? before : after;
      }
    }
    next = Math.min(Math.max(next, 0), DAY_MIN - duration);
    if (next !== snapped_start.value) {
      snapped_start.value = next;
      runOnJS(preview_move)(next);
    }
  };

  const apply_resize = (translation: number) => {
    'worklet';
    const eff = translation + drag_scroll.value;
    const lo = (MIN_DURATION - duration) * PX_PER_MIN;
    const hi = (max_end - block.end_time) * PX_PER_MIN;
    const clamped = Math.min(Math.max(eff, lo), hi);
    const raw_duration = duration + clamped / PX_PER_MIN;
    // CONFLICTED CARDS KEEP THEIR FLOOR HEIGHT WHILE RESIZING SO THE CONFLICT
    // BAR NEVER COLLAPSES MID-GESTURE.
    anim_h.value = Math.max(raw_duration * PX_PER_MIN, floor_px);
    const next = Math.min(
      Math.max(Math.round(raw_duration / SNAP_MIN) * SNAP_MIN, MIN_DURATION),
      max_end - block.start_time,
    );
    if (next !== snapped_duration.value) {
      snapped_duration.value = next;
      runOnJS(preview_resize)(next);
    }
  };

  // EDGE AUTO-SCROLL TICKS MUTATE drag_scroll WHILE THE FINGER IS STILL —
  // RE-RUN THE GESTURE MATH SO THE CARD STAYS UNDER THE FINGER AND THE
  // SNAPPED TIME KEEPS UPDATING.
  useAnimatedReaction(
    () => drag_scroll.value,
    (value, prev) => {
      if (prev == null || value === prev || gesture_on.value === 0) return;
      if (mode.value === MODE_RESIZE) apply_resize(last_translation.value);
      else apply_move(last_translation.value);
    },
    [apply_move, apply_resize],
  );

  const pan = Gesture.Pan()
    .enabled(!block.is_locked)
    .manualActivation(true)
    // GESTURE CALLBACKS RUN AT EVENT TIME, NOT DURING RENDER — THE PURITY AND
    // REF LINTS CAN'T TELL, HENCE THE SUPPRESSIONS.
    // eslint-disable-next-line react-hooks/refs
    .onTouchesDown((e) => {
      const touch = e.allTouches[0];
      mode.value = touch && touch.y >= height - resize_strip ? MODE_RESIZE : MODE_MOVE;
      down_x.value = touch?.x ?? 0;
      down_y.value = touch?.y ?? 0;
      // eslint-disable-next-line react-hooks/purity
      pressed_at.value = Date.now();
      runOnJS(begin_touch)(
        hold_converts_to_move || mode.value === MODE_MOVE,
        // NATIVE STRIP GRABS ARM THE RESIZE SIGNAL.
        !hold_converts_to_move && mode.value === MODE_RESIZE,
      );
    })
    .onTouchesMove((e, manager) => {
      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      const held = now - pressed_at.value >= LONG_PRESS_MS;
      // WEB ONLY: A MATURED HOLD *BEFORE ACTIVATION* MEANS MOVE INTENT, EVEN
      // FROM THE RESIZE STRIP — BUT AN ACTIVE RESIZE MUST NEVER FLIP
      // MID-GESTURE. ON TOUCH DEVICES STRIP GRABS STAY RESIZES (SEE ABOVE).
      if (hold_converts_to_move && gesture_on.value === 0 && mode.value === MODE_RESIZE && held)
        mode.value = MODE_MOVE;
      // NATIVE RESIZE ONLY ENGAGES AFTER ITS SHORT HOLD — A QUICK SWIPE THAT
      // HAPPENS TO START ON THE GRIP STAYS A SCROLL. WEB (MOUSE) IS PRECISE
      // AND KEEPS THE INSTANT PULL.
      const resize_ready = hold_converts_to_move || now - pressed_at.value >= RESIZE_HOLD_MS;
      const engage = (mode.value === MODE_RESIZE && resize_ready) || held;
      if (engage) {
        manager.activate();
        return;
      }
      // REAL MOVEMENT BEFORE ANY HOLD MATURED = A SCROLL. FAIL EXPLICITLY SO
      // THE TIMELINE'S ScrollView TAKES THE TOUCH IMMEDIATELY — A PAN LEFT
      // DANGLING IN "BEGAN" KEPT BLOCKING SCROLLS THAT STARTED ON A CARD.
      const touch = e.allTouches[0];
      if (touch && gesture_on.value === 0) {
        const dx = touch.x - down_x.value;
        const dy = touch.y - down_y.value;
        if (dx * dx + dy * dy > SCROLL_SLOP_PX * SCROLL_SLOP_PX) manager.fail();
      }
    })
    // start_gesture WRITES THE press_consumed REF, BUT ONLY AT EVENT TIME.
    // eslint-disable-next-line react-hooks/refs
    .onStart(() => {
      gesture_on.value = 1;
      if (mode.value === MODE_RESIZE) {
        snapped_duration.value = duration;
        runOnJS(start_gesture)('resize');
      } else {
        lifted.value = withTiming(1, { duration: 120 });
        snapped_start.value = block.start_time;
        runOnJS(start_gesture)('drag');
      }
    })
    .onUpdate((e) => {
      // EDGE AUTO-SCROLL RUNS OFF THE ABSOLUTE FINGER POSITION.
      runOnJS(on_drag_edge)(e.absoluteY);
      last_translation.value = e.translationY;
      if (mode.value === MODE_RESIZE) apply_resize(e.translationY);
      else apply_move(e.translationY);
    })
    .onEnd(() => {
      // RELEASE HANDOFF, ENTIRELY ON THE UI THREAD SO IT IS ATOMIC AGAINST
      // RENDERING: FREEZE THE VISUAL POSITION INTO THE BASE, DROP THE FINGER
      // TRANSLATION, AND GLIDE TO THE LAST PREVIEWED SLOT. THE COMMIT THEN
      // RENDERS THAT SAME SLOT (ONE SHARED PIPELINE), SO ITS RETARGET IS A
      // NO-OP — CORRECT EVEN WHEN THE COMMIT CHANGES NOTHING PIXELWISE.
      if (mode.value === MODE_RESIZE) {
        anim_h.value = withTiming(slot_h_sv.value, { duration: 120 });
        runOnJS(finish_resize)(snapped_duration.value);
      } else {
        anim_top.value = anim_top.value + ty.value;
        ty.value = 0;
        anim_top.value = withTiming(slot_top_sv.value, { duration: 160 });
        runOnJS(finish_drag)(snapped_start.value);
      }
    })
    // CANCEL_LIFT TOUCHES A TIMER REF, BUT THIS CALLBACK FIRES AT EVENT TIME.
    // eslint-disable-next-line react-hooks/refs
    .onFinalize((_e, success) => {
      gesture_on.value = 0;
      lifted.value = withTiming(0, { duration: 120 });
      // A CANCELLED GESTURE GLIDES HOME; THE PREVIEW CLEARS AND THE SLOT
      // EFFECT RETARGETS POSITION/HEIGHT BACK TO THE RESTING LAYOUT.
      if (!success) {
        ty.value = withTiming(0, { duration: 120 });
      }
      runOnJS(cancel_lift)();
      if (!success) runOnJS(cancel_gesture)();
    });

  const animated_style = useAnimatedStyle(() => ({
    top: anim_top.value,
    transform: [
      { translateY: ty.value },
      { rotate: `${lifted.value * -1.2}deg` },
      { scale: 1 + lifted.value * 0.015 },
    ],
    height: anim_h.value,
  }));

  const display_height =
    resizing && preview_duration != null
      ? Math.max(preview_duration * PX_PER_MIN, floor_px)
      : (dragging && preview_height != null ? preview_height : height);
  const density = display_height < COMPACT_PX ? 'compact' : display_height < MEDIUM_PX ? 'medium' : 'full';

  const active = dragging || resizing;
  // WHILE DRAGGING, THE LIVE VERDICT FOR THE HOVERED SPOT DRIVES THE RED
  // TREATMENT; AT REST, THE COMMITTED CONFLICT DOES.
  const shown_conflict = active ? preview_conflict : conflict;
  const edge_color = shown_conflict ? color.danger : block_edge_color[block.block_type];

  // THE TIMES ON THE BLOCK ITSELF FOLLOW THE PREVIEW WHILE MOVING/RESIZING —
  // AND WHILE THIS BLOCK IS BEING PUSHED BY A SIBLING'S DRAG.
  const base_start = pushed_start ?? block.start_time;
  const shown_start = dragging && preview_start != null ? preview_start : base_start;
  const shown_end =
    resizing && preview_duration != null
      ? block.start_time + preview_duration
      : shown_start + duration;
  const extra_parts: string[] = [];
  if (block.place?.name && block.place.name !== block.title) extra_parts.push(block.place.name);
  if (block.booking?.confirmation_number) extra_parts.push(`#${block.booking.confirmation_number}`);
  if (block.cost != null && block.cost > 0) extra_parts.push(`$${Math.round(block.cost)}`);
  const meta_extra = extra_parts.join(' · ');

  // AN UNBOOKED RESERVATION EARNS THE AMBER "RESERVATION" CHIP EVEN WITHOUT
  // EXPLICIT META — DERIVED FROM THE BOOKING STATUS, NEVER STORED.
  const shown_chip =
    block.meta?.chip ??
    (block.booking?.status === 'needs_booking'
      ? { label: 'Reservation', kind: 'meal' as const }
      : undefined);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          styles.card,
          // AT REST A CONFLICTED CARD STAYS A CALM WHITE CARD — THE RED EDGE
          // AND THE BANNER BELOW CARRY THE STORY (TINT-ON-WHITE, LIKE EVERY
          // OTHER CHIP IN THE APP). THE FULL RED FLOOD IS RESERVED FOR THE
          // LIVE MID-DRAG WARNING, WHERE LOUD IS THE POINT.
          conflict != null && !active && styles.card_conflict_rest,
          (dragging || lift_ready) && styles.card_lifted,
          (resizing || resize_armed) && styles.card_resizing,
          // THE LIVE WARNING OUTRANKS THE LIFTED BRAND TINT.
          active && preview_conflict != null && styles.card_conflict,
          (active || lift_ready || resize_armed) && styles.card_active_z,
          animated_style,
        ]}>
        <View style={[styles.edge, { backgroundColor: edge_color }]} />
        <Pressable
          onPress={handle_press}
          style={[styles.content, density === 'compact' && styles.content_compact]}>
          {density === 'compact' ? (
            <View style={styles.compact_row}>
              <Text numberOfLines={1} style={[styles.title_compact, conflict != null && styles.title_conflict]}>
                {block.title}
              </Text>
              {block.is_locked && (
                <MaterialCommunityIcons name="lock" size={10} color={color.ink_faint} />
              )}
              <RollingText text={fmt_time(shown_start)} style={styles.time_compact} />
            </View>
          ) : (
            <>
              <View style={styles.title_row}>
                <Text
                  numberOfLines={1}
                  style={[styles.title, conflict != null && styles.title_conflict]}>
                  {block.title}
                </Text>
                {block.is_locked && (
                  <MaterialCommunityIcons name="lock" size={12} color={color.ink_faint} />
                )}
                {dragging && (
                  <MaterialCommunityIcons name="drag-vertical" size={14} color={color.brand_text} />
                )}
              </View>
              <View style={styles.meta_row}>
                <RollingText text={fmt_time_range(shown_start, shown_end)} style={styles.meta} />
                {meta_extra !== '' && (
                  <Text numberOfLines={1} style={[styles.meta, styles.meta_extra]}>
                    {` · ${meta_extra}`}
                  </Text>
                )}
              </View>
              {/* MID-DRAG WARNING: THE REASON ONLY — DROPPING HERE SURFACES
                  THE FIX PILL. */}
              {active && preview_conflict != null && (
                <View style={styles.live_conflict_row}>
                  <MaterialCommunityIcons name="clock-alert-outline" size={12} color={color.danger_text} />
                  <Text numberOfLines={1} style={styles.live_conflict_text}>
                    {preview_conflict}
                  </Text>
                </View>
              )}
              {/* THE CONFLICT BANNER: A SOFT TINTED BAND WITH A WHITE ICON
                  BADGE AND A CHIP-STYLE FIX PILL — SAME TINT-ON-WHITE GRAMMAR
                  AS EVERY STATUS CHIP, JUST IN THE RED FAMILY. */}
              {density === 'full' && conflict != null && !active && (
                <View style={styles.conflict_banner}>
                  <View style={styles.conflict_badge}>
                    <MaterialCommunityIcons name="clock-alert-outline" size={12} color={color.danger_text} />
                  </View>
                  <Text numberOfLines={2} style={styles.conflict_text}>
                    {conflict}
                  </Text>
                  {on_fix != null && (
                    <Pressable onPress={on_fix} hitSlop={8} style={styles.fix_pill}>
                      <Text style={styles.fix_pill_label}>Fix</Text>
                    </Pressable>
                  )}
                </View>
              )}
              {/* THE CONFLICT BAR ALREADY CARRIES THE RED STORY — NO EXTRA CHIP. */}
              {density === 'full' && shown_chip && !active && conflict == null && (
                <View style={{ marginTop: 6 }}>
                  <StatusChip label={shown_chip.label} kind={shown_chip.kind} />
                </View>
              )}
            </>
          )}
        </Pressable>

        {!block.is_locked && (
          <View style={styles.resize_zone} pointerEvents="none">
            <View style={[styles.resize_bar, (resizing || resize_armed) && styles.resize_bar_active]} />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: CARD_LEFT,
    right: CARD_RIGHT,
    flexDirection: 'row',
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderTopRightRadius: radius.card,
    borderBottomRightRadius: radius.card,
    overflow: 'hidden',
  },
  // 3PX COLORED LEFT EDGE, SQUARE ON THE LEFT SIDE (§3.0 SHAPE RULES).
  edge: { width: 3 },
  // RESTING CONFLICT: WHITE CARD, RED BORDER — THE BANNER INSIDE IS THE STORY.
  card_conflict_rest: { borderColor: color.danger_border },
  // LIVE MID-DRAG CONFLICT: THE FULL RED TINT, LOUD ON PURPOSE.
  card_conflict: { backgroundColor: color.danger_tint, borderColor: color.danger_border },
  card_lifted: { backgroundColor: color.brand_tint, borderColor: color.brand_border },
  card_resizing: { borderColor: color.brand_border },
  card_active_z: { zIndex: 30, elevation: 30 },

  content: { flex: 1, paddingTop: 7, paddingBottom: 10, paddingHorizontal: 12 },
  content_compact: { paddingVertical: 0, justifyContent: 'center' },
  compact_row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title_compact: { flex: 1, fontSize: 12, fontWeight: '500', color: color.ink },
  time_compact: { fontSize: 10, color: color.ink_faint },

  title_row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontSize: 14, fontWeight: '500', color: color.ink },
  title_conflict: { color: color.danger_text_deep },
  meta_row: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  meta: { fontSize: 12, color: color.ink_muted },
  meta_extra: { flexShrink: 1 },
  conflict_banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 6,
    backgroundColor: color.danger_tint,
    borderRadius: 10,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 6,
  },
  // A LITTLE WHITE CIRCLE LIFTS THE ICON OFF THE TINT — FRIENDLIER THAN A
  // BARE GLYPH FLOATING IN RED.
  conflict_badge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.card_surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  conflict_text: { flex: 1, fontSize: 11, lineHeight: 14, color: color.danger_text_deep },
  // THE LIVE ROW SITS ON THE RED-TINTED DRAG CARD — A WHITE PILL POPS THERE.
  live_conflict_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
    backgroundColor: color.card_surface,
    borderRadius: 9,
    paddingVertical: 4,
    paddingHorizontal: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  live_conflict_text: { flexShrink: 1, fontSize: 11, color: color.danger_text_deep },
  // THE WAY OUT READS AS A CHIP, NOT AN ALARM: WHITE PILL, RED BORDER,
  // FRIENDLY "Fix it".
  fix_pill: {
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.danger_border,
    borderRadius: radius.chip,
    paddingVertical: 4,
    paddingHorizontal: 11,
  },
  fix_pill_label: { fontSize: 11, fontWeight: '500', color: color.danger_text },

  resize_zone: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 14,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
  },
  resize_bar: { width: 28, height: 3, borderRadius: 1.5, backgroundColor: color.handle },
  resize_bar_active: { backgroundColor: color.brand_border, width: 40 },
});
