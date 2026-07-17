import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';

import { add_days } from '@/model/time';
import { FieldCard, Text, TextInput } from '@/components/text';
import { places_provider, type CityResult } from '@/services/places_provider';
import { color, hairline_width, radius, space } from '@/theme/tokens';

export function is_valid_iso_date(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// SHARED TITLE + DESTINATION + DATE + LENGTH FIELDS FOR BOTH TRIP-CREATION
// DOORS — SAME SHAPE AS THE BLOCK COMPOSER: A FREE-TEXT TITLE PLUS AN
// OPTIONAL PLACE SEARCH. PICKING A CITY CAPTURES ITS COORDS (THE SEARCH
// ANCHOR FOR THE WHOLE TRIP) AND AUTOFILLS AN UNTOUCHED TITLE WITH THE SHORT
// NAME ("Boston" — NOT "Boston, Massachusetts, United States").
export function TripSetupFields({
  title,
  set_title,
  destination,
  set_destination,
  on_pick_city,
  start_date,
  set_start_date,
  day_count,
  set_day_count,
  travelers,
  set_travelers,
}: {
  title: string;
  set_title: (v: string) => void;
  destination: string;
  set_destination: (v: string) => void;
  // A CONFIRMED CITY PICK (SHORT NAME + FULL LABEL + COORDS); NULL WHEN THE
  // USER EDITS THE TEXT AFTERWARD — THE PICK MUST ALWAYS MATCH THE SHOWN TEXT.
  on_pick_city?: (city: CityResult | null) => void;
  start_date: string;
  set_start_date: (v: string) => void;
  day_count: number;
  set_day_count: (v: number) => void;
  travelers: number;
  set_travelers: (v: number) => void;
}) {
  const date_valid = is_valid_iso_date(start_date);

  const [cities, set_cities] = useState<CityResult[]>([]);
  const [picked, set_picked] = useState(false);
  const city_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const city_seq = useRef(0);
  // THE LAST TITLE WE AUTOFILLED — A LATER PICK MAY REPLACE IT, BUT A TITLE
  // THE USER TYPED THEMSELVES IS NEVER OVERWRITTEN.
  const autofilled_title = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (city_timer.current) clearTimeout(city_timer.current);
    },
    [],
  );

  const handle_destination = (value: string) => {
    set_destination(value);
    // ANY EDIT CLEARS A PRIOR PICK — THE ANCHOR MUST MATCH THE SHOWN TEXT.
    if (picked) {
      set_picked(false);
      on_pick_city?.(null);
    }
    if (city_timer.current) clearTimeout(city_timer.current);
    const q = value.trim();
    if (q.length < 2) {
      set_cities([]);
      return;
    }
    const seq = ++city_seq.current;
    city_timer.current = setTimeout(async () => {
      const results = await places_provider.search_cities(q);
      if (seq === city_seq.current) set_cities(results);
    }, 250);
  };

  const pick_city = (c: CityResult) => {
    // PICKING ENDS THE TYPING — SELECT AND PUT THE KEYBOARD AWAY IN ONE TAP.
    Keyboard.dismiss();
    set_destination(c.full_name);
    on_pick_city?.(c);
    set_picked(true);
    set_cities([]);
    if (title.trim().length === 0 || title === autofilled_title.current) {
      autofilled_title.current = c.name;
      set_title(c.name);
    }
  };

  return (
    <View style={{ gap: space.card_gap }}>
      <FieldCard style={styles.field_card} focus_style={styles.field_focus}>
        <Text style={styles.field_eyebrow}>TITLE</Text>
        <TextInput
          style={styles.field_input}
          value={title}
          onChangeText={set_title}
          placeholder="Summer in Boston"
          placeholderTextColor={color.ink_faint}
          autoCapitalize="words"
        />
      </FieldCard>

      <FieldCard style={styles.field_card} focus_style={styles.field_focus}>
        <View style={styles.dest_eyebrow_row}>
          <MaterialCommunityIcons name="magnify" size={11} color={color.ink_faint} />
          <Text style={styles.field_eyebrow}>DESTINATION · OPTIONAL</Text>
        </View>
        <View style={styles.dest_row}>
          <TextInput
            style={[styles.field_input, { flex: 1, fontSize: 13 }]}
            value={destination}
            onChangeText={handle_destination}
            placeholder="Search a city or region"
            placeholderTextColor={color.ink_faint}
            autoCapitalize="words"
          />
          {picked && (
            <MaterialCommunityIcons name="map-marker-check-outline" size={18} color={color.anchor} />
          )}
        </View>
        {cities.length > 0 && (
          <View style={styles.city_list}>
            {cities.map((c, i) => (
              <Pressable
                key={`${c.full_name}_${i}`}
                onPress={() => pick_city(c)}
                testID={`city_${i}`}
                style={styles.city_row}>
                <MaterialCommunityIcons name="map-marker-outline" size={14} color={color.ink_faint} />
                <Text numberOfLines={1} style={styles.city_name}>
                  {c.full_name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.dest_hint}>
          {picked
            ? 'Place search on this trip will look near here'
            : 'Picking a place points searches at the right city'}
        </Text>
      </FieldCard>

      <FieldCard style={[styles.field_card, !date_valid && styles.field_invalid]}>
          <View style={styles.date_eyebrow_row}>
            <Text style={styles.field_eyebrow}>FIRST DAY</Text>
            {date_valid && (
              <View style={styles.date_steppers}>
                <Pressable onPress={() => set_start_date(add_days(start_date, -1))} hitSlop={6}>
                  <MaterialCommunityIcons name="chevron-left" size={16} color={color.brand_text} />
                </Pressable>
                <Pressable onPress={() => set_start_date(add_days(start_date, 1))} hitSlop={6}>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={color.brand_text} />
                </Pressable>
              </View>
            )}
          </View>
          <TextInput
            style={styles.field_input}
            value={start_date}
            onChangeText={set_start_date}
            placeholder="2026-08-12"
            placeholderTextColor={color.ink_faint}
            autoCapitalize="none"
          />
      </FieldCard>

      <View style={styles.row}>
        <View style={[styles.field_card, { flex: 1 }]}>
          <Text style={styles.field_eyebrow}>DAYS</Text>
          <View style={styles.stepper_row}>
            <Pressable onPress={() => set_day_count(Math.max(1, day_count - 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={color.brand_text} />
            </Pressable>
            <Text style={styles.stepper_value}>{day_count}</Text>
            <Pressable onPress={() => set_day_count(Math.min(30, day_count + 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-right" size={18} color={color.brand_text} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.field_card, { flex: 1 }]}>
          <Text style={styles.field_eyebrow}>TRAVELERS</Text>
          <View style={styles.stepper_row}>
            <Pressable onPress={() => set_travelers(Math.max(1, travelers - 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={color.brand_text} />
            </Pressable>
            <Text style={styles.stepper_value}>{travelers}</Text>
            <Pressable onPress={() => set_travelers(Math.min(16, travelers + 1))} hitSlop={8}>
              <MaterialCommunityIcons name="chevron-right" size={18} color={color.brand_text} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.card_gap },
  field_card: {
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  field_focus: { borderColor: color.brand_border },
  field_invalid: { borderColor: color.danger_border },
  field_eyebrow: { fontSize: 11, color: color.ink_faint, letterSpacing: 0.5 },
  field_input: { fontSize: 14, color: color.ink, marginTop: 3, paddingVertical: 0 },
  dest_eyebrow_row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dest_row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dest_hint: { fontSize: 11, color: color.ink_faint, marginTop: 8 },
  city_list: { marginTop: 8, borderTopWidth: hairline_width, borderTopColor: color.hairline },
  city_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderBottomWidth: hairline_width,
    borderBottomColor: color.hairline_soft,
  },
  city_name: { flex: 1, fontSize: 13, color: color.ink },
  date_eyebrow_row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date_steppers: { flexDirection: 'row', gap: 10 },
  stepper_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  stepper_value: { fontSize: 14, color: color.ink },
});
