import { Inter_400Regular, Inter_500Medium } from '@expo-google-fonts/inter';
import { YoungSerif_400Regular, useFonts } from '@expo-google-fonts/young-serif';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { color } from '@/theme/tokens';

export default function RootLayout() {
  const [fonts_loaded] = useFonts({
    YoungSerif_400Regular,
    Inter_400Regular,
    Inter_500Medium,
  });
  if (!fonts_loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.canvas },
        }}
      />
    </GestureHandlerRootView>
  );
}
