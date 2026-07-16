# Maps setup (Mapbox + EAS dev build)

The map is already coded. `components/map_view.tsx` renders `@rnmapbox/maps` on
native builds and falls back to the raster tile map (`components/tile_map.tsx`)
on web and in Expo Go. This doc is the one-time wiring to turn on the real
interactive map. You need two Mapbox tokens.

## The two tokens

| Token | Prefix | Where it lives | Used for | Scopes |
|-------|--------|----------------|----------|--------|
| **Public** | `pk.` | `EXPO_PUBLIC_MAPBOX_TOKEN` (embedded in the app bundle) | Map tiles at runtime + Search Box place autocomplete | Default public scopes |
| **Secret download** | `sk.` | `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` (build-time only, EAS secret) | Downloading the native Mapbox SDK during the iOS/Android build | **Must include `DOWNLOADS:READ`** |

> ⚠️ The single most common rnmapbox build failure is a 401 while downloading
> the SDK. That means the `sk.` token is missing the **`DOWNLOADS:READ`** secret
> scope. Verify it at https://account.mapbox.com/access-tokens/ before building.
> This is a special scope you tick when creating the secret token — the "public
> scopes plus private scopes" set is not enough unless `DOWNLOADS:READ` is one
> of them.

The `pk.` token is public by design (it ships inside every app). The `sk.` token
is a real secret — it never goes in `.env`, `app.json`, or git.

## 1. Local development (web, on your machine)

Edit `.env` (already created, gitignored) and paste your public token:

```
EXPO_PUBLIC_MAPBOX_TOKEN=pk.your_real_public_token
```

Then `npx expo start --web` uses real Mapbox tiles and Search Box search. (No
`.env` = OpenStreetMap tiles + the local Boston place catalog. Both work.)

## 2. EAS environment variables (for cloud builds)

`.env` is gitignored, so it is **not** uploaded to EAS. Register both tokens as
EAS environment variables instead. Run these once per environment you build
(`development` first; repeat with `--environment preview` / `production` later):

```bash
# Public token — needed at build time so it gets compiled into the JS bundle.
# "sensitive" = hidden in the dashboard but still injected into the build.
eas env:create --environment development \
  --name EXPO_PUBLIC_MAPBOX_TOKEN \
  --value "pk.your_real_public_token" \
  --visibility sensitive

# Secret download token — build-time only, never in the bundle.
eas env:create --environment development \
  --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN \
  --value "sk.your_real_secret_token" \
  --visibility secret
```

`eas.json` already sets `"environment": "development" | "preview" | "production"`
on each build profile, so the matching variables load automatically.

## 3. First iOS dev build

```bash
eas login                 # if not already
eas build:configure       # first time only — links the project
eas build --profile development --platform ios
```

EAS runs the prebuild (applies the `@rnmapbox/maps` config plugin), authenticates
the SDK download with `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`, and produces an installable
dev-client `.ipa`. Install it on a registered device/simulator, then
`npx expo start --dev-client`.

On that build the day-map toggle and the composer place preview show the real
pannable/zoomable Mapbox map with the route line and numbered pins — same
component, no code change. Everything else (web, Expo Go) keeps the tile
fallback.

## Notes

- **Apple device registration:** for `distribution: internal` iOS builds, register
  your test device UDID first: `eas device:create`.
- **Android** uses the same `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` variable — no extra
  setup if you later build `--platform android`.
- **Nothing else references the tokens.** `places_provider` switches to Mapbox
  search the moment `EXPO_PUBLIC_MAPBOX_TOKEN` is present; otherwise it stays on
  the local catalog.
