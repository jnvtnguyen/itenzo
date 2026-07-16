import type { BlockType } from '@/model/types';

// TYPICAL-DURATION GHOSTING (PLAN §4 TIER 1.4): WHEN A PLACE ATTACHES, PREFILL
// A SENSIBLE VISIT LENGTH FROM ITS CATEGORY INSTEAD OF A DUMB 60-MIN DEFAULT.
// HEURISTIC TABLE FOR NOW; POPULAR-TIMES DATA CAN REPLACE IT LATER.

const category_minutes: Record<string, number> = {
  museum: 120,
  aquarium: 120,
  stadium: 90,
  observatory: 60,
  landmark: 45,
  church: 30,
  park: 60,
  trail: 120,
  neighborhood: 90,
  market: 75,
  restaurant: 90,
  cafe: 45,
  bakery: 30,
};

const type_minutes: Partial<Record<BlockType, number>> = {
  meal: 60,
  activity: 60,
  buffer: 45,
};

export function typical_duration_min(
  poi_category: string | undefined,
  block_type: BlockType,
): number {
  if (poi_category && category_minutes[poi_category] != null) {
    return category_minutes[poi_category];
  }
  return type_minutes[block_type] ?? 60;
}
