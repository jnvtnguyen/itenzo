import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/back_button';
import { Text } from '@/components/text';
import { TripSetupFields, is_valid_iso_date } from '@/components/trip_setup_fields';
import { Wordmark } from '@/components/wordmark';
import { add_days } from '@/model/time';
import type { Preferences } from '@/model/types';
import type { CityResult } from '@/services/places_provider';
import { use_trip_store } from '@/store/trip_store';
import { color, hairline_width, radius, space } from '@/theme/tokens';

const PACE_OPTIONS: Preferences['pace'][] = ['relaxed', 'balanced', 'packed'];
const PACE_LABELS: Record<Preferences['pace'], string> = {
  relaxed: 'Relaxed',
  balanced: 'Balanced',
  packed: 'Packed',
};

const INTEREST_OPTIONS: { key: string; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: 'food', label: 'Food', icon: 'silverware-fork-knife' },
  { key: 'history', label: 'History', icon: 'bank-outline' },
  { key: 'art', label: 'Art', icon: 'palette-outline' },
  { key: 'walkable', label: 'Walkable', icon: 'walk' },
  { key: 'nightlife', label: 'Nightlife', icon: 'weather-night' },
  { key: 'outdoors', label: 'Outdoors', icon: 'pine-tree' },
  { key: 'with_kids', label: 'With kids', icon: 'baby-face-outline' },
];

function default_start_date(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

// THE "PLAN IT FOR ME" DOOR (PLAN_IT_FOR_ME MOCKUP). THE DRAFT GENERATOR IS THE
// WEEK-6 AI LAYER; TODAY THIS SAVES TASTES AND OPENS THE (EMPTY) TIMELINE —
// SAME MANUAL PRIMITIVES THE GENERATOR WILL WRITE THROUGH LATER.
export default function PlanAiScreen() {
  const insets = useSafeAreaInsets();
  const create_trip = use_trip_store((s) => s.create_trip);

  const [title, set_title] = useState('');
  const [destination, set_destination] = useState('');
  const [picked_city, set_picked_city] = useState<CityResult | null>(null);
  const [start_date, set_start_date] = useState(default_start_date());
  const [day_count, set_day_count] = useState(5);
  const [travelers, set_travelers] = useState(1);
  const [pace, set_pace] = useState<Preferences['pace']>('balanced');
  const [interests, set_interests] = useState<string[]>(['food', 'history', 'walkable']);
  const [budget_tier, set_budget_tier] = useState<Preferences['budget_tier']>(2);

  const resolved_title = title.trim() || picked_city?.name || destination.trim();
  const can_create = resolved_title.length > 0 && is_valid_iso_date(start_date);

  const toggle_interest = (key: string) =>
    set_interests((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const handle_create = () => {
    const trip_id = create_trip({
      title: resolved_title,
      destination: destination.trim(),
      anchor: picked_city?.coords,
      start_date,
      end_date: add_days(start_date, day_count - 1),
      travelers,
      preferences: { pace, budget_tier, interests },
    });
    router.replace({ pathname: '/trip/[trip_id]', params: { trip_id } });
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.canvas }}
      // FIRST TAP ON A CITY SUGGESTION SELECTS IT — WITHOUT THIS, A TAP WHILE
      // THE KEYBOARD IS UP ONLY DISMISSES THE KEYBOARD.
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}>
      <View style={{ paddingHorizontal: space.gutter }}>
        <View style={styles.header_row}>
          <BackButton />
          <Wordmark size={15} />
        </View>
        <Text style={styles.screen_title}>
          {resolved_title ? `${resolved_title}, your way` : 'Your trip, your way'}
        </Text>
        <Text style={styles.screen_subtitle}>Tell us your tastes, get a full draft</Text>

        <View style={{ marginTop: 16 }}>
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

        <Text style={styles.section_label}>Pace</Text>
        <View style={styles.segment_wrap}>
          {PACE_OPTIONS.map((option) => {
            const selected = option === pace;
            return (
              <Pressable
                key={option}
                onPress={() => set_pace(option)}
                style={[styles.segment, selected && styles.segment_selected]}>
                <Text style={[styles.segment_label, selected && styles.segment_label_selected]}>
                  {PACE_LABELS[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section_label}>Interests</Text>
        <View style={styles.chip_wrap}>
          {INTEREST_OPTIONS.map((option) => {
            const selected = interests.includes(option.key);
            return (
              <Pressable
                key={option.key}
                onPress={() => toggle_interest(option.key)}
                style={[styles.interest_chip, selected && styles.interest_chip_selected]}>
                <MaterialCommunityIcons
                  name={option.icon}
                  size={14}
                  color={selected ? color.brand_text_strong : color.ink_muted}
                />
                <Text style={[styles.interest_label, selected && styles.interest_label_selected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.section_label}>Budget</Text>
        <View style={{ flexDirection: 'row', gap: space.card_gap }}>
          {([1, 2, 3] as const).map((tier) => {
            const selected = tier === budget_tier;
            return (
              <Pressable
                key={tier}
                onPress={() => set_budget_tier(tier)}
                style={[styles.budget_tile, selected && styles.budget_tile_selected]}>
                <Text style={[styles.budget_label, selected && styles.budget_label_selected]}>
                  {'$'.repeat(tier)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          disabled={!can_create}
          onPress={handle_create}
          style={[styles.cta, !can_create && { opacity: 0.4 }]}>
          <MaterialCommunityIcons name="creation" size={15} color={color.white} />
          <Text style={styles.cta_label}>
            Draft my trip
          </Text>
        </Pressable>
        <Text style={styles.footnote}>Every block stays fully editable</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header_row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  screen_title: { fontSize: 22, fontWeight: '500', color: color.ink, marginTop: 16, marginBottom: 2 },
  screen_subtitle: { fontSize: 12, color: color.ink_muted },
  section_label: {
    fontSize: 13,
    fontWeight: '500',
    color: color.brand_text_strong,
    marginTop: 20,
    marginBottom: 10,
  },

  segment_wrap: {
    flexDirection: 'row',
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11 },
  segment_selected: { backgroundColor: color.brand },
  segment_label: { fontSize: 13, color: color.ink_muted },
  segment_label_selected: { color: color.white, fontWeight: '500' },

  chip_wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.card_gap },
  interest_chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
  },
  interest_chip_selected: { backgroundColor: color.brand_tint, borderColor: color.brand_border },
  interest_label: { fontSize: 13, color: color.ink_muted },
  interest_label_selected: { color: color.brand_text_strong },

  budget_tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.card,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
  },
  budget_tile_selected: { backgroundColor: color.brand_tint, borderColor: color.brand_border },
  budget_label: { fontSize: 13, color: color.ink_muted },
  budget_label_selected: { color: color.brand_text_strong, fontWeight: '500' },

  cta: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    backgroundColor: color.brand,
    borderRadius: radius.cta,
    paddingVertical: 14,
    marginTop: 28,
  },
  cta_label: { fontSize: 15, fontWeight: '500', color: color.white },
  footnote: { fontSize: 11, color: color.ink_faint, textAlign: 'center', marginTop: 10 },
});
