import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  ScrollView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/text';
import { KeyboardSpacer } from '@/components/use_keyboard_height';
import { fmt_duration, fmt_time, fmt_time_range } from '@/model/time';
import { ai_suggestions, type SuggestContext, type SuggestionCard } from '@/services/ai_suggest';
import { color, hairline_width, radius, space } from '@/theme/tokens';

// THE AI SHEET (PLAN §3.2). TWO DOORS, ONE SURFACE:
//  - gap MODE: OPENS ALREADY FETCHING IDEAS FOR THAT FREE WINDOW.
//  - ask MODE: OPENS AS A SEARCH EXPERIENCE — PROMINENT INPUT ABOVE THE
//    KEYBOARD, EXAMPLE ASKS, THEN RESULTS LOAD IN PLACE.
// CARDS ARE REAL PROVIDER PLACES RANKED BY THE LLM, EACH WITH ITS ONE-LINE
// "WHY"; THE FIRST CARD IS THE BEST FIT (2PX BRAND BORDER). EVERY SHEET
// OFFERS SHELVING, AND MANUAL ADD IS ONE TAP AWAY.

interface AiSheetProps {
  visible: boolean;
  // CHANGES PER OPEN — REMOUNTS THE CONTENT (AND RESETS THE SEARCH).
  instance_key: number;
  mode: 'gap' | 'ask';
  ctx: SuggestContext;
  on_close: () => void;
  on_add: (card: SuggestionCard) => void;
  on_shelve: (card: SuggestionCard) => void;
  on_manual: () => void;
}

const EXAMPLE_ASKS = ['Best coffee nearby', 'A rainy-day backup', 'Casual local dinner'];

export function AiSheet(props: AiSheetProps) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.on_close}>
      <SheetBody key={props.instance_key} {...props} />
    </Modal>
  );
}

function PulsingSparkle() {
  const pulse = useSharedValue(0.4);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View style={style}>
      <MaterialCommunityIcons name="creation" size={22} color={color.brand} />
    </Animated.View>
  );
}

function SheetBody({ mode, ctx, on_close, on_add, on_shelve, on_manual }: AiSheetProps) {
  const insets = useSafeAreaInsets();
  const [query, set_query] = useState('');
  const [cards, set_cards] = useState<SuggestionCard[] | null>(null);
  const [loading, set_loading] = useState(mode === 'gap');
  const [failed, set_failed] = useState(false);
  const [shelved, set_shelved] = useState<Set<number>>(new Set());
  // "MORE IDEAS" ROUNDS: EACH APPENDS FRESH CARDS AND WIDENS THE SEARCH NET.
  const [round, set_round] = useState(0);
  const [loading_more, set_loading_more] = useState(false);
  const [more_dry, set_more_dry] = useState(false);
  const last_query = useRef<string | undefined>(undefined);
  const run_seq = useRef(0);

  // SLIDE UP ON MOUNT; THE MODAL ITSELF ONLY FADES (SHARED SHEET GRAMMAR).
  const sheet_ty = useSharedValue(500);
  useEffect(() => {
    sheet_ty.value = withTiming(0, { duration: 260 });
  }, [sheet_ty]);
  const sheet_style = useAnimatedStyle(() => ({ transform: [{ translateY: sheet_ty.value }] }));

  // DRAG-TO-DISMISS ON THE SHEET HEADER (SAME PATTERN AS THE COMPOSER).
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

  // THE FETCH ITSELF — ALL setState HAPPENS AFTER THE AWAIT, SO THE MOUNT
  // EFFECT (GAP MODE, WHOSE INITIAL STATE IS ALREADY "LOADING") CAN CALL IT
  // WITHOUT A SYNCHRONOUS SETSTATE CASCADE.
  const fetch_cards = async (user_query?: string) => {
    const my = ++run_seq.current;
    const result = await ai_suggestions(ctx, user_query);
    // STALE-RESPONSE GUARD: ONLY THE LATEST ASK'S RESULTS RENDER.
    if (my !== run_seq.current) return;
    set_loading(false);
    if (result == null) set_failed(true);
    else set_cards(result);
  };

  const run = (user_query?: string) => {
    last_query.current = user_query;
    set_loading(true);
    set_failed(false);
    set_cards(null);
    set_shelved(new Set());
    set_round(0);
    set_more_dry(false);
    fetch_cards(user_query);
  };

  const fetch_more = async () => {
    if (cards == null || loading_more) return;
    const my = ++run_seq.current;
    set_loading_more(true);
    const next_round = round + 1;
    const result = await ai_suggestions(ctx, last_query.current, {
      round: next_round,
      exclude: {
        ids: cards.map((c) => c.place.place_id).filter((id): id is string => id != null),
        names: cards.map((c) => c.place.name),
      },
    });
    if (my !== run_seq.current) return;
    set_loading_more(false);
    if (result != null && result.length > 0) {
      set_round(next_round);
      set_cards([...cards, ...result]);
    } else {
      set_more_dry(true);
    }
  };

  useEffect(() => {
    // ALL setState INSIDE fetch_cards HAPPENS AFTER ITS AWAIT (AN ASYNC
    // CALLBACK, NOT A SYNCHRONOUS CASCADE) — THE LINT CAN'T SEE THAT.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode === 'gap') fetch_cards();
    // THE SHEET REMOUNTS PER OPEN (instance_key) — THE GAP FETCH RUNS ONCE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length === 0) return;
    Keyboard.dismiss();
    set_query(trimmed);
    run(trimmed);
  };

  const idle = mode === 'ask' && cards == null && !loading && !failed;
  const empty = failed || (cards != null && cards.length === 0);

  return (
    // RN Modal RENDERS OUTSIDE THE ROOT GestureHandlerRootView ON iOS, SO THE
    // SHEET NEEDS ITS OWN FOR THE DRAG-TO-DISMISS GESTURE TO REGISTER.
    <GestureHandlerRootView style={styles.backdrop_wrap}>
      <Pressable style={styles.backdrop} onPress={on_close} />
      <Animated.View style={[styles.sheet, sheet_style, { paddingBottom: insets.bottom + 16 }]}>
        <GestureDetector gesture={dismiss_drag}>
          {/* THE GRAB ZONE IS THE HANDLE STRIP — INPUTS BELOW STAY UNTOUCHED. */}
          <View style={styles.drag_zone}>
            <View style={styles.handle} />
          </View>
        </GestureDetector>

        {mode === 'ask' ? (
          <>
            <View style={styles.search_pill}>
              <MaterialCommunityIcons name="creation" size={16} color={color.brand} />
              <TextInput
                style={styles.search_input}
                value={query}
                onChangeText={set_query}
                placeholder="Ask for anything on this day"
                placeholderTextColor={color.ink_faint}
                autoFocus
                returnKeyType="send"
                onSubmitEditing={() => ask(query)}
              />
              {query.length > 0 && (
                <Pressable onPress={() => set_query('')} hitSlop={8}>
                  <MaterialCommunityIcons name="close-circle" size={17} color={color.ink_ghost} />
                </Pressable>
              )}
            </View>
            <Text style={styles.sheet_subtitle}>
              {ctx.destination ? `Real places near ${ctx.destination}` : 'Real places, never invented'}
            </Text>
          </>
        ) : (
          <>
            <View style={styles.title_row}>
              <MaterialCommunityIcons name="creation" size={15} color={color.brand} />
              <Text numberOfLines={1} style={styles.sheet_title}>
                Ideas for this gap
              </Text>
            </View>
            <Text style={styles.sheet_subtitle}>
              {ctx.gap
                ? `${fmt_time(ctx.gap.from_min)} – ${fmt_time(ctx.gap.to_min)} free${ctx.destination ? ` · ${ctx.destination}` : ''}`
                : ctx.destination}
            </Text>
          </>
        )}

        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.results_scroll}>
          {idle && (
            <View style={styles.examples_wrap}>
              <Text style={styles.examples_eyebrow}>TRY ASKING</Text>
              {EXAMPLE_ASKS.map((example) => (
                <Pressable key={example} onPress={() => ask(example)} style={styles.example_row}>
                  <MaterialCommunityIcons name="arrow-top-left" size={13} color={color.ink_faint} />
                  <Text style={styles.example_label}>{example}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {loading && (
            <View style={styles.state_wrap}>
              <PulsingSparkle />
              <Text style={styles.state_text}>Finding real places nearby…</Text>
            </View>
          )}

          {empty && !loading && (
            <View style={styles.state_wrap}>
              <MaterialCommunityIcons name="compass-off-outline" size={20} color={color.ink_faint} />
              <Text style={styles.state_text}>
                {failed
                  ? 'The assistant is unreachable right now — add something manually instead.'
                  : 'Nothing fitting found nearby — try asking differently, or add manually.'}
              </Text>
            </View>
          )}

          {cards?.map((card, i) => {
            const is_shelved = shelved.has(i);
            return (
              <View
                key={`${card.place.place_id ?? card.place.name}_${i}`}
                style={[styles.card, i === 0 && styles.card_best]}>
                {i === 0 && <Text style={styles.best_eyebrow}>BEST FIT</Text>}
                <Text numberOfLines={1} style={styles.card_name}>
                  {card.place.name}
                </Text>
                {card.place.address != null && (
                  <Text numberOfLines={1} style={styles.card_address}>
                    {card.place.address}
                  </Text>
                )}
                <Text numberOfLines={1} style={styles.card_meta}>
                  {fmt_time_range(card.start_time, card.start_time + card.duration_min)} ·{' '}
                  {fmt_duration(card.duration_min)}
                  {card.distance_mi != null ? ` · ${card.distance_mi} mi away` : ''}
                </Text>
                <View style={styles.why_row}>
                  <MaterialCommunityIcons name="creation" size={11} color={color.brand} />
                  <Text numberOfLines={2} style={styles.card_why}>
                    {card.why}
                  </Text>
                </View>
                <View style={styles.action_row}>
                  <Pressable onPress={() => on_add(card)} style={styles.add_button}>
                    <Text style={styles.add_label}>Add at {fmt_time(card.start_time)}</Text>
                  </Pressable>
                  <Pressable
                    disabled={is_shelved}
                    onPress={() => {
                      set_shelved((prev) => new Set(prev).add(i));
                      on_shelve(card);
                    }}
                    style={styles.shelve_button}>
                    <MaterialCommunityIcons
                      name={is_shelved ? 'bookmark-check' : 'bookmark-outline'}
                      size={13}
                      color={is_shelved ? color.anchor : color.ink_muted}
                    />
                    <Text style={[styles.shelve_label, is_shelved && { color: color.anchor }]}>
                      {is_shelved ? 'Shelved' : 'Shelve'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          {/* MORE IDEAS: FRESH OPTIONS, WIDER NET EACH ROUND. */}
          {cards != null && cards.length > 0 && !more_dry && (
            <Pressable disabled={loading_more} onPress={fetch_more} style={styles.more_button}>
              {loading_more ? (
                <>
                  <PulsingSparkle />
                  <Text style={styles.more_label}>Casting a wider net…</Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons name="creation" size={13} color={color.brand_text} />
                  <Text style={styles.more_label}>More ideas</Text>
                </>
              )}
            </Pressable>
          )}
          {more_dry && (
            <Text style={styles.more_dry}>
              That&apos;s everything nearby worth suggesting — try a different ask.
            </Text>
          )}
        </ScrollView>

        <Pressable onPress={on_manual} style={styles.manual_row}>
          <MaterialCommunityIcons name="plus" size={13} color={color.ink_muted} />
          <Text style={styles.manual_label}>Add manually instead</Text>
        </Pressable>

        {/* GROWS WITH THE KEYBOARD SO THE SEARCH EXPERIENCE SITS ABOVE IT. */}
        <KeyboardSpacer extra={0} />
      </Animated.View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  backdrop_wrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(44, 44, 42, 0.35)',
  },
  // maxHeight CAPS THE SHEET AT THE SCREEN: WITH RESULTS LOADED *AND* THE
  // KEYBOARD SPACER GROWN, THE RESULTS AREA (flexShrink BELOW) COMPRESSES
  // INSTEAD OF THE WHOLE SHEET SHOVING THE SEARCH BAR OFF THE TOP.
  sheet: {
    backgroundColor: color.canvas,
    borderTopLeftRadius: radius.surface,
    borderTopRightRadius: radius.surface,
    paddingHorizontal: space.gutter,
    paddingTop: 12,
    maxHeight: '100%',
  },
  // GENEROUS PADDING SO THE WHOLE STRIP AROUND THE HANDLE IS GRABBABLE.
  drag_zone: { paddingVertical: 6, marginTop: -6, marginBottom: 8 },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.handle,
    alignSelf: 'center',
  },

  // THE ASK PILL — SAME GRAMMAR AS THE BOTTOM BAR'S, NOW ABOVE THE KEYBOARD.
  search_pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.brand_border,
    paddingHorizontal: 14,
  },
  search_input: { flex: 1, fontSize: 14, color: color.ink, paddingVertical: 0 },

  title_row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheet_title: { flex: 1, fontSize: 16, fontWeight: '500', color: color.ink },
  sheet_subtitle: { fontSize: 12, color: color.ink_muted, marginTop: 8, marginBottom: 12 },

  results_scroll: { maxHeight: 420, flexGrow: 0, flexShrink: 1 },

  examples_wrap: { paddingBottom: 6 },
  examples_eyebrow: {
    fontSize: 10,
    letterSpacing: 1,
    color: color.ink_faint,
    marginBottom: 4,
  },
  example_row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
  example_label: { fontSize: 13, color: color.ink_secondary },

  state_wrap: { alignItems: 'center', gap: 8, paddingVertical: 26 },
  state_text: { fontSize: 12, color: color.ink_muted, textAlign: 'center', maxWidth: 260 },

  card: {
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: space.card_gap,
  },
  // THE RECOMMENDED CARD LEADS WITH A 2PX BRAND BORDER (§3.0 AI GRAMMAR).
  card_best: { borderWidth: 2, borderColor: color.brand_border },
  best_eyebrow: {
    fontSize: 10,
    letterSpacing: 1,
    color: color.brand_text_strong,
    marginBottom: 3,
  },
  card_name: { fontSize: 14, fontWeight: '500', color: color.ink },
  card_address: { fontSize: 11, color: color.ink_faint, marginTop: 1 },
  card_meta: { fontSize: 11, color: color.ink_muted, marginTop: 3 },
  why_row: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 7 },
  card_why: { flex: 1, fontSize: 11, color: color.brand_text },

  action_row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  add_button: {
    backgroundColor: color.brand,
    borderRadius: radius.chip,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  add_label: { fontSize: 12, fontWeight: '500', color: color.white },
  shelve_button: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  shelve_label: { fontSize: 12, color: color.ink_muted },

  manual_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  manual_label: { fontSize: 12, color: color.ink_muted },

  more_button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.brand_border,
    borderRadius: radius.card,
    paddingVertical: 10,
    marginBottom: space.card_gap,
  },
  more_label: { fontSize: 12, fontWeight: '500', color: color.brand_text },
  more_dry: {
    fontSize: 11,
    color: color.ink_faint,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
