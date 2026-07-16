import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { fmt_duration } from '@/model/time';
import type { ShelfItem } from '@/model/types';
import { color, hairline_width, radius, space } from '@/theme/tokens';

const LONG_PRESS_MS = 220;

interface ShelfDragHandlers {
  // WORKLET DEFINED BY THE PARENT — MOVES THE DRAG GHOST TO WINDOW COORDS.
  on_ghost_move: (window_x: number, window_y: number) => void;
  on_open: (item: ShelfItem) => void;
  on_drag_start: (item: ShelfItem) => void;
  // JS-SIDE HOVER UPDATES SO THE CANVAS CAN PREVIEW THE DROP SLOT LIVE.
  on_drag_hover: (window_y: number) => void;
  on_drag_end: (window_x: number, window_y: number) => void;
  on_drag_cancel: () => void;
}

// THE IDEA SHELF (§2.2): TAP A CARD TO VIEW/EDIT THE IDEA; LONG-PRESS AND DRAG
// IT UP ONTO THE TIMELINE TO SCHEDULE IT. THE PARENT RENDERS THE DRAG GHOST
// AND RESOLVES THE DROP TIME.
export function IdeaShelf({
  items,
  on_ghost_move,
  on_open,
  on_drag_start,
  on_drag_hover,
  on_drag_end,
  on_drag_cancel,
}: { items: ShelfItem[] } & ShelfDragHandlers) {
  // A LIFTED CARD FREEZES THE SHELF SO THE LIST CAN'T SLIDE UNDER THE DRAG.
  const [dragging, set_dragging] = useState(false);

  if (items.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>Idea shelf</Text>
      <ScrollView
        horizontal
        scrollEnabled={!dragging}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.gutter, gap: space.card_gap }}>
        {items.map((item) => (
          <ShelfCard
            key={item.id}
            item={item}
            on_ghost_move={on_ghost_move}
            on_open={on_open}
            on_drag_start={(it) => {
              set_dragging(true);
              on_drag_start(it);
            }}
            on_drag_hover={on_drag_hover}
            on_drag_end={(x, y) => {
              set_dragging(false);
              on_drag_end(x, y);
            }}
            on_drag_cancel={() => {
              set_dragging(false);
              on_drag_cancel();
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function ShelfCard({
  item,
  on_ghost_move,
  on_open,
  on_drag_start,
  on_drag_hover,
  on_drag_end,
  on_drag_cancel,
}: { item: ShelfItem } & ShelfDragHandlers) {
  const start_drag = () => on_drag_start(item);

  // WHOLE-CARD DRAG: LONG-PRESS LIFTS IT; A HORIZONTAL SWIPE FAILS THE PAN
  // (failOffsetX) SO THE SHELF STILL SCROLLS; A PLAIN TAP OPENS THE SHEET.
  const pan = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .failOffsetX([-12, 12])
    .onStart((e) => {
      on_ghost_move(e.absoluteX, e.absoluteY);
      runOnJS(start_drag)();
    })
    .onUpdate((e) => {
      on_ghost_move(e.absoluteX, e.absoluteY);
      runOnJS(on_drag_hover)(e.absoluteY);
    })
    .onEnd((e) => {
      runOnJS(on_drag_end)(e.absoluteX, e.absoluteY);
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(on_drag_cancel)();
    });

  return (
    // touchAction (WEB): RNGH DEFAULTS THE CARD TO touch-action:none, WHICH
    // SWALLOWS THE BROWSER'S HORIZONTAL PAN — pan-x GIVES SHELF SCROLLING BACK
    // WHILE LONG-PRESS DRAGS (NO INITIAL MOVEMENT) STILL REACH THE GESTURE.
    <GestureDetector gesture={pan} touchAction="pan-x">
      <Pressable onPress={() => on_open(item)} style={styles.card}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.title}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.meta}>
            {item.place?.address ?? item.place?.name ?? 'No place attached'}
            {item.typical_duration_min ? ` · ~${fmt_duration(item.typical_duration_min)}` : ''}
          </Text>
        </View>
        <View style={styles.grip_zone}>
          <MaterialCommunityIcons name="drag-vertical" size={16} color={color.ink_ghost} />
        </View>
      </Pressable>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 8, paddingBottom: 10 },
  eyebrow: {
    fontSize: 11,
    color: color.brand_text_strong,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: space.gutter,
    marginBottom: 7,
  },
  card: {
    width: 172,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    paddingVertical: 11,
    paddingLeft: 11,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  title: { fontSize: 13, fontWeight: '500', color: color.ink },
  meta: { fontSize: 11, color: color.ink_muted, marginTop: 2 },
  grip_zone: { paddingVertical: 10, paddingHorizontal: 5, justifyContent: 'center' },
});
