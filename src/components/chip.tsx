import { View } from 'react-native';

import type { ChipKind } from '@/model/types';
import { color, hairline_width, radius } from '@/theme/tokens';
import { Text } from '@/components/text';

const chip_styles: Record<ChipKind, { bg: string; fg: string; border?: string }> = {
  anchor: { bg: color.anchor_tint, fg: color.anchor_text },
  meal: { bg: color.meal_tint, fg: color.meal_text },
  danger: { bg: color.danger_tint, fg: color.danger_text },
  neutral: { bg: color.card_surface, fg: color.ink_muted, border: color.hairline },
};

export function StatusChip({ label, kind }: { label: string; kind: ChipKind }) {
  const s = chip_styles[kind];
  return (
    <View
      style={{
        backgroundColor: s.bg,
        paddingVertical: 3,
        paddingHorizontal: 9,
        borderRadius: radius.chip,
        borderWidth: s.border ? hairline_width : 0,
        borderColor: s.border,
        alignSelf: 'flex-start',
      }}>
      <Text style={{ fontSize: 11, color: s.fg }}>{label}</Text>
    </View>
  );
}
