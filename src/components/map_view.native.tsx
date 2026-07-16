import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { TileMap, type TileMapProps } from '@/components/tile_map';
import { color } from '@/theme/tokens';

export type { MapPin, TileMapProps } from '@/components/tile_map';

// NATIVE MAP: @rnmapbox/maps WHEN THE NATIVE BINARY IS PRESENT (EAS DEV/PROD
// BUILD). EXPO GO SHIPS NO MAPBOX BINARY, SO THE require THROWS AND WE FALL
// BACK TO THE RASTER TILE MAP — SAME PROPS, LESS INTERACTIVITY.
let mapbox: typeof import('@rnmapbox/maps') | null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mapbox = require('@rnmapbox/maps') as typeof import('@rnmapbox/maps');
  mapbox.default.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');
} catch {
  mapbox = null;
}

// PIN-BOUND CAMERA PADDING — MATCHES THE TILE MAP'S FIT_PAD.
const FIT_PAD = 44;

export function MapView({ pins, route = false, zoom, style, test_id }: TileMapProps) {
  if (mapbox == null) {
    return <TileMap pins={pins} route={route} zoom={zoom} style={style} test_id={test_id} />;
  }
  const M = mapbox;

  const camera =
    pins.length === 1
      ? {
          centerCoordinate: [pins[0].lng, pins[0].lat] as [number, number],
          zoomLevel: zoom ?? 14,
        }
      : {
          bounds: {
            ne: [Math.max(...pins.map((p) => p.lng)), Math.max(...pins.map((p) => p.lat))],
            sw: [Math.min(...pins.map((p) => p.lng)), Math.min(...pins.map((p) => p.lat))],
            paddingTop: FIT_PAD,
            paddingBottom: FIT_PAD,
            paddingLeft: FIT_PAD,
            paddingRight: FIT_PAD,
          },
        };

  return (
    <View style={[styles.frame, style]} testID={test_id}>
      {pins.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.empty_label}>Nothing on the map yet</Text>
        </View>
      ) : (
        <M.MapView
          style={styles.map}
          styleURL={M.StyleURL.Street}
          scaleBarEnabled={false}
          compassEnabled={false}
          pitchEnabled={false}>
          <M.Camera defaultSettings={camera} {...camera} animationDuration={0} />
          {route && pins.length > 1 && (
            <M.ShapeSource
              id="visit_route"
              shape={{
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: pins.map((p) => [p.lng, p.lat]),
                },
              }}>
              <M.LineLayer
                id="visit_route_line"
                style={{ lineColor: color.brand, lineWidth: 2, lineOpacity: 0.55 }}
              />
            </M.ShapeSource>
          )}
          {pins.map((p, i) => (
            <M.MarkerView key={`pin_${i}`} coordinate={[p.lng, p.lat]} allowOverlap>
              <Pressable
                disabled={p.on_press == null}
                onPress={p.on_press}
                hitSlop={8}
                testID={p.test_id}
                style={[styles.pin, { backgroundColor: p.pin_color ?? color.brand }]}>
                {p.label != null && <Text style={styles.pin_label}>{p.label}</Text>}
              </Pressable>
            </M.MarkerView>
          ))}
        </M.MapView>
      )}
    </View>
  );
}

const PIN_R = 12;

// PIN LOOK IS IDENTICAL TO THE TILE MAP'S SO THE FALLBACK IS SEAMLESS.
const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: '#EAE4DB' },
  map: { flex: 1 },
  pin: {
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
});
