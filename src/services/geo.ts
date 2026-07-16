// SHARED GEO PRIMITIVES. ONE SOURCE FOR STRAIGHT-LINE DISTANCE SO THE
// FEASIBILITY ENGINE, THE PLACES PROVIDER, AND THE COMPOSER ALL AGREE.

export interface LngLat {
  lat: number;
  lng: number;
}

// GREAT-CIRCLE DISTANCE IN MILES (HAVERSINE).
export function haversine_mi(a: LngLat, b: LngLat): number {
  const R = 3958.8;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const d_lat = rad(b.lat - a.lat);
  const d_lng = rad(b.lng - a.lng);
  const s =
    Math.sin(d_lat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(d_lng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// COMPACT DISTANCE LABEL FOR BROWSE RESULTS ("0.3 mi", "<0.1 mi", "2 mi").
export function fmt_distance_mi(mi: number): string {
  if (mi < 0.1) return '<0.1 mi';
  if (mi < 10) return `${Math.round(mi * 10) / 10} mi`;
  return `${Math.round(mi)} mi`;
}
