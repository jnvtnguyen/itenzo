import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, hairline_width, radius, space } from '@/theme/tokens';
import { Text } from '@/components/text';
import { llm_is_live } from '@/services/llm';

// BOTTOM BAR (§3.0): PILL AI ASK FIELD + 42PX CIRCULAR BRAND FAB — MANUAL
// QUICK-ADD IS ALWAYS ONE TAP AWAY. THE PILL IS A *LAUNCHER*, NOT AN INPUT:
// TYPING HAPPENS IN THE AI SHEET, ABOVE THE KEYBOARD, WHERE YOU CAN SEE IT.
export function BottomBar({
  on_quick_add,
  on_ask,
}: {
  on_quick_add: () => void;
  on_ask: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [ai_note_visible, set_ai_note_visible] = useState(false);

  const open_ask = () => {
    // NO KEY CONFIGURED — SAY SO INSTEAD OF SILENTLY DOING NOTHING.
    if (!llm_is_live) {
      set_ai_note_visible(true);
      return;
    }
    on_ask();
  };

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + 10 }]}>
      {ai_note_visible && (
        <Text style={styles.ai_note}>
          Add an OpenRouter key to .env to wake the assistant — quick-add has you covered.
        </Text>
      )}
      <View style={styles.row}>
        <Pressable onPress={open_ask} style={styles.pill}>
          <MaterialCommunityIcons name="creation" size={16} color={color.brand} />
          <Text style={styles.pill_placeholder}>Looking for ideas for your trip?</Text>
        </Pressable>
        <Pressable onPress={on_quick_add} style={styles.fab}>
          <MaterialCommunityIcons name="plus" size={22} color={color.white} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: space.gutter,
    paddingTop: 8,
    backgroundColor: color.canvas,
    borderTopWidth: hairline_width,
    borderTopColor: color.hairline_soft,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: {
    flex: 1,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: color.card_surface,
    borderWidth: hairline_width,
    borderColor: color.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  pill_placeholder: { flex: 1, fontSize: 13, color: color.ink_faint },
  fab: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ai_note: { fontSize: 11, color: color.ink_muted, textAlign: 'center', marginBottom: 6 },
});
