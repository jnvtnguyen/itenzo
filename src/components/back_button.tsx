import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { color } from '@/theme/tokens';

// BACK FALLS THROUGH TO THE HOME SCREEN WHEN THERE'S NO HISTORY — E.G. A WEB
// REFRESH OR A DEEP LINK STRAIGHT INTO A TRIP — INSTEAD OF DOING NOTHING.
export function BackButton() {
  const handle_press = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <Pressable onPress={handle_press} hitSlop={8}>
      <MaterialCommunityIcons name="arrow-left" size={18} color={color.brand_text} />
    </Pressable>
  );
}
