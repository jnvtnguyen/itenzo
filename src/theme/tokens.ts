// DESIGN TOKENS FROM PLAN.MD §3.0 — SINGLE SOURCE OF TRUTH FOR COLOR, TYPE, SHAPE.
// ONE BRAND ACCENT PER SCREEN REGION; AMBER/GREEN/RED ARE SEMANTIC ONLY.

export const color = {
  // SURFACES
  canvas: '#FDFAF6',
  card_surface: '#FFFFFF',
  hairline: '#EFE4DA',
  hairline_soft: '#F5EDE4',

  // BRAND (TERRACOTTA)
  brand: '#D85A30',
  brand_pressed: '#B84A26',
  brand_tint: '#FAECE7',
  brand_border: '#F0997B',
  brand_text_strong: '#712B13',
  brand_text: '#993C1D',
  brand_ink: '#4A1B0C',

  // SEMANTIC — MEALS (AMBER)
  meal: '#EF9F27',
  meal_tint: '#FAEEDA',
  meal_text: '#633806',

  // SEMANTIC — ANCHORS / SUCCESS (GREEN-TEAL)
  anchor: '#0F6E56',
  anchor_pin: '#1D9E75',
  anchor_tint: '#E1F5EE',
  anchor_text: '#085041',
  anchor_text_on_dark: '#9FE1CB',

  // SEMANTIC — CONFLICTS (RED)
  danger: '#E24B4A',
  danger_tint: '#FCEBEB',
  danger_border: '#F09595',
  danger_text: '#A32D2D',
  danger_text_deep: '#501313',

  // TIMELINE
  spine: '#F0D9CE',

  // INK SCALE
  ink: '#2C2C2A',
  ink_secondary: '#5F5E5A',
  ink_muted: '#888780',
  ink_faint: '#B4B2A9',
  ink_ghost: '#D3D1C7',
  handle: '#E8DDD2',

  white: '#FFFFFF',
} as const;

// LEFT-EDGE COLOR PER BLOCK TYPE (§3.1 BLOCK ANATOMY, ADAPTED TO THE TOKEN SET:
// ACTIVITY = BRAND, MEAL = AMBER, ANCHORS = GREEN-TEAL, TRANSIT/BUFFER/NOTE = NEUTRAL).
export const block_edge_color: Record<string, string> = {
  activity: color.brand,
  meal: color.meal,
  flight: color.anchor,
  lodging: color.anchor,
  transit: color.ink_ghost,
  buffer: color.ink_ghost,
  note: color.ink_ghost,
  custom: color.brand,
};

// TYPE SCALE (§3.0 TYPOGRAPHY) — SANS IS THE PLATFORM DEFAULT; TWO WEIGHTS ONLY.
export const type_scale = {
  screen_title: { fontSize: 22, fontWeight: '500' as const },
  card_title: { fontSize: 14, fontWeight: '500' as const },
  card_title_dense: { fontSize: 13, fontWeight: '500' as const },
  body: { fontSize: 12, fontWeight: '400' as const },
  caption: { fontSize: 11, fontWeight: '400' as const },
  date_number: { fontSize: 16, fontWeight: '500' as const },
  date_number_large: { fontSize: 19, fontWeight: '500' as const },
  eyebrow: {
    fontSize: 11,
    fontWeight: '400' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
} as const;

// FONTS ARE LOADED IN THE ROOT LAYOUT.
// YOUNG SERIF: CHUNKY, WARM EDITORIAL SERIF FOR THE WORDMARK AND HERO NAMES.
// NUNITO: ROUNDED, FRIENDLY-BUT-POLISHED SANS FOR ALL UI TEXT (VIA components/text).
export const font = {
  serif: 'YoungSerif_400Regular',
  sans: 'Inter_400Regular',
  sans_medium: 'Inter_500Medium',
} as const;

export const radius = {
  surface: 28, // DEVICE SURFACES / SHEETS
  tile: 18, // FEATURE TILES, TRIP CARDS
  card: 14, // STANDARD BLOCK CARDS
  row: 12, // OPTION ROWS, ICON SQUARES
  pill: 22, // PILL INPUTS
  chip: 10,
  cta: 16,
} as const;

export const space = {
  card_pad: 13, // 12–14PX INSIDE CARDS
  card_gap: 8, // BETWEEN STACKED CARDS
  gutter: 20, // 1.25REM SCREEN GUTTERS
} as const;

export const hairline_width = 0.75;
