import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { color, font } from '@/theme/tokens';

// THEMED TEXT PRIMITIVES: EVERY UI STRING RENDERS IN NUNITO (§3.0 TYPOGRAPHY),
// WITH fontWeight '500' MAPPED TO THE MEDIUM FACE — SO STYLESHEETS KEEP USING
// PLAIN fontWeight AND NEVER NAME FONT FILES. AN EXPLICIT fontFamily (E.G. THE
// SERIF WORDMARK) ALWAYS WINS UNTOUCHED.
function with_sans(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily) return style;
  const is_medium = flat.fontWeight === '500' || flat.fontWeight === 500;
  const themed: TextStyle = {
    ...flat,
    fontFamily: is_medium ? font.sans_medium : font.sans,
  };
  // THE LOADED FACE ALREADY CARRIES THE WEIGHT; A LINGERING fontWeight MAKES
  // NATIVE PLATFORMS SYNTHESIZE FAUX BOLD ON TOP OF IT.
  delete themed.fontWeight;
  return themed;
}

export function Text({ style, ...props }: TextProps) {
  // NON-SELECTABLE BY DEFAULT: ON WEB, TEXT SELECTION OTHERWISE CAPTURES THE
  // POINTER MID-DRAG AND BREAKS TIMELINE GESTURES.
  return <RNText selectable={false} {...props} style={with_sans(style)} />;
}

// FOCUS PLUMBING: A TEXTINPUT INSIDE A FieldCard REPORTS ITS FOCUS UPWARD SO
// THE CARD'S BORDER — NOT THE RAW INPUT — CARRIES THE FOCUS TREATMENT, AND
// REGISTERS A focus() HANDLE SO TAPPING *ANYWHERE* ON THE CARD (LABEL,
// PADDING, HINT TEXT) FOCUSES THE INPUT — A BARE INPUT LINE IS A TINY TARGET.
const FieldFocusContext = createContext<{
  notify: (focused: boolean) => void;
  register: (focus: (() => void) | null) => void;
} | null>(null);

export function TextInput({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const field = useContext(FieldFocusContext);
  return (
    <RNTextInput
      {...props}
      ref={(input) => {
        field?.register(input ? () => input.focus() : null);
      }}
      onFocus={(e) => {
        field?.notify(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        field?.notify(false);
        onBlur?.(e);
      }}
      // KILL THE BROWSER'S NATIVE FOCUS RING ON WEB — FieldCard'S BORDER IS
      // THE FOCUS INDICATOR INSTEAD.
      style={[with_sans(style as StyleProp<TextStyle>), no_outline]}
    />
  );
}

// WRAPS A FORM FIELD'S CARD: WHEN ANY THEMED TEXTINPUT INSIDE IS FOCUSED THE
// CARD BORDER TURNS BRAND (OR A CALLER-SUPPLIED focus_style). on_focus_change
// + on_layout LET A PARENT SCROLL THE WHOLE CARD INTO VIEW ABOVE THE KEYBOARD.
export function FieldCard({
  style,
  focus_style,
  on_focus_change,
  on_layout,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  focus_style?: StyleProp<ViewStyle>;
  on_focus_change?: (focused: boolean) => void;
  on_layout?: ViewProps['onLayout'];
  children: ReactNode;
}) {
  const [focused, set_focused] = useState(false);
  // REF WRITES/READS HAPPEN IN REF CALLBACKS AND PRESS HANDLERS (COMMIT/EVENT
  // TIME), NEVER DURING RENDER.
  const input_focus = useRef<(() => void) | null>(null);
  const field_ctx = {
    notify: (next: boolean) => {
      set_focused(next);
      on_focus_change?.(next);
    },
    register: (focus: (() => void) | null) => {
      input_focus.current = focus;
    },
  };
  const focus_input = () => input_focus.current?.();
  return (
    <FieldFocusContext.Provider value={field_ctx}>
      {/* THE WHOLE CARD IS THE TAP TARGET — TAPS THAT MISS THE INPUT ITSELF
          (EYEBROW, PADDING) STILL FOCUS IT. CHILD PRESSABLES (SUGGESTION
          ROWS, STEPPERS) STILL WIN THEIR OWN TAPS. */}
      <Pressable
        onPress={focus_input}
        onLayout={on_layout}
        style={[style, focused && (focus_style ?? styles.focused)]}>
        {children}
      </Pressable>
    </FieldFocusContext.Provider>
  );
}

// 'none' IS A WEB-ONLY OUTLINE VALUE REACT-NATIVE-WEB ACCEPTS BUT RN'S TYPES
// DON'T ADMIT — WIDTH 0 ALONE STILL LEAVES CHROME'S outline-style:auto RING.
const no_outline = { outlineStyle: 'none', outlineWidth: 0 } as unknown as TextStyle;

const styles = StyleSheet.create({
  focused: { borderColor: color.brand_border },
});
