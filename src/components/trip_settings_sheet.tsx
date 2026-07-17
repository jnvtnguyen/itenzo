import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FieldCard, Text, TextInput } from '@/components/text';
import { KeyboardSpacer, use_keyboard_reveal } from '@/components/use_keyboard_height';
import type { Trip } from '@/model/types';
import { places_provider, type CityResult } from '@/services/places_provider';
import { color, hairline_width, radius, space } from '@/theme/tokens';

export interface TripSettingsPatch {
  title: string;
  destination: string;
  anchor?: { lat: number; lng: number };
  travelers: number;
}

// TRIP SETTINGS: RENAME, RE-POINT THE DESTINATION (AND ITS SEARCH ANCHOR),
// ADJUST TRAVELERS, OR DELETE THE TRIP. SAME SHEET GRAMMAR AS THE COMPOSER.
export function TripSettingsSheet({
  trip,
  visible,
  instance_key,
  on_close,
  on_save,
  on_delete,
}: {
  trip: Trip;
  visible: boolean;
  // CHANGES ON EVERY OPEN SO THE FORM REMOUNTS WITH FRESH STATE (KEY-BASED
  // RESET, SAME PATTERN AS THE COMPOSER). THE FORM STAYS MOUNTED THROUGH THE
  // CLOSE FADE — UNMOUNTING ON visible=false MADE THE SHEET VANISH A FRAME
  // BEFORE THE BACKDROP DID (FLICKER).
  instance_key: number;
  on_close: () => void;
  on_save: (patch: TripSettingsPatch) => void;
  on_delete: () => void;
}) {
  return (
    // fade, NOT slide: THE SHEET SLIDES ITSELF UP (SEE sheet_ty) WHILE THE
    // DARK BACKDROP ONLY FADES — animationType="slide" DRAGGED THE BACKDROP
    // UP WITH THE SHEET, WHICH LOOKED BROKEN.
    <Modal visible={visible} transparent animationType="fade" onRequestClose={on_close}>
      <SettingsForm
        key={instance_key}
        trip={trip}
        on_close={on_close}
        on_save={on_save}
        on_delete={on_delete}
      />
    </Modal>
  );
}

function SettingsForm({
  trip,
  on_close,
  on_save,
  on_delete,
}: {
  trip: Trip;
  on_close: () => void;
  on_save: (patch: TripSettingsPatch) => void;
  on_delete: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [title, set_title] = useState(trip.title);
  const [destination, set_destination] = useState(trip.destination);
  const [travelers, set_travelers] = useState(trip.travelers);
  const [picked_city, set_picked_city] = useState<CityResult | null>(null);
  const [cities, set_cities] = useState<CityResult[]>([]);
  // DELETING IS THE ONE TRULY DESTRUCTIVE ACTION — IT ASKS TWICE.
  const [confirm_delete, set_confirm_delete] = useState(false);

  // KEYBOARD STORY (SHARED SHEET PATTERN — SEE use_keyboard_reveal): THE
  // SHEET NEVER MOVES; THE FIELD AREA GAINS SCROLL RANGE (VIA THE ANIMATED
  // KeyboardSpacer — THIS SHEET'S CONTENT IS SHORT, SO INSTANT PADDING MADE
  // IT JUMP) AND FOCUSED INPUTS SLIDE JUST CLEAR OF THE KEYBOARD.
  const { fields_ref, track_scroll, field_props } = use_keyboard_reveal();

  const city_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const city_seq = useRef(0);
  useEffect(
    () => () => {
      if (city_timer.current) clearTimeout(city_timer.current);
    },
    [],
  );

  const handle_destination = (value: string) => {
    set_destination(value);
    set_picked_city(null);
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
    Keyboard.dismiss();
    set_destination(c.full_name);
    set_picked_city(c);
    set_cities([]);
  };

  const can_save = title.trim().length > 0;
  const handle_save = () =>
    on_save({
      title: title.trim(),
      destination: destination.trim(),
      // ONLY A CONFIRMED PICK MOVES THE SEARCH ANCHOR — FREE-TEXT EDITS KEEP
      // THE OLD ONE RATHER THAN GUESSING.
      anchor: picked_city?.coords ?? trip.anchor,
      travelers,
    });

  // DRAG-TO-DISMISS ON THE SHEET HEADER (SEE block_composer FOR THE PATTERN).
  // STARTS OFF-SCREEN AND SLIDES UP ON MOUNT (THE MODAL ITSELF ONLY FADES).
  const sheet_ty = useSharedValue(900);
  useEffect(() => {
    sheet_ty.value = withTiming(0, { duration: 260 });
  }, [sheet_ty]);
  const sheet_style = useAnimatedStyle(() => ({ transform: [{ translateY: sheet_ty.value }] }));
  // GESTURE WORKLETS RUN AT EVENT TIME, NOT RENDER — THE IMMUTABILITY LINT
  // CAN'T SEE THAT.
  /* eslint-disable react-hooks/immutability */
  const dismiss_drag = Gesture.Pan()
    .onUpdate((e) => {
      sheet_ty.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 800) {
        sheet_ty.value = withTiming(900, { duration: 200 }, (done) => {
          if (done) runOnJS(on_close)();
        });
      } else {
        sheet_ty.value = withTiming(0, { duration: 160 });
      }
    });
  /* eslint-enable react-hooks/immutability */

  return (
    <GestureHandlerRootView style={styles.backdrop_wrap}>
      <Pressable style={styles.backdrop} onPress={on_close} />
      <View pointerEvents="box-none" style={styles.avoider}>
        <Animated.View style={[styles.sheet, sheet_style, { paddingBottom: insets.bottom + 16 }]}>
          <GestureDetector gesture={dismiss_drag}>
            <Pressable onPress={Keyboard.dismiss} style={styles.drag_header}>
              <View style={styles.handle} />
              <Text style={styles.sheet_title}>Trip Settings</Text>
              <Text style={styles.sheet_subtitle}>Rename it, move it, or let it go</Text>
            </Pressable>
          </GestureDetector>

          <ScrollView
            ref={fields_ref}
            bounces={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScroll={track_scroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            style={styles.fields_scroll}>
          <FieldCard {...field_props('title')} style={styles.field_card}>
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

          <FieldCard {...field_props('destination')} style={styles.field_card}>
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
              {picked_city != null && (
                <MaterialCommunityIcons name="map-marker-check-outline" size={18} color={color.anchor} />
              )}
            </View>
            {cities.length > 0 && (
              <View style={styles.city_list}>
                {cities.map((c, i) => (
                  <Pressable key={`${c.full_name}_${i}`} onPress={() => pick_city(c)} style={styles.city_row}>
                    <MaterialCommunityIcons name="map-marker-outline" size={14} color={color.ink_faint} />
                    <Text numberOfLines={1} style={styles.city_name}>
                      {c.full_name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={styles.dest_hint}>
              {picked_city
                ? 'Place search on this trip will look near here'
                : 'Pick from the list to move where searches look'}
            </Text>
          </FieldCard>

          <View style={styles.field_card}>
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
          <KeyboardSpacer />
          </ScrollView>

          <Pressable
            disabled={!can_save}
            onPress={handle_save}
            style={[styles.cta, !can_save && { opacity: 0.4 }]}>
            <Text style={styles.cta_label}>Save changes</Text>
          </Pressable>

          <Pressable
            onPress={() => (confirm_delete ? on_delete() : set_confirm_delete(true))}
            style={styles.delete_row}>
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={13}
              color={color.danger_text}
            />
            <Text style={styles.delete_label}>
              {confirm_delete ? 'Tap again to delete this trip' : 'Delete trip'}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  backdrop_wrap: { flex: 1, justifyContent: 'flex-end' },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(44, 44, 42, 0.35)',
  },
  sheet: {
    backgroundColor: color.canvas,
    borderTopLeftRadius: radius.surface,
    borderTopRightRadius: radius.surface,
    paddingHorizontal: space.gutter,
    paddingTop: 12,
    maxHeight: '100%',
  },
  drag_header: { paddingBottom: 12 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.handle,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheet_title: { fontSize: 16, fontWeight: '500', color: color.ink },
  sheet_subtitle: { fontSize: 12, color: color.ink_muted, marginTop: 4 },

  // flexShrink LETS THE KEYBOARD-PADDED CONTENT SCROLL WHILE THE HEADER AND
  // CTA STAY ON SCREEN (SAME PATTERN AS THE COMPOSER'S FIELD AREA).
  fields_scroll: { maxHeight: 430, flexGrow: 0, flexShrink: 1 },
  field_card: {
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: space.card_gap,
  },
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
  stepper_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  stepper_value: { fontSize: 14, color: color.ink },

  cta: {
    backgroundColor: color.brand,
    borderRadius: radius.cta,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  cta_label: { fontSize: 15, fontWeight: '500', color: color.white },
  delete_row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  delete_label: { fontSize: 12, color: color.danger_text },
});
