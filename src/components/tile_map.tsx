import { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/text';
import { color } from '@/theme/tokens';

// DEPENDENCY-FREE SLIPPY-TILE MAP (PLAN §5 STACK: MAPS RENDERING). RASTER
// TILES VIA PLAIN <Image> SO IT RUNS EVERYWHERE TODAY — WEB, EXPO GO, THE
// HEADLESS SUITE — WITH NO NATIVE MODULE. @rnmapbox/maps REPLACES THIS
// COMPONENT BEHIND THE SAME PROPS ONCE THE EAS DEV BUILD EXISTS (NEEDS THE
// APPLE DEVELOPER ACCOUNT); UNTIL THEN IT IS A NON-INTERACTIVE VIEWPORT:
// FIT-TO-PINS, NUMBERED MARKERS IN VISIT ORDER, STRAIGHT ROUTE SEGMENTS.

const TILE = 256;
const MIN_ZOOM = 10;
const MAX_ZOOM = 16;
// BREATHING ROOM AROUND THE OUTERMOST PINS WHEN FITTING THE VIEWPORT.
const FIT_PAD = 44;

const mapbox_token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

function tile_url(z: number, x: number, y: number): string {
  if (mapbox_token) {
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/${z}/${x}/${y}?access_token=${mapbox_token}`;
  }
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

// WEB MERCATOR: LNG/LAT → WORLD FRACTION [0,1); PIXELS = FRACTION · 256 · 2^Z.
function world_x(lng: number): number {
  return (lng + 180) / 360;
}
function world_y(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

export interface MapPin {
  lat: number;
  lng: number;
  // GLYPH INSIDE THE PIN — VISIT-ORDER NUMBER ON THE DAY MAP.
  label?: string;
  pin_color?: string;
  on_press?: () => void;
  test_id?: string;
}

export interface TileMapProps {
  pins: MapPin[];
  // DRAW STRAIGHT CONNECTORS BETWEEN CONSECUTIVE PINS (VISIT ORDER).
  route?: boolean;
  // FIXED ZOOM OVERRIDE; OTHERWISE SINGLE PIN = 14, MULTI = FIT-TO-BOUNDS.
  zoom?: number;
  style?: StyleProp<ViewStyle>;
  test_id?: string;
}

export function TileMap({ pins, route = false, zoom, style, test_id }: TileMapProps) {
  const [size, set_size] = useState<{ w: number; h: number } | null>(null);
  const on_layout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (size?.w !== width || size?.h !== height)) {
      set_size({ w: width, h: height });
    }
  };

  return (
    <View onLayout={on_layout} style={[styles.frame, style]} testID={test_id}>
      {size != null && pins.length > 0 && <MapContent pins={pins} route={route} zoom={zoom} {...size} />}
      {pins.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.empty_label}>Nothing on the map yet</Text>
        </View>
      )}
      <Text style={styles.attribution}>{mapbox_token ? '© Mapbox © OpenStreetMap' : '© OpenStreetMap'}</Text>
    </View>
  );
}

function MapContent({
  pins,
  route,
  zoom,
  w,
  h,
}: {
  pins: MapPin[];
  route: boolean;
  zoom?: number;
  w: number;
  h: number;
}) {
  const min_x = Math.min(...pins.map((p) => world_x(p.lng)));
  const max_x = Math.max(...pins.map((p) => world_x(p.lng)));
  const min_y = Math.min(...pins.map((p) => world_y(p.lat)));
  const max_y = Math.max(...pins.map((p) => world_y(p.lat)));

  // INTEGER ZOOMS ONLY — TILES STAY CRISP. PICK THE DEEPEST ZOOM WHOSE PIN
  // BOUNDS (PLUS PADDING) STILL FIT THE VIEWPORT.
  let z = zoom ?? (pins.length === 1 ? 14 : MAX_ZOOM);
  if (zoom == null && pins.length > 1) {
    while (z > MIN_ZOOM) {
      const scale = TILE * 2 ** z;
      if ((max_x - min_x) * scale + FIT_PAD * 2 <= w && (max_y - min_y) * scale + FIT_PAD * 2 <= h) break;
      z--;
    }
  }

  const scale = TILE * 2 ** z;
  const center_px_x = ((min_x + max_x) / 2) * scale;
  const center_px_y = ((min_y + max_y) / 2) * scale;
  // THE VIEWPORT'S TOP-LEFT CORNER IN WORLD PIXELS.
  const origin_x = center_px_x - w / 2;
  const origin_y = center_px_y - h / 2;

  const tiles: { key: string; z: number; x: number; y: number; left: number; top: number }[] = [];
  const max_tile = 2 ** z - 1;
  for (let tx = Math.floor(origin_x / TILE); tx * TILE < origin_x + w; tx++) {
    for (let ty = Math.floor(origin_y / TILE); ty * TILE < origin_y + h; ty++) {
      if (tx < 0 || ty < 0 || tx > max_tile || ty > max_tile) continue;
      tiles.push({ key: `${z}/${tx}/${ty}`, z, x: tx, y: ty, left: tx * TILE - origin_x, top: ty * TILE - origin_y });
    }
  }

  const pin_px = pins.map((p) => ({
    ...p,
    x: world_x(p.lng) * scale - origin_x,
    y: world_y(p.lat) * scale - origin_y,
  }));

  return (
    <>
      {tiles.map((t) => (
        <Image
          key={t.key}
          source={{ uri: tile_url(t.z, t.x, t.y) }}
          style={[styles.tile, { left: t.left, top: t.top }]}
          fadeDuration={0}
        />
      ))}
      {route &&
        pin_px.slice(0, -1).map((a, i) => {
          const b = pin_px[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 4) return null;
          const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          return (
            <View
              key={`leg_${i}`}
              pointerEvents="none"
              style={[
                styles.route_leg,
                {
                  left: a.x,
                  top: a.y - 1,
                  width: len,
                  transform: [{ rotate: `${angle}deg` }],
                },
              ]}
            />
          );
        })}
      {pin_px.map((p, i) => (
        <Pressable
          key={`pin_${i}`}
          disabled={p.on_press == null}
          onPress={p.on_press}
          hitSlop={8}
          testID={p.test_id}
          style={[styles.pin, { left: p.x - PIN_R, top: p.y - PIN_R, backgroundColor: p.pin_color ?? color.brand }]}>
          {p.label != null && <Text style={styles.pin_label}>{p.label}</Text>}
        </Pressable>
      ))}
    </>
  );
}

const PIN_R = 12;

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: '#EAE4DB',
  },
  tile: { position: 'absolute', width: TILE, height: TILE },
  route_leg: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    backgroundColor: color.brand,
    opacity: 0.55,
    // ROTATE AROUND THE SEGMENT'S START POINT, NOT ITS CENTER.
    transformOrigin: '0% 50%',
  },
  pin: {
    position: 'absolute',
    width: PIN_R * 2,
    height: PIN_R * 2,
    borderRadius: PIN_R,
    borderWidth: 2,
    borderColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3A2A20',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pin_label: { fontSize: 11, fontWeight: '500', color: color.white, lineHeight: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty_label: { fontSize: 12, color: color.ink_muted },
  attribution: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    fontSize: 8,
    color: color.ink_muted,
    backgroundColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: 3,
    borderRadius: 3,
  },
});
