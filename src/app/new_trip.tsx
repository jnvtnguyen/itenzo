import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back_button';
import { Text } from '@/components/text';
import { TripSetupFields, is_valid_iso_date } from '@/components/trip_setup_fields';
import type { CityResult } from '@/services/places_provider';
import { Wordmark } from '@/components/wordmark';
import { add_days } from '@/model/time';
import { use_trip_store } from '@/store/trip_store';
import { color, radius, space } from '@/theme/tokens';

function default_start_date(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

// THE "BUILD IT YOURSELF" DOOR (§3.3): NO MOCKUP OF ITS OWN — STYLED AFTER THE
// PLAN_IT_FOR_ME SETUP SCREEN, MINUS EVERYTHING AI.
export default function NewTripScreen() {
  const insets = useSafeAreaInsets();
  const create_trip = use_trip_store((s) => s.create_trip);

  const [title, set_title] = useState('');
  const [destination, set_destination] = useState('');
  const [picked_city, set_picked_city] = useState<CityResult | null>(null);
  const [start_date, set_start_date] = useState(default_start_date());
  const [day_count, set_day_count] = useState(5);
  const [travelers, set_travelers] = useState(1);

  // SAME RESOLUTION AS BLOCKS: A TYPED TITLE WINS; OTHERWISE THE PICKED CITY'S
  // SHORT NAME; OTHERWISE WHATEVER FREE TEXT SITS IN THE DESTINATION FIELD.
  const resolved_title = title.trim() || picked_city?.name || destination.trim();
  const can_create = resolved_title.length > 0 && is_valid_iso_date(start_date);

  const handle_create = () => {
    const trip_id = create_trip({
      title: resolved_title,
      destination: destination.trim(),
      anchor: picked_city?.coords,
      start_date,
      end_date: add_days(start_date, day_count - 1),
      travelers,
    });
    router.replace({ pathname: '/trip/[trip_id]', params: { trip_id } });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.canvas }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: space.gutter }}>
        <View style={styles.header_row}>
          <BackButton />
          <Wordmark size={15} />
        </View>
        <Text style={styles.screen_title}>Empty canvas</Text>
        <Text style={styles.screen_subtitle}>Name the place, pick the days, the timeline is yours</Text>

        <View style={{ marginTop: 20 }}>
          <TripSetupFields
            title={title}
            set_title={set_title}
            destination={destination}
            set_destination={set_destination}
            on_pick_city={set_picked_city}
            start_date={start_date}
            set_start_date={set_start_date}
            day_count={day_count}
            set_day_count={set_day_count}
            travelers={travelers}
            set_travelers={set_travelers}
          />
        </View>

        <Pressable
          disabled={!can_create}
          onPress={handle_create}
          style={[styles.cta, !can_create && { opacity: 0.4 }]}>
          <Text style={styles.cta_label}>Create trip</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header_row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  screen_title: { fontSize: 22, fontWeight: '500', color: color.ink, marginTop: 16, marginBottom: 2 },
  screen_subtitle: { fontSize: 12, color: color.ink_muted },
  cta: {
    backgroundColor: color.brand,
    borderRadius: radius.cta,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  cta_label: { fontSize: 15, fontWeight: '500', color: color.white },
  footnote: { fontSize: 11, color: color.ink_faint, textAlign: 'center', marginTop: 10 },
});
