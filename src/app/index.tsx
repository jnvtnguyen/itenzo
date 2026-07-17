import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { Wordmark } from '@/components/wordmark';
import { days_between, days_until, fmt_date_range } from '@/model/time';
import type { Trip } from '@/model/types';
import { use_trip_store } from '@/store/trip_store';
import { color, font, hairline_width, radius, space } from '@/theme/tokens';

function trip_countdown_label(trip: Trip): string {
  const d = days_until(trip.start_date);
  if (d > 1) return `IN ${d} DAYS`;
  if (d === 1) return 'TOMORROW';
  if (d === 0) return 'TODAY';
  return 'PAST TRIP';
}

function TripCard({ trip }: { trip: Trip }) {
  const block_count = trip.days.reduce((n, d) => n + d.blocks.length, 0);
  const anchor_count = trip.days.reduce((n, d) => n + d.blocks.filter((b) => b.is_locked).length, 0);
  const day_count = days_between(trip.start_date, trip.end_date) + 1;
  // BUDGET ROLLUP (§4 TIER 2): SUM OF EVERY BLOCK'S OPTIONAL COST.
  const trip_cost = trip.days.reduce(
    (sum, d) => sum + d.blocks.reduce((s, b) => s + (b.cost ?? 0), 0),
    0,
  );

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/trip/[trip_id]', params: { trip_id: trip.id } })}
      style={styles.trip_card}>
      <View style={styles.row_between}>
        <Text style={styles.trip_eyebrow}>{trip_countdown_label(trip)}</Text>
        <MaterialCommunityIcons name="chevron-right" size={16} color={color.anchor_text_on_dark} />
      </View>
      <Text style={styles.trip_title}>{trip.title}</Text>
      <Text style={styles.trip_meta}>
        {fmt_date_range(trip.start_date, trip.end_date)} · {day_count} days · {trip.travelers}{' '}
        {trip.travelers === 1 ? 'traveler' : 'travelers'}
      </Text>
      <View style={styles.trip_chip_row}>
        <Text style={styles.trip_chip}>{block_count} blocks</Text>
        <Text style={styles.trip_chip}>{anchor_count} anchors</Text>
        <Text style={styles.trip_chip}>{trip.idea_shelf.length} shelved</Text>
        {trip_cost > 0 && (
          <Text style={styles.trip_chip}>${Math.round(trip_cost).toLocaleString()}</Text>
        )}
      </View>
    </Pressable>
  );
}

function DoorRow({
  icon,
  icon_color,
  icon_bg,
  title,
  subtitle,
  on_press,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  icon_color: string;
  icon_bg: string;
  title: string;
  subtitle: string;
  on_press: () => void;
}) {
  return (
    <Pressable onPress={on_press} style={styles.door_row}>
      <View style={[styles.door_icon, { backgroundColor: icon_bg }]}>
        <MaterialCommunityIcons name={icon} size={18} color={icon_color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.door_title}>{title}</Text>
        <Text style={styles.door_subtitle}>{subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={16} color={color.ink_ghost} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const trips = use_trip_store((s) => s.trips);

  const upcoming = trips.filter((t) => days_until(t.end_date) >= 0).length;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.canvas }}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}>
      <View style={styles.header}>
        <View style={styles.row_between}>
          <Wordmark />
          <View style={styles.avatar}>
            <MaterialCommunityIcons name="account-outline" size={17} color={color.brand_text} />
          </View>
        </View>
        <Text style={styles.screen_title}>Your trips</Text>
        <Text style={styles.screen_subtitle}>
          {upcoming === 0 ? 'None upcoming' : upcoming === 1 ? 'One upcoming' : `${upcoming} upcoming`}
        </Text>
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingVertical: 12, gap: space.card_gap }}>
        {trips.length === 0 ? (
          <View style={styles.empty_card} testID="trips_empty">
            <MaterialCommunityIcons name="map-outline" size={22} color={color.ink_faint} />
            <Text style={styles.empty_title}>No trips yet</Text>
            <Text style={styles.empty_subtitle}>
              Start one below, build it yourself or let AI draft it
            </Text>
          </View>
        ) : (
          trips.map((trip) => <TripCard key={trip.id} trip={trip} />)
        )}
      </View>

      <View style={{ paddingHorizontal: space.gutter, paddingTop: 8 }}>
        <Text style={styles.section_label}>Start a new trip</Text>
        <View style={{ gap: space.card_gap }}>
          <DoorRow
            icon="pencil"
            icon_color={color.brand_text}
            icon_bg={color.brand_tint}
            title="Build it yourself"
            subtitle="Blank timeline, full control"
            on_press={() => router.push('/new_trip')}
          />
          <DoorRow
            icon="creation"
            icon_color={color.anchor}
            icon_bg={color.anchor_tint}
            title="Plan it for me"
            subtitle="A full draft from your tastes"
            on_press={() => router.push('/plan_ai')}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.gutter },
  row_between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.brand_tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar_text: { fontSize: 12, fontWeight: '500', color: color.brand_text_strong },
  screen_title: { fontSize: 22, fontWeight: '500', color: color.ink, marginTop: 18, marginBottom: 2 },
  screen_subtitle: { fontSize: 12, color: color.ink_muted },

  trip_card: { backgroundColor: color.anchor, borderRadius: radius.tile, paddingVertical: 16, paddingHorizontal: 18 },
  trip_eyebrow: { fontSize: 11, color: color.anchor_text_on_dark, letterSpacing: 1 },
  trip_title: { fontFamily: font.serif, fontSize: 24, color: color.white, marginTop: 10, marginBottom: 4 },
  trip_meta: { fontSize: 12, color: color.anchor_text_on_dark, marginBottom: 14 },
  trip_chip_row: { flexDirection: 'row', gap: 8 },
  trip_chip: {
    fontSize: 11,
    backgroundColor: color.anchor_text,
    color: color.anchor_tint,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.chip,
    overflow: 'hidden',
  },

  // DASHED BORDERS ARE RESERVED FOR EMPTY STATES (§3.0 SHAPE RULES).
  empty_card: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.handle,
    borderRadius: radius.tile,
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 24,
    gap: 4,
  },
  empty_title: { fontSize: 14, fontWeight: '500', color: color.ink_secondary, marginTop: 6 },
  empty_subtitle: { fontSize: 12, color: color.ink_muted, textAlign: 'center' },

  section_label: { fontSize: 13, fontWeight: '500', color: color.brand_text_strong, marginBottom: 10 },
  door_row: {
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  door_icon: { width: 38, height: 38, borderRadius: radius.row, alignItems: 'center', justifyContent: 'center' },
  door_title: { fontSize: 14, fontWeight: '500', color: color.ink },
  door_subtitle: { fontSize: 12, color: color.ink_muted, marginTop: 2 },
});
