import { StyleSheet, View } from 'react-native';

import { MapView, type MapPin } from '@/components/map_view';
import { Text } from '@/components/text';
import { fmt_time } from '@/model/time';
import type { Block } from '@/model/types';
import { block_edge_color, color, hairline_width, radius, space } from '@/theme/tokens';

// THE DAY MAP VIEW (PLAN §UX: "EVERY DAY HAS A TOGGLE BETWEEN TIMELINE AND
// MAP — NUMBERED PINS IN VISIT ORDER WITH THE ROUTE"). TAPPING A PIN OPENS
// THE BLOCK EDITOR; DRAG-TO-REORDER ON THE MAP WAITS FOR @rnmapbox/maps.
export function DayMap({
  blocks,
  on_edit_block,
}: {
  blocks: Block[];
  on_edit_block: (block: Block) => void;
}) {
  // VISIT ORDER = TIME ORDER; ONLY BLOCKS WITH COORDS CAN LAND ON THE MAP.
  const mapped = blocks.filter((b) => b.place?.coords != null);
  const unmapped = blocks.length - mapped.length;

  const pins: MapPin[] = mapped.map((b, i) => ({
    lat: b.place!.coords!.lat,
    lng: b.place!.coords!.lng,
    label: String(i + 1),
    pin_color: block_edge_color[b.block_type],
    on_press: () => on_edit_block(b),
    test_id: `map_pin_${i + 1}`,
  }));

  return (
    <View style={styles.wrap} testID="day_map">
      <MapView pins={pins} route style={styles.map} />
      {mapped.length > 0 && (
        <View style={styles.footer}>
          <Text numberOfLines={1} style={styles.footer_label}>
            {mapped.length} {mapped.length === 1 ? 'stop' : 'stops'}
            {mapped.length > 0
              ? ` · ${fmt_time(mapped[0].start_time)} – ${fmt_time(mapped[mapped.length - 1].end_time)}`
              : ''}
            {unmapped > 0 ? ` · ${unmapped} without a place` : ''}
          </Text>
          <Text style={styles.footer_hint}>Tap a pin to edit</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    marginHorizontal: space.gutter,
    marginBottom: 10,
    borderRadius: radius.tile,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    overflow: 'hidden',
    backgroundColor: color.card_surface,
  },
  map: { flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderTopWidth: hairline_width,
    borderTopColor: color.hairline,
    backgroundColor: color.card_surface,
    gap: 10,
  },
  footer_label: { flex: 1, fontSize: 11, color: color.ink_secondary },
  footer_hint: { fontSize: 11, color: color.ink_faint },
});
