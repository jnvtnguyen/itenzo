// THE HOOKS LINT ONLY RECOGNIZES CAMELCASE "useX" NAMES; THIS PROJECT IS
// snake_case THROUGHOUT (SEE use_trip, use_trip_store). THE RULES STILL HOLD:
// CALL THIS ONLY FROM COMPONENT/HOOK TOP LEVEL.
/* eslint-disable react-hooks/rules-of-hooks */
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  Platform,
  TextInput as NativeTextInput,
  type ScrollView,
} from 'react-native';

// LIVE KEYBOARD HEIGHT (0 WHEN HIDDEN). SHEETS ADD THIS AS BOTTOM PADDING ON
// THEIR FIELD SCROLL AREAS SO *EVERY* CARD — INCLUDING THE LAST ONE — HAS
// ENOUGH SCROLL RANGE TO SIT FULLY ABOVE THE KEYBOARD. (THE BUILT-IN
// automaticallyAdjustKeyboardInsets ONLY ADDS THE KEYBOARD'S OVERLAP WITH THE
// SCROLL FRAME, WHICH LEAVES BOTTOM FIELDS UNREACHABLE.)
export function use_keyboard_height(): number {
  const [height, set_height] = useState(0);
  useEffect(() => {
    // iOS "WILL" EVENTS FIRE BEFORE THE ANIMATION, SO THE PADDING IS IN PLACE
    // BY THE TIME THE REVEAL SCROLL RUNS.
    const show_event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide_event = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(show_event, (e) => set_height(e.endCoordinates.height));
    const hide = Keyboard.addListener(hide_event, () => set_height(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

// THE FULL SHEET KEYBOARD STORY, SHARED BY EVERY MODAL WITH TEXT FIELDS
// (COMPOSER, TRIP SETTINGS): THE SHEET NEVER MOVES; THE FIELD SCROLL AREA
// GAINS KEYBOARD-HEIGHT BOTTOM PADDING (SCROLL RANGE), AND FOCUSING AN INPUT
// SCROLLS *JUST ENOUGH* THAT THE FIELD CLEARS THE KEYBOARD WITH A LITTLE
// PADDING. THE FOCUSED INPUT IS MEASURED IN WINDOW COORDINATES AT FOCUS TIME,
// SO NESTING (FIELDS INSIDE ROW VIEWS) IS IRRELEVANT.
//
// WIRE-UP: PUT fields_ref/track_scroll ON THE FIELDS ScrollView, ADD THE
// KEYBOARD-HEIGHT BOTTOM PADDING WHILE keyboard_height > 0, AND SPREAD
// field_props() ONTO EACH FieldCard.
export function use_keyboard_reveal() {
  const keyboard_height = use_keyboard_height();
  const kb_ref = useRef(0);
  useEffect(() => {
    kb_ref.current = keyboard_height;
  }, [keyboard_height]);
  const fields_ref = useRef<ScrollView>(null);
  const scroll_y_ref = useRef(0);
  // THESE CALLBACKS FIRE AT SCROLL/FOCUS EVENT TIME, NOT DURING RENDER.
  const track_scroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scroll_y_ref.current = e.nativeEvent.contentOffset.y;
  };
  // THE DELAY WAITS OUT THE KEYBOARD ANIMATION SO THE MEASUREMENT SEES FINAL
  // GEOMETRY.
  const reveal_focused = () => {
    setTimeout(() => {
      const input = NativeTextInput.State.currentlyFocusedInput?.();
      const scroller = fields_ref.current;
      if (input?.measureInWindow == null || !scroller) return;
      input.measureInWindow((_x, y, _w, h) => {
        // BOTTOM PADDING + BORDER OF THE CARD, PLUS BREATHING ROOM.
        const REVEAL_BELOW = 34;
        const keyboard_top = Dimensions.get('window').height - kb_ref.current;
        const overlap = y + h + REVEAL_BELOW - keyboard_top;
        if (kb_ref.current > 0 && overlap > 0) {
          scroller.scrollTo({ y: scroll_y_ref.current + overlap, animated: true });
        }
      });
    }, 260);
  };
  const field_props = (_key?: string) => ({
    on_focus_change: (focused: boolean) => {
      if (focused) reveal_focused();
    },
  });
  return { keyboard_height, fields_ref, track_scroll, field_props };
}
