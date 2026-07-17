# PLAN.md — Itenzo: AI-Powered Itinerary Planner

**Itenzo** — a modern, AI-augmented travel itinerary builder. TripIt is a static filing cabinet; Itenzo is an active planning companion. The user should be able to say "5 days in Boston" and go from a blank slate to a fully mapped, time-feasible, personalized itinerary in minutes — then keep refining it via drag-and-drop and conversational AI.

---

## 1. Product Vision & Principles

**One-liner:** A visually fluid, drag-and-drop travel timeline that organizes bookings AND proactively plans the gaps using location- and time-aware AI.

**Design principles (every feature must pass these):**

1. **The timeline is the source of truth.** Everything — flights, meals, museums, transit, buffer time — lives as a block on a vertical, per-day timeline. No separate "lists" that drift out of sync.
2. **AI proposes, the user disposes.** The AI never silently mutates the itinerary. It surfaces suggestion cards; the user snaps them in with one tap. Trust is built through reversibility (undo everything).
3. **Feasibility is always visible.** Transit times, opening hours, and pacing conflicts are computed continuously and shown inline. The app should make it *impossible to accidentally plan a bad day* (e.g., a museum visit after closing time, or 40 min of activities with a 90-min transit gap).
4. **Zero-friction ingestion.** Paste, forward, screenshot, or speak — data gets into the timeline without manual form-filling.
5. **Offline-first.** A traveler in a dead zone must still see their full itinerary, maps, and confirmation numbers.

---

## 2. Core Concepts & Data Model

### 2.1 Entities

```
Trip
 ├─ id, title, destinations[], date_range, cover_image, travelers[], home_bases[]
 ├─ Day[]  (derived from date_range, each with a theme/label, e.g. "Day 2 — North End & Harbor")
 │    └─ Block[]
 ├─ IdeaShelf[]   (unscheduled saved places — the "backlog")
 └─ Preferences   (pace, budget_tier, dietary, mobility, interests[])

Block (the atomic unit)
 ├─ id, block_type: flight | lodging | activity | meal | transit | buffer | note | custom
 ├─ start_time, end_time (or is_flexible flag with duration only)
 ├─ place?: { place_id, name, coords, address, hours, price_level, rating, photos }
 ├─ booking?: { confirmation_number, provider, cost, attachments[], status }
 ├─ source: manual | parsed_email | ai_suggested | imported
 ├─ is_locked: bool   (locked blocks — flights, reservations — are immovable anchors)
 └─ meta: { transit_to_next, conflict_flags[] }
```

### 2.1.1 Code conventions

- **snake_case** for everything: variables, functions, properties, JSON/API fields, database columns, file names (e.g., `start_time`, `resolve_push()`, `feasibility_engine.ts`).
- **PascalCase** only for classes, interfaces, enums, React components, and other types (`Trip`, `Block`, `IdeaShelf`, `FeasibilityEngine`).
- These conventions apply end-to-end — TypeScript models, Supabase schema, and LLM structured-output schemas all share the same snake_case field names so nothing needs mapping layers.
- **All code comments are written in UPPERCASE** (e.g., `// LOCKED BLOCKS ARE IMMOVABLE ANCHORS`).

### 2.2 Key modeling decisions

- **Anchors vs. flexible blocks.** Flights, hotel check-in/out, and timed reservations are *anchors* (locked). Everything else is *flexible*. This distinction powers auto-scheduling: the AI and the layout engine only rearrange flexible blocks around anchors.
- **Transit is a first-class block, not a label.** Auto-generated transit blocks (walk/drive/transit/rideshare) render between place blocks with mode icons and durations. They recompute on every drag. This makes "dead time" visible and reclaimable ("You have 45 min between these — want a coffee stop?").
- **The Idea Shelf.** A horizontal tray of saved-but-unscheduled place cards per trip. Users hoard ideas during research; scheduling them is a drag from shelf → timeline. AI suggestions that aren't accepted immediately can be "shelved" instead of dismissed.
- **Multi-home-base support.** A 5-day Boston trip may include a night in Salem or Cape Cod. Each day resolves its "base" (the lodging block covering that night) so proximity queries like "near my hotel" are always correct per-day.

---

## 3. UI/UX Design Decisions

### 3.0 Brand, visual identity & style guide (from approved mockups)

**Name: Itenzo.** Serif wordmark (editorial serif) against sans-serif UI text — the serif/sans contrast is the premium signal. *(Verify App Store, trademark, and domain availability before launch.)*

#### Color tokens

| Token | Hex | Usage |
|---|---|---|
| `canvas` | `#FDFAF6` | App background — warm cream, never stark white |
| `card_surface` | `#FFFFFF` | Block cards, tiles, sheets |
| `hairline` | `#EFE4DA` | Default 0.5px card/tile borders |
| `hairline_soft` | `#F5EDE4` | Inner dividers, empty progress tracks |
| `brand` | `#D85A30` | Terracotta — selected states, primary CTAs, activity edge, AI sparkle, FAB |
| `brand_pressed` | `#B84A26` | Pressed/darkened brand surfaces, chips on brand fill |
| `brand_tint` | `#FAECE7` | Selected chips, AI cards, lifted-drag block fill |
| `brand_border` | `#F0997B` | Selected chip borders, best-fit card border, snap guides, fullness bar fill |
| `brand_text_strong` | `#712B13` | Text on brand tints; section eyebrow labels |
| `brand_text` | `#993C1D` | Secondary text on tints, icon buttons |
| `brand_ink` | `#4A1B0C` | Wordmark |
| `meal` | `#EF9F27` | Meal block edge/pin (amber) |
| `meal_tint` / `meal_text` | `#FAEEDA` / `#633806` | Warning-ish chips (book-ahead), meal accents |
| `anchor` | `#0F6E56` (pin `#1D9E75`) | Booked/locked anchors, success moments (green-teal) |
| `anchor_tint` / `anchor_text` | `#E1F5EE` / `#085041` | "Open now", "Booked", verified chips |
| `danger` | `#E24B4A` | Infeasible transit connector |
| `danger_tint` / `danger_border` / `danger_text` | `#FCEBEB` / `#F09595` / `#A32D2D` (deep `#501313`) | Conflict block fill/border/text |
| `spine` | `#F0D9CE` | Timeline spine / dashed transit (dusty rose) |
| `ink` | `#2C2C2A` | Primary text |
| `ink_secondary` | `#5F5E5A` | Unselected date numbers, secondary emphasis |
| `ink_muted` | `#888780` | Metadata, captions |
| `ink_faint` | `#B4B2A9` | Timestamps, placeholders, hints |
| `ink_ghost` | `#D3D1C7` | Grip handles, disabled chevrons |
| `handle` | `#E8DDD2` | Sheet drag handles, idle snap guides |

Rules: one brand accent per screen region; amber/green/red are semantic only (meals, booked, conflict) — never decorative. Text on any tint uses the darkest stop of the *same* family, never plain black/gray.

#### Typography

- **Wordmark/display:** editorial serif — **Young Serif** (chunky, warm, playful-but-premium) — `Itenzo` at 17–18px in headers; serif also for hero trip names on dark fills (e.g., 24px on the trip card).
- **UI:** **Nunito** (rounded, friendly-but-polished sans) on all platforms. Two weights only: regular (400) and medium (500) — no semibold/bold. All UI text renders through the themed `Text`/`TextInput` primitives in `components/text.tsx` (import from there, never from react-native), which map `fontWeight` to the correct Nunito face.
- Scale: screen title 22/500 · card title 14/500 (13/500 in dense rows) · body/meta 12/400 muted · timestamps/captions 11/400 faint · date number 16–19/500 · eyebrow labels 10–11 with 0.5–1px letter-spacing, uppercase, brand_text_strong or muted.

#### Shape, spacing & elevation

- Radii: 28px device surfaces/sheets · 16–18px feature tiles and trip cards · 14px standard block cards · 12px option rows and icon squares · 22px pill inputs · 9–10px chips.
- Blocks use a 3px colored **left edge** with square corners on that side (`border-radius: 0 14px 14px 0`); dots/pins only on the map.
- Dashed borders are reserved exclusively for empty/gap/snap states.
- No shadows or gradients — elevation is expressed through fills (white cards on cream) and hairlines only.
- Padding rhythm: 12–14px inside cards, 8px gaps between stacked cards, 1.25rem screen gutters.

#### Component specs

- **Date pager tile:** stacked weekday (11px, faint, 0.5px tracking) over date number (16px/500); white tile + hairline; selected = solid `brand` fill, white number, cream weekday. No indicator dots.
- **Trip calendar row:** 46px date column (weekday over 19px number) · vertical hairline divider · theme title + one meta line · 4px **fullness bar** (`hairline_soft` track, `brand_border` fill; inverted colors on the selected row). Selected day = solid `brand` row with peek chips (`brand_pressed` fill) of its first blocks.
- **Timeline row:** 44px right-aligned hour rail (11px faint; brand-colored when dragging) · block card with colored left edge · dashed vertical transit connector with walk icon + "12 min · 0.6 mi".
- **Drag state:** lifted block gets `brand_tint` fill, `brand_border` border, −1.2° tilt, visible grip icon, dashed snap guide line at target time, and a live consequence line ("Snaps to 1:30 · adds 14 min walk").
- **Status chips:** 11px, 3×9px padding, 10px radius — green tint for open/booked/verified, amber tint for book-ahead, red family for conflicts.
- **Gap affordance:** dashed hairline row, muted "45 min free" left, brand sparkle + label right.
- **AI grammar:** sparkle icon + terracotta always means "AI can help here"; suggestion sheets lead with a 2px `brand_border` "Best fit" card that states its reasoning in one line; every AI sheet offers "Shelve for later".
- **Bottom bar:** pill AI ask field (sparkle prefix, faint placeholder) + 42px circular brand FAB for manual quick-add — manual entry always one tap away.
- **Conflict pattern:** red dashed connector + reason ("14 min walk, only 10 min free") → red-tinted offending block → "Three ways to fix it" card with the recommended fix pre-highlighted in brand tint.

### 3.1 The Dynamic Block Timeline

- **Vertical per-day timeline** with hour gridlines (collapsible to a compact "agenda" density). Horizontal day-pager with a mini heat-strip showing how full each day is.
- **Block anatomy:** rounded "bento" card — leading color-coded edge by type (flight = sky, meal = amber, activity = violet, lodging = indigo, transit = neutral), title, time range, hero thumbnail, and one contextual chip (e.g., "Closes 5 PM", "$$", "0.4 mi walk").
- **Drag mechanics:**
  - Long-press to lift (haptic + scale-up). Timeline auto-scrolls near edges.
  - **Magnetic snapping:** blocks snap to 15-min increments and to the end of the preceding transit block.
  - Resize by dragging the block's bottom edge to change duration; AI shows the *typical visit duration* as a ghost guide ("Most people spend ~2h at the MFA").
- **Conflict visualization:** overlapping blocks get a red seam; infeasible transit ("you'd need to teleport") draws a dashed red connector with a "Fix it" chip that offers auto-resolutions (shift later, swap order, change transit mode, drop to shelf).
- **Day map view:** every day has a toggle between timeline and map. The map shows numbered pins in visit order with the route polyline. Dragging pins on the map reorders the timeline (with confirmation).

### 3.2 AI surface design

- **The Gap Button.** Wherever the timeline has ≥45 min of unscheduled space, a subtle "＋✨" affordance appears in the gap. Tapping opens contextual suggestions *for that time and location*: "It's 3 PM near Faneuil Hall — dessert, a quick museum, or harbor walk?"
- **Conversational bar** pinned at the bottom of the trip view, scoped to the trip context: "best espresso within walking distance of my hotel", "rainy day backup for Thursday", "kid-friendly dinner near the aquarium under $30/person". Responses are **place cards** (photo, rating, distance, open-now, price) with one-tap "Add to [time]" — the AI proposes the slot.
- **Suggestion cards always show *why*:** "0.3 mi from your 2 PM block · open until 6 · matches 'coffee' preference". Explainability drives trust and the AI conversion metric.

### 3.3 Trip creation flows (three doors)

**Design decision: manual-first.** The manual path is the foundation, built and shipped before any AI or ingestion features. Every AI and parsing feature is sugar layered on top of the same manual add/edit primitives — the AI "adds a block" through the exact same code path a user's thumb does. This guarantees the app is fully usable with zero confirmations, zero AI calls, and zero connectivity, and it forces the core CRUD + drag UX to be solid before anything fancy exists.

1. **"Blank canvas" (manual-first — build this FIRST):** Empty timeline + Idea Shelf. The complete manual toolkit:
   - **Quick-add (＋) on any day or gap:** opens a block composer — pick block_type, name it, set time/duration. A place is *optional*; "Dinner with Sarah" or "Pack + check out" are valid blocks with no address.
   - **Place search (non-AI):** plain place autocomplete via the Mapbox Search Box API — type "Museum of Fine Arts", pick from results, hours/photos/coords attach automatically. No LLM involved.
   - **Manual anchors:** forms for adding a flight (airline + flight number auto-fills times via a flight-data lookup, or fully manual entry), lodging (check-in/out), train, rental car, and reservations — with confirmation number and notes fields. This fully replaces email parsing for users who don't have (or don't want to forward) confirmation emails.
   - **Custom/free-text blocks and notes**, duplicate block, move-to-another-day, and drag from Idea Shelf.
2. **"I have bookings" (ingestion):** Paste/forward confirmations; the trip scaffolds itself around the parsed anchors; AI then offers to fill gaps. Parsed results land as normal editable blocks — identical to manually created ones.
3. **"Plan it for me" (AI-first):** User enters destination + dates + a few preference chips (pace: relaxed/balanced/packed; interests; budget). AI generates a full draft itinerary — clustered geographically per day, feasibility-checked — presented as an editable proposal, not a fait accompli. This is the "5 days in Boston" magic moment.

---

## 4. Mechanics to Add (Beyond the Original MVP Doc)

These are the mechanics that turn a "timeline with a chatbot" into a real planning engine. Grouped by priority tier.

### Tier 0 — Manual Foundation (build FIRST, before any AI)

The app must be a complete, delightful itinerary builder with the network cable unplugged and every AI feature deleted. Everything here uses zero LLM calls:

0a. **Block CRUD:** quick-add composer (block_type, title, time, duration, notes), edit, delete, duplicate, move-to-day. Places optional on every block.
0b. **Manual anchor forms:** flight (with flight-number lookup or pure manual), lodging, train, rental car, reservation — confirmation numbers and attachments included. This is the answer to "I don't have a Delta email."
0c. **Plain place search:** Mapbox Search Box autocomplete (via the swappable `places_provider` interface) → tap → block with hours/photos/coords attached. Deterministic, no AI ranking.
0d. **Drag/drop/resize/snap** on the timeline, and the Idea Shelf with drag-to-schedule.
0e. **Undo/redo stack** across all mutations.
0f. All later features (parsing, AI suggestions, generation) mutate the itinerary exclusively through these same primitives — no parallel code paths.

### Tier 1 — Ship with MVP (they define the product)

1. **Geographic day-clustering (AI generation only).** When *generating* a day, group activities by neighborhood to minimize backtracking, respecting anchors and opening hours. (A manual "Optimize day order" button was cut — not needed.)
2. **Opening-hours & feasibility validation.** Every place block is checked against provider opening hours (Mapbox Details API, falling back to Google Places if Mapbox metadata access isn't granted), and flagged if: closed at scheduled time, closes within 30 min of arrival, or closed that day entirely (the classic "Mondays museums are closed" trap). Also validate reservation-required venues with a "Book ahead" chip.
3. **Auto-transit with mode intelligence.** Distance-based default (walk <0.8 mi, transit/drive otherwise, configurable), with per-leg mode override. Show cumulative daily walking distance in the day header ("Day 3: 4.2 mi on foot") — pacing at a glance.
4. **Typical-duration ghosting.** When a place is added, prefill duration from typical-visit data (Places "popular times"/heuristics + LLM estimate) instead of a dumb default.
5. **"AI, fit these in" for the Idea Shelf** — user shelves 8 places manually, AI slots them across the trip optimally (the shelf itself is Tier 0).
6. **Smart parsing (paste/forward email)** → structured anchors, per original doc, plus **screenshot parsing** (users screenshot confirmations constantly; vision models make this cheap now).

### Tier 2 — Fast follow (weeks 6–12)

8. **Pacing engine.** Per-day "intensity score" (hours scheduled, walking miles, back-to-back count). Warn on overpacked days; suggest inserting buffer/meal blocks. Respect the user's pace preference from onboarding.
10. **Reservation & booking status tracking.** "Needs booking" checklist derived from blocks (restaurants that require reservations, timed-entry museums). Deep-link out to OpenTable/venue sites for booking; paste confirmation back in to flip status. (Don't build booking in MVP — link out.)
11. **Collaborative trips.** Shared trips with real-time sync (Supabase realtime), presence, and a lightweight voting mechanic: shelf cards get 👍/👎 from travelers; AI weighs votes when filling gaps.
12. **"Day rescue" mode.** In-trip panic button: "Our flight is delayed 3h" / "The museum was closed" → AI re-plans the remainder of the day, preserving anchors and reservations, and shows a diff of changes before applying.
13. **Budget layer.** Optional cost field per block, per-day and per-trip rollups, and budget-aware suggestions ("keep dinner under $40/pp").

### Tier 3 — Differentiators for v1.0+

14. **Timeline "templates" & remixing.** Publish/share an itinerary as a template; another user applies it to their own dates and the app re-validates hours/availability and re-personalizes ("You said no seafood — swapped Neptune Oyster for a North End pasta spot").
15. **Live day mode.** During the trip, a "Now" line tracks through the timeline; the current block goes full-bleed with directions, confirmation codes, and a "running late" quick action that ripples the schedule.
16. **Multi-city trips & inter-city legs.** Trains/flights between bases as first-class legs; per-city day grouping.
17. **Energy/interest balancing.** Avoid three museums in a row; interleave active/passive, indoor/outdoor. Simple heuristic scoring, big perceived-quality win for generated itineraries.
18. **Post-trip recap.** Auto-generated trip summary (map of everywhere visited, stats, photo slots) — organic sharing = acquisition loop.
19. **Proactive notifications:** night-before digest ("Tomorrow: 5 stops, 3.1 mi walking"), check-in reminders, "leave by" alerts using live transit.

---

## 5. The "5 Days in Boston" Reference Flow (North-Star Demo)

This flow is the acceptance test for the MVP:

**Part A — Manual flow (must pass first, with AI features disabled):**

1. User taps New Trip → "Boston" → Jun 10–14 → lands on an empty 5-day timeline (no confirmation emails, no AI).
2. Quick-adds a flight manually: enters "DL 1204" → times auto-fill via flight lookup (or types them by hand). Adds hotel with check-in/out. Anchors appear on Days 1 and 5.
3. Types "Museum of Fine Arts" into place search → picks it from autocomplete → drops it on Day 4 at 10 AM; duration ghost suggests ~2h; hours chip confirms it's open.
4. Adds a placeless block "Dinner with Sarah, 7 PM" on Day 2. Shelves "Fenway tour" and "Tatte Bakery" to the Idea Shelf for later.
5. Drags MFA from Day 4 to Day 2 — transit recalculates, a conflict chip appears ("Tight: 12 min to cross town in 10"), one tap fixes by shifting the next block 15 min. Undo works.

**Part B — AI-assisted flow (layered on top):**

6. Alternative start: user picks chips (*Balanced pace · Food · History · Walkable · $$*) → AI drafts 5 themed days ("Freedom Trail & North End", "Harvard & Cambridge", "Seaport & ICA", "Fenway & MFA", "Harbor Islands / flex"), geographically clustered, hours-validated, meals filled — all as ordinary editable blocks.
7. If they *do* have a confirmation email, pasting it produces the same anchors as step 2's manual forms.
8. User asks the bar: "best cannoli near my Day 2 dinner" → 3 cards → taps one → it snaps in at 8:30 PM with a 4-min walk block.
9. Everything works in airplane mode once cached.

If Part A alone feels great, the foundation is right; if Part B feels magical on top of it, the product works.

---

## 6. AI Architecture & Design Decisions

- **Two-layer AI:** (a) **Parser/Planner** — LLM calls that output *strict JSON* (tool-use / structured output) for email parsing, itinerary generation, and re-planning; (b) **Conversational layer** — interprets user queries into structured search intents `{query, location anchor, time window, constraints}` which are executed against the places provider (Mapbox Search Box), then re-ranked by the LLM with the trip context. **The LLM never invents places** — it only ranks/annotates real provider results. This kills hallucinated restaurants.
- **Context assembly per request:** trip prefs + relevant day's blocks + resolved home base + current gap window. Keep it small and deterministic; don't dump the whole trip into every prompt.
- **Feasibility is code, not LLM.** Transit times, hour validation, overlap detection, and day-order optimization are deterministic services. The LLM proposes; the feasibility engine validates before anything renders as "addable". (LLMs are bad at arithmetic over schedules; don't let them own it.)
- **Suggestion caching & cost control:** cache Places results per (geohash, category, day), debounce conversational calls, and use a small/fast model for parsing vs. a stronger model for full-trip generation.
- **Prompt-injection hygiene:** parsed emails are untrusted input — parse into a fixed schema only; never let email content instruct the planner.

---

## 7. Technical Stack (Confirmed & Expanded)

| Layer | Choice | Rationale |
|---|---|---|
| Mobile frontend | React Native + Expo (TypeScript, expo-router) | One codebase for iOS + Android (+ web preview); reanimated/gesture-handler for fluid drag/drop and bento aesthetics |
| Local persistence | expo-sqlite (or WatermelonDB) + file cache | Offline-first: full trip, place data, map tiles cached |
| Backend | Supabase (Postgres + Auth + Realtime) | Fast MVP, realtime for collaboration later, relational fits the Trip/Day/Block model |
| LLM | Anthropic/OpenAI via thin backend proxy | Structured outputs for parsing/planning; never call from client with raw keys |
| Place search | Mapbox Search Box API (suggest/retrieve, session-priced) behind a swappable `places_provider` interface | Plain REST — works in Expo Go with zero native code; strong POI autocomplete; one billable unit per search session |
| Place details (hours/photos) | Mapbox Details API, with Google Places as fallback provider | Mapbox POI metadata (hours, photos, phone) is gated to approved accounts — request access early; the provider interface keeps Google/Foursquare one adapter away |
| Maps rendering | `components/map_view.tsx` is the app-facing component: native builds render @rnmapbox/maps (installed, config plugin added); web and Expo Go fall back to `components/tile_map.tsx`, a dependency-free raster-tile map (OSM tiles, or Mapbox tiles when `EXPO_PUBLIC_MAPBOX_TOKEN` is set) behind the same pin/route props | Fully customizable map components (custom pins/polylines match the design system); offline tile packs serve the offline-first principle. The rnmapbox path needs an EAS dev build — not Expo Go |
| Routing | Mapbox Directions (walk/drive) + Google Directions for transit legs | Mapbox has no public-transit routing; Boston transit coverage matters |
| Email ingest | Unique forward-to address (e.g., trips@…) via Postmark/SES inbound | The TripIt-proven pattern |

**Sync/conflict strategy:** last-writer-wins per Block with a version counter for MVP; move to CRDT-ish merge only when collaboration ships.

---

## 8. Execution Plan (Revised, 8 Weeks)

| Week | Deliverable |
|---|---|
| 1 | **Manual core:** data model + vertical timeline in React Native; block CRUD (quick-add composer, edit, delete, duplicate); drag/lift/snap/resize feel perfected on a hardcoded trip |
| 2 | **Manual core II:** manual anchor forms (flight w/ flight-number lookup, lodging, reservation); Idea Shelf; undo/redo stack; move-to-day |
| 3 | **Places (non-AI):** autocomplete place search, place cards, hours validation, typical durations; day map view |
| 4 | **Feasibility engine:** auto transit blocks, conflict detection + fix-it chips — *milestone: Part A of the Boston reference flow passes with zero AI* |
| 5 | **AI layer I:** conversational bar + Gap Button (query → structured intent → Places → ranked cards → snap-in via the same manual add primitives) |
| 6 | **AI layer II:** "Plan it for me" full-trip generation with geographic clustering + feasibility pass |
| 7 | **Ingestion:** paste-text parsing, forward-email pipeline, screenshot parsing — all landing as ordinary editable blocks; offline caching + sync |
| 8 | Polish, haptics, onboarding, empty states; TestFlight beta with the full Boston reference flow (Parts A + B) as the scripted demo |

---

## 9. Success Metrics

- **Time-to-Value:** seconds from "New Trip" → 3 mapped blocks. Target: <60s via any of the three doors — including the fully manual path (a manual flight + hotel + one place-searched activity should beat 60s too).
- **Manual completeness:** % of trips built with zero AI/ingestion features that still reach ≥5 blocks. If this is healthy, the foundation stands on its own; these users are also the AI upsell audience.
- **AI Conversion Rate:** % of AI-suggested places added to timeline (target ≥25%) and % *kept* until trip start (anti-gimmick check).
- **Generation acceptance:** % of AI-drafted days kept with ≤2 edits.
- **Feasibility saves:** count of conflict warnings resolved (proves the engine adds value).
- **Ingestion success:** % of forwarded/pasted confirmations parsed with zero manual correction (target ≥90% for top 20 providers).
- **D1 in-trip retention:** % of planners who open the app on Day 1 of their actual trip (the real moment of truth).

---

## 10. Open Questions & Risks

- **Places provider risk** — Mapbox Search Box session pricing is favorable, but rich POI metadata (opening hours, photos) sits behind gated Details API access; validate that access early, and keep the `places_provider` interface honest so Google Places/Foursquare can swap in per-capability (e.g., Mapbox for search, Google for hours) without touching UI code. Cache aggressively either way.
- **Android/web timing** — React Native + Expo ships iOS and Android from one codebase (with a web preview via react-native-web); per-platform polish still needs validation.
- **Booking integrations** — link-out only for MVP; native booking is a partnerships problem, not a code problem.
- **Parsing long-tail** — thousands of confirmation formats; LLM parsing degrades gracefully, but track failures and build a "fix it" quick-edit UI.
- **Differentiation moat** — TripIt could bolt on AI; the moat is the *timeline interaction model* + feasibility engine + taste in generated plans, not the LLM call itself. **Differentiation moat** — TripIt could bolt on AI; the moat is the *timeline interaction model* + feasibility engine + taste in generated plans, not the LLM call itself.