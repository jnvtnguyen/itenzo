import { MaterialCommunityIcons } from '@expo/vector-icons';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
// RNGH'S ScrollView (NOT REACT-NATIVE'S) PARTICIPATES IN GESTURE ARBITRATION,
// SO A BLOCK CARD'S MANUALLY-ACTIVATED PAN CAN TAKE THE TOUCH FROM THE SCROLL
// ON NATIVE — WITHOUT IT, RESIZE (WHICH ACTIVATES ON FIRST MOVE) LOSES THE
// RACE TO THE SCROLL ON iOS AND NEVER STARTS.
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { BlockCard } from '@/components/block_card';
import { RollingText } from '@/components/rolling_text';
import { Text } from '@/components/text';
import {
  BLOCK_SPACER_PX,
  CANVAS_PAD,
  CARD_LEFT,
  CARD_RIGHT,
  CONFLICT_MIN_PX,
  DAY_MIN,
  EDGE_PAD,
  GAP_MAX_PX,
  GAP_MIN_PX,
  MIN_BLOCK_MIN,
  PX_PER_MIN,
  RAIL_W,
} from '@/components/timeline_metrics';
import { fmt_clock, fmt_duration, fmt_period, fmt_time, fmt_time_range, snap_time } from '@/model/time';
import type { Block, BlockType, TransitLeg, TransitMode } from '@/model/types';
import { decorate_day } from '@/services/feasibility';
import { block_edge_color, color, hairline_width, radius } from '@/theme/tokens';

const GAP_THRESHOLD_MIN = 45;
// MATCHES BLOCKCARD'S COMPACT BREAKPOINT SO SHORT DROP PREVIEWS COLLAPSE THE
// SAME WAY REAL BLOCKS DO.
const DROP_COMPACT_PX = 46;

const mode_icon: Record<TransitMode, keyof typeof MaterialCommunityIcons.glyphMap> = {
  walk: 'walk',
  drive: 'car-outline',
  transit: 'bus',
  rideshare: 'taxi',
};

export interface TimelineCanvasHandle {
  // MAPS AN ABSOLUTE WINDOW Y (E.G. A SHELF-CARD DROP) TO A SNAPPED TIMELINE
  // MINUTE, OR NULL WHEN THE FINGER ISN'T OVER THE CANVAS. center_offset_px
  // SHIFTS THE MAPPED POINT (HALF THE CARD HEIGHT) WITHOUT LOOSENING THE
  // OVER-THE-CANVAS CHECK ON THE RAW FINGER POSITION.
  time_at_window_y(window_y: number, center_offset_px?: number): number | null;
  scroll_to_min(min: number): void;
  // FEEDS THE FINGER'S WINDOW Y SO THE SHELF-DROP CARD CAN TRACK IT 1:1 —
  // JUST LIKE A DRAGGED TIMELINE BLOCK, THE CARD FOLLOWS THE FINGER WHILE THE
  // SNAPPED TIME DRIVES THE RAIL LABEL AND PUSH PREVIEW.
  move_shelf_finger(window_y: number): void;
}

interface TimeUpdate {
  block_id: string;
  start_time: number;
  end_time: number;
}

interface LayoutSeg {
  kind: 'block' | 'gap' | 'spacer';
  from_min: number;
  to_min: number;
  top: number;
  height: number;
  block?: Block;
  leg?: TransitLeg;
  // THE BLOCK THE LEG DEPARTS FROM — TAPPING THE LEG CYCLES ITS MODE OVERRIDE.
  leg_owner?: Block;
}

interface Layout {
  segs: LayoutSeg[];
  total_height: number;
  // PIECEWISE-LINEAR BREAKPOINTS FOR Y↔MINUTE MAPPING (WORKLET-FRIENDLY ARRAYS).
  map_ys: number[];
  map_mins: number[];
}

// COMPRESSED-TIME LAYOUT: BLOCKS AT FULL MINUTE SCALE, EMPTY TIME CLAMPED INTO
// COMPACT GAP BANDS — A SPARSE DAY STAYS SHORT; RESIZING AN EVENT GROWS IT.
export function compute_layout(blocks: Block[]): Layout {
  const sorted = [...blocks].sort((a, b) => a.start_time - b.start_time);
  const segs: LayoutSeg[] = [];
  let y = CANVAS_PAD;
  let cursor_min = 0;
  let prev_block: Block | undefined;

  const push_gap = (from_min: number, to_min: number, leg_owner?: Block) => {
    const gap = to_min - from_min;
    const leg = leg_owner?.meta?.transit_to_next;
    if (gap <= 0) {
      segs.push({ kind: 'spacer', from_min, to_min: from_min, top: y, height: BLOCK_SPACER_PX });
      y += BLOCK_SPACER_PX;
      return;
    }
    const height = Math.min(Math.max(gap * PX_PER_MIN, GAP_MIN_PX), GAP_MAX_PX);
    segs.push({ kind: 'gap', from_min, to_min, top: y, height, leg, leg_owner });
    y += height;
  };

  for (const block of sorted) {
    if (prev_block) push_gap(cursor_min, block.start_time, prev_block);
    else if (block.start_time > 0) push_gap(0, block.start_time);
    // CONFLICTED BLOCKS GET A FLOOR HEIGHT SO THE CONFLICT BAR + FIX PILL FIT.
    const height = Math.max(
      (block.end_time - block.start_time) * PX_PER_MIN,
      block.meta?.conflict != null ? CONFLICT_MIN_PX : 0,
    );
    segs.push({ kind: 'block', from_min: block.start_time, to_min: block.end_time, top: y, height, block });
    y += height;
    cursor_min = Math.max(cursor_min, block.end_time);
    prev_block = block;
  }
  push_gap(cursor_min, DAY_MIN);

  const map_ys: number[] = [];
  const map_mins: number[] = [];
  let last_min = 0;
  for (const seg of segs) {
    const from = Math.max(seg.from_min, last_min);
    const to = Math.max(seg.to_min, from);
    map_ys.push(seg.top, seg.top + seg.height);
    map_mins.push(from, to);
    last_min = to;
  }

  return { segs, total_height: y + CANVAS_PAD, map_ys, map_mins };
}

export function y_of_min(layout: Layout, min: number): number {
  const { map_ys, map_mins } = layout;
  if (map_mins.length === 0) return CANVAS_PAD;
  if (min <= map_mins[0]) return map_ys[0];
  for (let i = 1; i < map_mins.length; i++) {
    if (min <= map_mins[i]) {
      const span = map_mins[i] - map_mins[i - 1];
      if (span <= 0) return map_ys[i];
      const t = (min - map_mins[i - 1]) / span;
      return map_ys[i - 1] + t * (map_ys[i] - map_ys[i - 1]);
    }
  }
  return map_ys[map_ys.length - 1];
}

export function min_of_y(layout: Layout, y: number): number {
  const { map_ys, map_mins } = layout;
  if (map_ys.length === 0) return 0;
  if (y <= map_ys[0]) return map_mins[0];
  for (let i = 1; i < map_ys.length; i++) {
    if (y <= map_ys[i]) {
      const span = map_ys[i] - map_ys[i - 1];
      if (span <= 0) return map_mins[i];
      const t = (y - map_ys[i - 1]) / span;
      return map_mins[i - 1] + t * (map_mins[i] - map_mins[i - 1]);
    }
  }
  return map_mins[map_mins.length - 1];
}

// LIVE REORDER ENGINE: WHEN A DRAGGED SPAN OVERLAPS FLEXIBLE NEIGHBORS THEY GET
// PUSHED OUT OF THE WAY (DOWN PAST THE END, OR UP PAST THE START), CHAINING
// THROUGH FURTHER NEIGHBORS. LOCKED ANCHORS NEVER MOVE — CHAINS JUMP PAST THEM.
export function resolve_push(
  blocks: Block[],
  dragged_id: string,
  start: number,
  end: number,
): Map<string, [number, number]> {
  const updates = new Map<string, [number, number]>();
  const others = blocks.filter((b) => b.id !== dragged_id);

  let cursor = end;
  for (const b of [...others].sort((a, z) => a.start_time - z.start_time)) {
    if (b.start_time < start) continue;
    if (b.start_time >= cursor) break;
    if (b.is_locked) {
      cursor = Math.max(cursor, b.end_time);
      continue;
    }
    const d = b.end_time - b.start_time;
    const next_start = Math.min(cursor, DAY_MIN - d);
    updates.set(b.id, [next_start, next_start + d]);
    cursor = next_start + d;
  }

  let ceiling = start;
  for (const b of [...others].sort((a, z) => z.end_time - a.end_time)) {
    if (b.start_time >= start) continue;
    if (b.end_time <= ceiling) break;
    if (b.is_locked) {
      ceiling = Math.min(ceiling, b.start_time);
      continue;
    }
    const d = b.end_time - b.start_time;
    const next_end = Math.max(ceiling, d);
    updates.set(b.id, [next_end - d, next_end]);
    ceiling = next_end - d;
  }

  return updates;
}

// RESIZE LIMIT: A BLOCK CANNOT GROW PAST THE NEXT LOCKED ANCHOR BELOW IT.
function resize_max_end(blocks: Block[], block: Block): number {
  let max_end = DAY_MIN;
  for (const b of blocks) {
    if (b.id === block.id || !b.is_locked) continue;
    if (b.start_time >= block.end_time) max_end = Math.min(max_end, b.start_time);
  }
  return max_end;
}

const SHELF_PREVIEW_ID = '__shelf__';

// RAIL LABEL THAT GLIDES TO ITS PREVIEW SLOT (SAME 160MS AS THE BLOCK PUSH)
// AND ROLLS ITS TIME TEXT INSTEAD OF FLICKERING THROUGH SNAP STEPS.
function RailLabel({ top, min, active }: { top: number; min: number; active: boolean }) {
  const a_top = useSharedValue(top);
  useEffect(() => {
    a_top.value = withTiming(top, { duration: 160 });
  }, [top, a_top]);
  const follow = useAnimatedStyle(() => ({ top: a_top.value }));
  return (
    <Animated.View style={[styles.rail_wrap, follow]}>
      <RollingText text={fmt_clock(min)} style={[styles.rail_time, active && styles.rail_active]} />
      <RollingText
        text={fmt_period(min)}
        style={[styles.rail_period, active && styles.rail_active]}
      />
    </Animated.View>
  );
}

export const TimelineCanvas = forwardRef<
  TimelineCanvasHandle,
  {
    // RAW (UNDECORATED) DAY BLOCKS — THE CANVAS RUNS decorate_day ITSELF FOR
    // BOTH THE RESTING LAYOUT AND DRAG PREVIEWS.
    blocks: Block[];
    // THE DAY'S ISO DATE — THE FEASIBILITY ENGINE'S HOURS CHECKS NEED THE
    // WEEKDAY.
    day_date: string;
    // LIVE PREVIEW OF A SHELF CARD HOVERING OVER THE CANVAS — RENDERED AS A
    // LIFTED BLOCK CARD, SAME PUSH/SNAP TREATMENT AS A TIMELINE DRAG.
    shelf_preview: {
      start_time: number;
      duration_min: number;
      title: string;
      block_type: BlockType;
    } | null;
    on_edit_block: (block: Block) => void;
    // ONE-TAP CONFLICT FIX FROM A BLOCK'S "FIX" LABEL.
    on_fix_block: (block: Block) => void;
    // TAPPING A TRANSIT LEG CYCLES ITS MODE (WALK → DRIVE → TRANSIT → RIDE →
    // AUTO); THE OVERRIDE LIVES ON THE BLOCK THE LEG DEPARTS FROM.
    on_change_leg_mode: (block: Block) => void;
    on_commit_times: (updates: TimeUpdate[]) => void;
    on_fill_gap: (start_time: number) => void;
    on_add_first: () => void;
    on_drag_state: (active: boolean) => void;
  }
>(function TimelineCanvas(
  {
    blocks,
    day_date,
    shelf_preview,
    on_edit_block,
    on_fix_block,
    on_change_leg_mode,
    on_commit_times,
    on_fill_gap,
    on_add_first,
    on_drag_state,
  },
  ref,
) {
  const scroll_ref = useRef<ScrollView>(null);
  const container_ref = useRef<View>(null);
  const scroll_y = useRef(0);
  const window_y = useRef<number | null>(null);
  const window_h = useRef<number | null>(null);

  const [dragging, set_dragging] = useState(false);
  const [drag_preview, set_drag_preview] = useState<
    { block_id: string; start_time: number; end_time: number } | null
  >(null);

  // ALL DECORATION HAPPENS HERE, ON THE RAW DAY BLOCKS. THE PREVIEW PIPELINE
  // BELOW RUNS THE SAME decorate_day ON THE SAME CLEAN INPUT, SO THE LAYOUT
  // UNDER THE FINGER IS EXACTLY THE LAYOUT THAT COMMITS. (DECORATING
  // ALREADY-DECORATED BLOCKS KEPT STALE CONFLICT FLOORS ALIVE IN THE PREVIEW —
  // DROPS LANDED ON A DIFFERENT LAYOUT THAN THE ONE SHOWN MID-DRAG.)
  const decorated = useMemo(
    () => decorate_day({ id: '__display__', date: day_date, blocks }),
    [blocks, day_date],
  );
  const layout = useMemo(() => compute_layout(decorated), [decorated]);

  // LIVE "NOW" LINE (§4 TIER 3, LITE): ONLY ON THE DAY THAT IS ACTUALLY
  // TODAY. CLOCK READS LIVE IN AN EFFECT (NEVER DURING RENDER) AND TICKS
  // EVERY HALF MINUTE.
  const [now, set_now] = useState<{ iso: string; min: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      set_now({ iso, min: d.getHours() * 60 + d.getMinutes() });
    };
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, []);
  const now_min = now != null && now.iso === day_date ? now.min : null;
  const layout_ref = useRef(layout);
  useEffect(() => {
    layout_ref.current = layout;
  }, [layout]);

  // EDGE AUTO-SCROLL: DRAGGING A BLOCK NEAR THE CANVAS'S TOP/BOTTOM EDGE
  // SCROLLS THE TIMELINE UNDERNEATH IT. drag_scroll ACCUMULATES THE SCROLLED
  // PIXELS SO THE DRAGGED CARD STAYS GLUED UNDER THE (POSSIBLY STILL) FINGER.
  const drag_scroll = useSharedValue(0);
  const auto_timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const auto_dir = useRef(0);
  const stop_auto_scroll = () => {
    if (auto_timer.current) clearInterval(auto_timer.current);
    auto_timer.current = null;
    auto_dir.current = 0;
  };
  useEffect(() => stop_auto_scroll, []);
  const handle_drag_edge = (abs_y: number) => {
    if (window_y.current == null || window_h.current == null) return;
    const EDGE_ZONE = 72;
    const top_edge = window_y.current + EDGE_ZONE;
    const bottom_edge = window_y.current + window_h.current - EDGE_ZONE;
    auto_dir.current = abs_y < top_edge ? -1 : abs_y > bottom_edge ? 1 : 0;
    if (auto_dir.current !== 0 && auto_timer.current == null) {
      auto_timer.current = setInterval(() => {
        const dir = auto_dir.current;
        const max_y = Math.max(0, layout_ref.current.total_height - (window_h.current ?? 0));
        const next = Math.min(Math.max(scroll_y.current + dir * 8, 0), max_y);
        if (next === scroll_y.current) return;
        const delta = next - scroll_y.current;
        scroll_y.current = next;
        scroll_ref.current?.scrollTo({ y: next, animated: false });
        drag_scroll.value = drag_scroll.value + delta;
      }, 16);
    } else if (auto_dir.current === 0 && auto_timer.current != null) {
      stop_auto_scroll();
    }
  };

  // SHELF-DRAG FINGER POSITION IN CANVAS CONTENT COORDS; THE DROP CARD RIDES
  // IT DIRECTLY SO THERE IS NO SNAP-INDUCED OFFSET UNDER THE FINGER.
  const shelf_finger_y = useSharedValue(0);
  const shelf_h = shelf_preview ? shelf_preview.duration_min * PX_PER_MIN : 0;
  const total_h = layout.total_height;
  const drop_follow = useAnimatedStyle(() => {
    const top = Math.min(
      Math.max(shelf_finger_y.value - shelf_h / 2, CANVAS_PAD),
      Math.max(total_h - shelf_h - CANVAS_PAD, CANVAS_PAD),
    );
    return {
      transform: [{ translateY: top }, { rotate: '-1.2deg' }, { scale: 1.015 }],
    };
  }, [shelf_h, total_h]);

  useImperativeHandle(ref, () => ({
    time_at_window_y(y, center_offset = 0) {
      if (window_y.current == null) return null;
      // ONLY FINGERS ACTUALLY OVER THE CANVAS COUNT: THE SHELF SITS JUST
      // BELOW IT, SO A JUST-LIFTED CARD MUST BE DRAGGED UP ONTO THE TIMELINE
      // BEFORE IT ENGAGES — NO INSTANT SNAP-IN WHILE STILL HOLDING THE SHELF.
      if (window_h.current != null && (y < window_y.current || y > window_y.current + window_h.current - 8)) {
        return null;
      }
      const rel = y - center_offset - window_y.current + scroll_y.current;
      const l = layout_ref.current;
      if (rel < -40 || rel > l.total_height + 40) return null;
      return Math.min(Math.max(snap_time(min_of_y(l, rel)), 0), DAY_MIN - MIN_BLOCK_MIN);
    },
    scroll_to_min(min) {
      const y = y_of_min(layout_ref.current, min);
      scroll_ref.current?.scrollTo({ y: Math.max(0, y - 40), animated: false });
    },
    move_shelf_finger(y) {
      if (window_y.current == null) return;
      shelf_finger_y.value = y - window_y.current + scroll_y.current;
    },
  }));

  const measure = () => {
    container_ref.current?.measureInWindow((_x, y, _w, h) => {
      window_y.current = y;
      window_h.current = h;
    });
  };

  // UNIFIED GEOMETRIC PREVIEW: APPLY THE ACTIVE PREVIEW (BLOCK DRAG/RESIZE OR
  // SHELF HOVER) PLUS ITS PUSH CHAIN, RECOMPUTE THE COMPRESSED LAYOUT, AND
  // OFFSET EVERY CARD TO ITS PREVIEW POSITION — SO GAPS RE-FLOW AND A GROWING
  // BLOCK PHYSICALLY MOVES EVERYTHING BELOW IT.
  const preview = useMemo(() => {
    if (drag_preview) return drag_preview;
    if (shelf_preview) {
      return {
        block_id: SHELF_PREVIEW_ID,
        start_time: shelf_preview.start_time,
        end_time: shelf_preview.start_time + shelf_preview.duration_min,
      };
    }
    return null;
  }, [drag_preview, shelf_preview]);

  const preview_info = useMemo(() => {
    if (!preview) return null;
    const pseudo: Block | null =
      preview.block_id === SHELF_PREVIEW_ID
        ? {
            id: SHELF_PREVIEW_ID,
            block_type: 'activity',
            title: '',
            start_time: preview.start_time,
            end_time: preview.end_time,
            source: 'manual',
            is_locked: false,
          }
        : null;
    const all = pseudo ? [...blocks, pseudo] : blocks;
    const pushed = resolve_push(all, preview.block_id, preview.start_time, preview.end_time);
    const preview_blocks = all.map((b) => {
      if (b.id === preview.block_id)
        return { ...b, start_time: preview.start_time, end_time: preview.end_time };
      const p = pushed.get(b.id);
      return p ? { ...b, start_time: p[0], end_time: p[1] } : b;
    });
    // RUN THE FEASIBILITY ENGINE ON THE PREVIEW: THE DRAGGED CARD CAN WARN
    // "THIS SPOT WILL CONFLICT" *BEFORE* THE DROP, AND THE PREVIEW LAYOUT
    // ALREADY INCLUDES THE CONFLICT CARD'S FLOOR HEIGHT — SO COMMITTING
    // DOESN'T SNAP-GROW THE CARD AND SHOVE THE DAY AROUND AFTER THE FACT.
    const decorated = decorate_day({ id: '__preview__', date: day_date, blocks: preview_blocks });
    const p_layout = compute_layout(decorated);
    const tops = new Map<string, number>();
    const starts = new Map<string, number>();
    const heights = new Map<string, number>();
    for (const seg of p_layout.segs) {
      if (seg.kind === 'block' && seg.block) {
        tops.set(seg.block.id, seg.top);
        starts.set(seg.block.id, seg.block.start_time);
        heights.set(seg.block.id, seg.height);
      }
    }
    const previewed = decorated.find((b) => b.id === preview.block_id);
    return { tops, starts, heights, conflict: previewed?.meta?.conflict ?? null };
  }, [blocks, preview, day_date]);

  const handle_drop = (block: Block, start_time: number, end_time: number) => {
    set_drag_preview(null);
    const pushed = resolve_push(blocks, block.id, start_time, end_time);
    const updates: TimeUpdate[] = [{ block_id: block.id, start_time, end_time }];
    for (const [id, [s, e]] of pushed) updates.push({ block_id: id, start_time: s, end_time: e });
    const changed = updates.filter((u) => {
      const b = blocks.find((x) => x.id === u.block_id);
      return b && (b.start_time !== u.start_time || b.end_time !== u.end_time);
    });
    if (changed.length > 0) on_commit_times(changed);
  };

  return (
    <View ref={container_ref} onLayout={measure} style={{ flex: 1 }}>
      <ScrollView
        ref={scroll_ref}
        scrollEnabled={!dragging}
        onScroll={(e) => {
          scroll_y.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <View style={{ height: layout.total_height }}>
          {layout.segs.map((seg, i) => {
            if (seg.kind === 'gap') {
              const free_min = seg.to_min - seg.from_min - (seg.leg?.duration_min ?? 0);
              const danger =
                layout.segs[i + 1]?.kind === 'block' &&
                layout.segs[i + 1]?.block?.meta?.conflict != null;
              // GAP CONTENT VANISHES WHILE ANY PREVIEW IS LIVE — IT RE-FLOWS ON COMMIT.
              const hidden = dragging || preview != null;
              return (
                <View
                  key={`gap_${seg.from_min}_${seg.to_min}`}
                  style={[styles.gap_band, { top: seg.top, height: seg.height, opacity: hidden ? 0 : 1 }]}
                  pointerEvents={hidden ? 'none' : 'box-none'}>
                  {seg.leg && (
                    // TAPPING THE LEG CYCLES ITS MODE — ONLY MEANINGFUL WHEN
                    // THE ENGINE COMPUTES THE LEG (BOTH ENDS HAVE COORDS).
                    <Pressable
                      disabled={
                        seg.leg_owner?.place?.coords == null ||
                        layout.segs[i + 1]?.block?.place?.coords == null
                      }
                      onPress={() => seg.leg_owner && on_change_leg_mode(seg.leg_owner)}
                      hitSlop={6}
                      style={styles.leg_row}>
                      <View style={styles.leg_dashes}>
                        {Array.from({ length: Math.max(2, Math.floor((seg.height - 8) / 9)) }, (_, d) => (
                          <View
                            key={d}
                            style={[styles.dash, { backgroundColor: danger ? color.danger : color.spine }]}
                          />
                        ))}
                      </View>
                      <MaterialCommunityIcons
                        name={mode_icon[seg.leg.mode]}
                        size={12}
                        color={danger ? color.danger_text : color.ink_muted}
                      />
                      <Text style={[styles.leg_label, danger && { color: color.danger_text }]}>
                        {fmt_duration(seg.leg.duration_min)}
                        {seg.leg.distance_mi ? ` · ${seg.leg.distance_mi} mi` : ''}
                      </Text>
                      {/* A SWAP GLYPH MARKS THE LEG AS TAPPABLE. */}
                      {seg.leg_owner?.place?.coords != null &&
                        layout.segs[i + 1]?.block?.place?.coords != null && (
                          <MaterialCommunityIcons
                            name="swap-horizontal"
                            size={15}
                            color={color.ink_faint}
                          />
                        )}
                    </Pressable>
                  )}
                  {free_min >= GAP_THRESHOLD_MIN && (
                    <Pressable
                      onPress={() => on_fill_gap(snap_time(seg.from_min + (seg.leg?.duration_min ?? 0)))}
                      style={styles.gap_pill}>
                      <Text style={styles.gap_free}>{fmt_duration(free_min)} free</Text>
                      <MaterialCommunityIcons name="creation" size={12} color={color.brand} />
                      <Text style={styles.gap_fill}>Fill</Text>
                    </Pressable>
                  )}
                </View>
              );
            }
            if (seg.kind === 'block' && seg.block) {
              const block = seg.block;
              const is_previewed = preview?.block_id === block.id;
              const preview_top = preview_info?.tops.get(block.id);
              const offset_px =
                !is_previewed && preview_top != null ? preview_top - seg.top : 0;
              const preview_start = preview_info?.starts.get(block.id);
              const duration = block.end_time - block.start_time;
              const locked_others = blocks.filter((b) => b.is_locked && b.id !== block.id);
              return (
                <BlockCard
                  key={block.id}
                  block={block}
                  top={seg.top}
                  height={seg.height}
                  offset_px={offset_px}
                  pushed_start={
                    !is_previewed && preview_start != null && preview_start !== block.start_time
                      ? preview_start
                      : null
                  }
                  preview_conflict={is_previewed ? (preview_info?.conflict ?? null) : null}
                  preview_height={is_previewed ? (preview_info?.heights.get(block.id) ?? null) : null}
                  preview_top={is_previewed ? (preview_info?.tops.get(block.id) ?? null) : null}
                  max_end={resize_max_end(blocks, block)}
                  locked_starts={locked_others.map((b) => b.start_time)}
                  locked_ends={locked_others.map((b) => b.end_time)}
                  min_top_px={layout.map_ys[0] ?? CANVAS_PAD}
                  max_top_px={y_of_min(layout, DAY_MIN - duration)}
                  map_ys={layout.map_ys}
                  map_mins={layout.map_mins}
                  on_press={() => on_edit_block(block)}
                  on_fix={block.meta?.fix ? () => on_fix_block(block) : undefined}
                  on_drag_edge={handle_drag_edge}
                  drag_scroll={drag_scroll}
                  on_preview={(s, e) =>
                    set_drag_preview({ block_id: block.id, start_time: s, end_time: e })
                  }
                  on_drop={(s, e) => handle_drop(block, s, e)}
                  on_drag_state={(active) => {
                    set_dragging(active);
                    on_drag_state(active);
                    drag_scroll.value = 0;
                    if (!active) {
                      set_drag_preview(null);
                      stop_auto_scroll();
                    }
                  }}
                />
              );
            }
            return null;
          })}

          {/* RAIL TIMES STAY VISIBLE DURING DRAGS AND FOLLOW THE PREVIEW — THE
              MOVING BLOCK'S TIME JUST DARKENS SLIGHTLY (NO BRAND COLOR). */}
          {layout.segs
            .filter((seg) => seg.kind === 'block')
            .map((seg) => {
              const b = seg.block!;
              const is_previewed = preview?.block_id === b.id;
              const p_top = preview_info?.tops.get(b.id);
              const p_start = preview_info?.starts.get(b.id);
              const shown = p_start ?? b.start_time;
              return (
                <RailLabel
                  key={`rail_${b.id}`}
                  top={(p_top ?? seg.top) + 2}
                  min={shown}
                  active={is_previewed}
                />
              );
            })}

          {shelf_preview && preview_info?.tops.get(SHELF_PREVIEW_ID) != null && (
            <>
              <RailLabel
                top={(preview_info.tops.get(SHELF_PREVIEW_ID) ?? 0) + 2}
                min={shelf_preview.start_time}
                active
              />
              <Animated.View
                pointerEvents="none"
                style={[styles.drop_card, { top: 0, height: shelf_h }, drop_follow]}>
                <View
                  style={[
                    styles.drop_edge,
                    { backgroundColor: block_edge_color[shelf_preview.block_type] },
                  ]}
                />
                {shelf_preview.duration_min * PX_PER_MIN < DROP_COMPACT_PX ? (
                  <View style={[styles.drop_content, styles.drop_content_compact]}>
                    <View style={styles.drop_row}>
                      <Text numberOfLines={1} style={styles.drop_title_compact}>
                        {shelf_preview.title}
                      </Text>
                      <RollingText
                        text={fmt_time(shelf_preview.start_time)}
                        style={styles.drop_time_compact}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={styles.drop_content}>
                    <View style={styles.drop_row}>
                      <Text numberOfLines={1} style={styles.drop_title}>
                        {shelf_preview.title}
                      </Text>
                      <MaterialCommunityIcons
                        name="drag-vertical"
                        size={14}
                        color={color.brand_text}
                      />
                    </View>
                    <RollingText
                      text={fmt_time_range(
                        shelf_preview.start_time,
                        shelf_preview.start_time + shelf_preview.duration_min,
                      )}
                      style={styles.drop_meta}
                    />
                  </View>
                )}
              </Animated.View>
            </>
          )}

          {/* THE "NOW" LINE — TODAY ONLY, GLIDES DOWN AS THE DAY GOES. */}
          {now_min != null && (
            <View
              pointerEvents="none"
              style={[styles.now_row, { top: y_of_min(layout, now_min) - 3 }]}>
              <Text style={styles.now_label}>now</Text>
              <View style={styles.now_dot} />
              <View style={styles.now_rule} />
            </View>
          )}

          {blocks.length === 0 && (
            <View style={[styles.empty_day, { top: CANVAS_PAD + 12 }]}>
              <Text style={styles.empty_title}>Nothing planned yet</Text>
              <Text style={styles.empty_meta}>Add a block, or drag an idea up from the shelf.</Text>
              <Pressable onPress={on_add_first} style={styles.empty_cta}>
                <Text style={styles.empty_cta_label}>Add your first block</Text>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  rail_wrap: { position: 'absolute', left: EDGE_PAD, width: RAIL_W, alignItems: 'flex-end' },
  rail_time: { fontSize: 10, color: color.ink_faint, textAlign: 'right' },
  rail_period: { fontSize: 9, color: color.ink_faint, textAlign: 'right', marginTop: 1 },
  rail_active: { color: color.ink_secondary, fontWeight: '500' },

  gap_band: {
    position: 'absolute',
    left: CARD_LEFT,
    right: CARD_RIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
  },
  leg_row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leg_dashes: { gap: 3, alignItems: 'center' },
  dash: { width: 2.5, height: 5, borderRadius: 1.5 },
  leg_label: { fontSize: 11, color: color.ink_muted },
  gap_pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.hairline,
    borderRadius: radius.chip,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  gap_free: { fontSize: 11, color: color.ink_muted },
  gap_fill: { fontSize: 11, color: color.brand_text },

  now_row: {
    position: 'absolute',
    left: EDGE_PAD,
    right: CARD_RIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 26,
    elevation: 26,
  },
  now_label: { fontSize: 9, fontWeight: '500', color: color.brand, marginRight: 3 },
  now_dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.brand },
  now_rule: { flex: 1, height: 1.5, backgroundColor: color.brand, opacity: 0.45, marginLeft: 2 },

  // THE SHELF-DROP PREVIEW WEARS THE EXACT LIFTED-BLOCK LOOK OF A TIMELINE
  // DRAG — SAME SURFACE, EDGE STRIP, TYPE, TILT, AND SCALE AS BLOCKCARD LIFTED.
  drop_card: {
    position: 'absolute',
    left: CARD_LEFT,
    right: CARD_RIGHT,
    flexDirection: 'row',
    backgroundColor: color.brand_tint,
    borderWidth: hairline_width,
    borderColor: color.brand_border,
    borderTopRightRadius: radius.card,
    borderBottomRightRadius: radius.card,
    overflow: 'hidden',
    zIndex: 40,
    elevation: 40,
  },
  drop_edge: { width: 3 },
  drop_content: { flex: 1, paddingTop: 7, paddingBottom: 10, paddingHorizontal: 12 },
  drop_content_compact: { paddingVertical: 0, justifyContent: 'center' },
  drop_row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  drop_title: { flex: 1, fontSize: 14, fontWeight: '500', color: color.ink },
  drop_title_compact: { flex: 1, fontSize: 12, fontWeight: '500', color: color.ink },
  drop_time_compact: { fontSize: 10, color: color.ink_faint },
  drop_meta: { fontSize: 12, color: color.ink_muted, marginTop: 1 },

  // THE EMPTY-DAY CARD IGNORES THE RAIL INSET SO IT SITS CENTERED ON SCREEN.
  empty_day: {
    position: 'absolute',
    left: EDGE_PAD,
    right: EDGE_PAD,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.hairline,
    borderRadius: radius.card,
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 20,
    backgroundColor: color.canvas,
  },
  empty_title: { fontSize: 14, fontWeight: '500', color: color.ink_secondary },
  empty_meta: { fontSize: 12, color: color.ink_muted, marginTop: 4, textAlign: 'center' },
  empty_cta: {
    marginTop: 12,
    backgroundColor: color.brand,
    borderRadius: radius.cta,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  empty_cta_label: { fontSize: 13, fontWeight: '500', color: color.white },
});
