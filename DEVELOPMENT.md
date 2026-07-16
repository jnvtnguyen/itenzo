# DEVELOPMENT.md — Common Commands

Day-to-day commands for working on Itenzo. Token setup lives in [MAPS_SETUP.md](MAPS_SETUP.md).

---

## Daily development (iPhone)

```bash
# START METRO FOR THE DEV CLIENT ON YOUR PHONE (TUNNEL NEEDED ON WSL2 —
# THE PHONE CAN'T REACH WSL'S PRIVATE IP DIRECTLY). SCAN THE QR OR OPEN
# THE ITENZO DEV APP AND IT CONNECTS.
npx expo start --dev-client --tunnel
```

- **JS/TS changes** (almost everything): just reload — shake the phone → *Reload*, or press `r` in the Metro terminal. **No new build needed.**
- **Native changes** (new native module in `package.json`, new plugin in `app.json`, icon/splash, SDK upgrade): you need a **new EAS build** (below).

```bash
# QUICK WEB PREVIEW IN A BROWSER (FALLBACK TILE MAP, SAME JS)
npx expo start --web
```

## EAS builds (real iPhone app)

```bash
eas login                # ONCE PER MACHINE
eas whoami               # CHECK WHO YOU'RE LOGGED IN AS

# DEV CLIENT BUILD — THE ONE YOU INSTALL FOR DAILY DEVELOPMENT.
# REBUILD WHENEVER NATIVE DEPS/PLUGINS CHANGE (E.G. expo-location,
# async-storage, @rnmapbox/maps WERE ADDED SINCE YOUR LAST BUILD).
eas build --profile development --platform ios

# SHAREABLE STANDALONE TEST BUILD (NO METRO NEEDED, INTERNAL DISTRIBUTION)
eas build --profile preview --platform ios

# APP STORE / TESTFLIGHT BUILD + SUBMIT
eas build --profile production --platform ios
eas submit --platform ios

# BUILD STATUS / HISTORY / LOGS
eas build:list --platform ios --limit 5
```

When the build finishes, open the link EAS prints (or the email) on your phone and install over the old app. Then run Metro and open the app.

## Secrets & env vars

```bash
eas env:list development                  # SEE WHAT'S SET PER ENVIRONMENT
# THE MAPBOX SECRET DOWNLOAD TOKEN (sk., NEEDS DOWNLOADS:READ) LIVES ONLY
# IN EAS — NEVER IN .env OR GIT. SEE MAPS_SETUP.md FOR THE FULL RUNBOOK.
```

The public token (`EXPO_PUBLIC_MAPBOX_TOKEN=pk.…`) lives in the gitignored `.env`, which Metro and `expo export` read automatically.

## Checks before committing

```bash
npx tsc --noEmit         # TYPECHECK
npx expo lint            # ESLINT
```

Feature testing is manual — run the app on the phone (or web preview) and exercise the flows. Setting `EXPO_PUBLIC_SEED_DEMO=1` when starting Metro loads the Boston demo trip for quick manual poking; normal builds start empty.

## Web export

```bash
npx expo export --platform web --output-dir dist    # PRODUCTION WEB BUNDLE (USES .env TOKEN)
```

## Troubleshooting

```bash
npx expo start --dev-client --tunnel --clear   # CLEAR METRO'S TRANSFORM CACHE
npx expo install --check                       # VERIFY DEP VERSIONS MATCH THE SDK
rm -rf node_modules && npm install             # THE CLASSIC
```

- Phone can't connect → make sure you used `--tunnel`, and phone + Metro are both online.
- "Native module not found" after adding a package → that package needs a new `eas build --profile development --platform ios` (the app is built to fall back gracefully until then: maps → tile map, location → skipped, persistence → in-memory).
