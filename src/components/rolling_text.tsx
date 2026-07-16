import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/text';

const ROLL_MS = 0;
const ROLL_PX = 5;

// LIVE-VALUE TEXT THAT ROLLS INSTEAD OF FLICKERING: WHEN THE TEXT CHANGES THE
// OLD VALUE FADES UP AND OUT WHILE THE NEW ONE FADES IN FROM BELOW — USED FOR
// THE TIMES THAT TICK THROUGH SNAP STEPS DURING A MOVE OR RESIZE.
export function RollingText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  // RENDER-TIME RECONCILIATION (REACT'S SANCTIONED "DERIVED STATE" PATTERN):
  // A NEW TEXT PROP DEMOTES THE CURRENT VALUE TO THE OUTGOING LAYER.
  const [display, set_display] = useState({ cur: text, prev: null as string | null });
  if (display.cur !== text) set_display({ cur: text, prev: display.cur });

  const progress = useSharedValue(1);
  useEffect(() => {
    if (display.prev == null) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: ROLL_MS });
    // UNMOUNT THE OUTGOING LAYER ONCE THE ROLL FINISHES — INVISIBLE STALE
    // TEXT MUST NOT LINGER IN THE TREE.
    const timer = setTimeout(
      () => set_display((d) => (d.prev == null ? d : { ...d, prev: null })),
      ROLL_MS + 40,
    );
    return () => clearTimeout(timer);
  }, [display, progress]);

  const in_style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ROLL_PX }],
  }));
  const out_style = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateY: -progress.value * ROLL_PX }],
  }));

  return (
    <View>
      <Animated.View style={in_style}>
        <Text numberOfLines={1} style={style}>
          {display.cur}
        </Text>
      </Animated.View>
      {display.prev != null && (
        <Animated.View pointerEvents="none" style={[styles.prev, out_style]}>
          <Text numberOfLines={1} style={style}>
            {display.prev}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // THE OUTGOING LAYER OVERLAYS THE INCOMING ONE EDGE-TO-EDGE SO LEFT- AND
  // RIGHT-ALIGNED TIMES BOTH LINE UP DURING THE CROSSFADE.
  prev: { position: 'absolute', left: 0, right: 0, top: 0 },
});
