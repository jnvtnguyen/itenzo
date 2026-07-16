import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { BlockType } from '@/model/types';

// BROWSE-BY-INTENT CHIPS FOR THE COMPOSER. EACH MAPS TO A MAPBOX SEARCH BOX
// CANONICAL CATEGORY ID (USED VERBATIM BY THE /category ENDPOINT) AND TO A
// SUBSTRING THE OFFLINE CATALOG MATCHES ON. THE POINT IS "FIND DINNER NEARBY"
// WITHOUT KNOWING A NAME — TAP A CHIP, GET NEARBY PLACES RANKED BY DISTANCE.

export interface PlaceCategory {
  // MAPBOX CANONICAL CATEGORY ID.
  id: string;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  // OFFLINE-CATALOG poi_category SUBSTRINGS THIS CHIP SHOULD MATCH.
  local_match: string[];
}

const MEAL_CATEGORIES: PlaceCategory[] = [
  { id: 'coffee', label: 'Coffee', icon: 'coffee-outline', local_match: ['coffee', 'cafe'] },
  { id: 'restaurant', label: 'Restaurants', icon: 'silverware-fork-knife', local_match: ['restaurant', 'meal'] },
  { id: 'bar', label: 'Bars', icon: 'glass-cocktail', local_match: ['bar', 'pub', 'nightlife'] },
  { id: 'bakery', label: 'Bakeries', icon: 'bread-slice-outline', local_match: ['bakery', 'dessert'] },
  { id: 'fast_food', label: 'Quick bites', icon: 'food-outline', local_match: ['fast_food', 'sandwich'] },
];

const ACTIVITY_CATEGORIES: PlaceCategory[] = [
  { id: 'tourist_attraction', label: 'Sights', icon: 'camera-outline', local_match: ['attraction', 'landmark', 'sight'] },
  { id: 'museum', label: 'Museums', icon: 'bank-outline', local_match: ['museum', 'gallery'] },
  { id: 'park', label: 'Parks', icon: 'tree-outline', local_match: ['park', 'garden'] },
  { id: 'shopping_mall', label: 'Shopping', icon: 'shopping-outline', local_match: ['shop', 'mall', 'store', 'market'] },
  { id: 'coffee', label: 'Coffee', icon: 'coffee-outline', local_match: ['coffee', 'cafe'] },
];

// WHICH BROWSE CHIPS A BLOCK TYPE SHOWS. FLIGHTS/STAYS/NOTES DON'T BROWSE.
export function categories_for(block_type: BlockType): PlaceCategory[] {
  if (block_type === 'meal') return MEAL_CATEGORIES;
  if (block_type === 'activity' || block_type === 'custom') return ACTIVITY_CATEGORIES;
  return [];
}
