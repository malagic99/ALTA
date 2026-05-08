# Marko

An Expo (React Native) app that finds astrophotography-friendly locations
near you by combining **light pollution**, **multi-night weather
forecasts**, and a per-spot **terrain horizon + target clearance
calculation** for any pin you drop on the map.

## Two flows

### Auto-ranked spots near you
On launch the app:

1. Reads your GPS location.
2. Generates ~18 candidate sites in concentric rings out to your selected
   radius (50 / 120 / 250 km).
3. For each site, fetches the next 3 days of hourly weather (cloud cover,
   humidity, visibility, wind) from Open-Meteo and estimates a Bortle
   class from population density via OpenStreetMap's Overpass API.
4. Computes the astronomical-darkness window per night (sun below -18°)
   and the moon's illumination + above-horizon fraction during that
   window via SunCalc.
5. Scores each site on a 0-100 composite (cloud 40%, light pollution
   30%, moon 20%, humidity 10%) and ranks them.
6. Renders the results on an OpenStreetMap basemap with the Lorenz 2022
   light-pollution overlay; tap any marker for a forecast breakdown.

### Pin-drop horizon analysis (Phase 1 of the deeper-target features)

Long-press anywhere on the map to drop a pin (drag to fine-tune). Tap
**Calculate horizon** to:

1. Sample ground elevations along 36 azimuths × 20 radial samples out to
   10 km via the Google Maps **Elevation API**.
2. Convert to a 360° apparent-altitude horizon profile, accounting for
   earth curvature and standard atmospheric refraction (k = 0.13).
3. Compute alt/az tracks throughout tonight's astronomical-darkness
   window for a catalog of popular targets (Milky Way core, Orion,
   Andromeda, Pleiades, North America Nebula, Rho Ophiuchi, Polaris)
   using the **Astronomy Engine** library locally on the device.
4. Render a 360° altazimuth radar that overlays the terrain horizon and
   the target tracks.
5. Spit out per-target clearance lines like
   *"Milky Way core: clears 11:34 PM, dips 2:08 AM (peak 18°)."*

If the **canopy backend** (Phase 2, see `backend/canopy/`) is configured,
a checkbox on the pin panel adds Meta CHM canopy heights to each sample
point before the horizon is computed, so the radar reflects the trees
that block your sky. Phase 3 will add building heights via the Google
Solar API.

## Stack

- Expo SDK 51 + Expo Router
- `react-native-maps` (OSM raster basemap, no Google/Apple key needed
  for the map itself)
- `react-native-svg` for the horizon radar
- `expo-location` for GPS
- `astronomy-engine` for DSO ephemeris (alt/az from RA/Dec)
- `suncalc` for sun + moon ephemerides
- Open-Meteo for weather (no key)
- OSM Overpass API for population data (no key)
- David Lorenz's VIIRS light-pollution tile overlay (no key)
- Google Maps Elevation API (key required for horizon calc)

## Configuration

Create `.env.local` at the repo root:

```bash
# Required for "Calculate horizon"
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_key_here

# Optional — canopy heights for the horizon calc.
# Deploy backend/canopy to Cloud Run and put the URL here.
EXPO_PUBLIC_CANOPY_BACKEND_URL=

# Optional — Phase 3 placeholders, not used yet
EXPO_PUBLIC_ASTROSPHERIC_API_KEY=
EXPO_PUBLIC_METEOBLUE_API_KEY=
```

`EXPO_PUBLIC_*` variables are inlined into the JS bundle, so restrict
the Google key in the Cloud Console (HTTP referrers / app bundle IDs +
API restrictions) to scope its blast radius.

## Running

```bash
npm install
npx expo start
```

Press `i` for iOS simulator, `a` for Android emulator, or scan the QR
code with Expo Go. The first run asks for location permission.

## Cost notes (Phase 1)

A single "Calculate horizon" press makes one batched Elevation API call
covering 36 × 20 + 1 = 721 sample points, billed as ~1.5k requests under
Google's "elevation, locations" SKU. Google's free monthly $200 credit
covers many thousands of these. Heavy usage should add caching (per
~1 km grid cell).

## Known limitations / honest caveats

- **Bortle estimate is a proxy** — population/distance, not real VIIRS
  radiance.
- **Horizon includes terrain (and canopy if the backend is wired up).**
  Building heights are still pending — Phase 3 will plug the Google
  Solar API into the same `surfaceHeight` accumulator.
- **Overpass is rate-limited.** Don't crank candidate count to hundreds
  without server-side caching.
- **Polar latitudes.** During polar day the astronomical-darkness
  window doesn't exist; we fall back to an 8-hour window from "now"
  for the radar so the UI doesn't go blank.
- **react-native-maps + web** is unsupported — this app targets iOS and
  Android.

## Project layout

```
app/
  _layout.tsx        Expo Router root
  index.tsx          Map screen + pin-drop wiring
src/
  types.ts
  components/
    SpotDetails.tsx  Bottom sheet for ranked candidates
    PinPanel.tsx     Bottom sheet for the dropped pin
    HorizonRadar.tsx 360° altazimuth radar (SVG)
    StatusBanner.tsx
  services/
    config.ts        EXPO_PUBLIC_* key resolver
    geo.ts           Haversine, tangent-plane offsets, bearings
    weather.ts       Open-Meteo client
    astronomy.ts     Twilight windows + moon stats via SunCalc
    elevation.ts     Google Elevation API client + ray sampler
    horizon.ts       360° terrain horizon profile
    targets.ts       DSO catalog + Astronomy Engine alt/az tracks
    clearance.ts     Target-rises-above-horizon time computation
    lightPollution.ts  Overpass-based Bortle estimate + tile URL
    scoring.ts       Composite 0-100 score
    candidates.ts    Ring sampler + orchestration
    canopy.ts        Client for the canopy backend (Meta CHM)
backend/
  canopy/            FastAPI + GEE proxy that samples Meta CHM
                     pixel values; deploy to Cloud Run.
```
