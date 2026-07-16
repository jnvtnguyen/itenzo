import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { day_of_month, weekday_short } from '@/model/time';
import type { Day } from '@/model/types';
import { color, hairline_width, radius, space } from '@/theme/tokens';
import { Text } from '@/components/text';

// DATE PAGER TILE (PLAN.MD §3.0): STACKED WEEKDAY OVER DATE NUMBER, WHITE TILE +
// HAIRLINE; SELECTED = SOLID BRAND FILL, WHITE NUMBER, CREAM WEEKDAY. NO DOTS.
export function DatePager({
  days,
  selected_day_id,
  on_select,
}: {
  days: Day[];
  selected_day_id: string;
  on_select: (day_id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: space.gutter, gap: space.card_gap }}>
      {days.map((day) => {
        const selected = day.id === selected_day_id;
        return (
          <Pressable
            key={day.id}
            onPress={() => on_select(day.id)}
            style={[styles.tile, selected && styles.tile_selected]}>
            <Text style={[styles.weekday, selected && styles.weekday_selected]}>
              {weekday_short(day.date)}
            </Text>
            <Text style={[styles.number, selected && styles.number_selected]}>
              {day_of_month(day.date)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 52,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.row,
    gap: 2,
  },
  tile_selected: { backgroundColor: color.brand, borderColor: color.brand },
  weekday: { fontSize: 11, color: color.ink_faint, letterSpacing: 0.5 },
  weekday_selected: { color: color.brand_tint },
  number: { fontSize: 16, fontWeight: '500', color: color.ink_secondary },
  number_selected: { color: color.white },
});
