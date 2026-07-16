
import { color, font } from '@/theme/tokens';
import { Text } from '@/components/text';

export function Wordmark({ size = 18, on_dark = false }: { size?: number; on_dark?: boolean }) {
  return (
    <Text style={{ fontFamily: font.serif, fontSize: size, color: on_dark ? color.white : color.brand_ink }}>
      Itenzo
    </Text>
  );
}
