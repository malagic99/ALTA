# Marko

An Expo (React Native) app that finds astrophotography-friendly locations
near you by combining **light pollution data** with **multi-night weather
forecasts**.

## What it does

When you open the app it:

1. Reads your GPS location.
2. Generates ~18 candidate sites in concentric rings out to ~120 km.
3. For each site, fetches the next 3 days of hourly weather (cloud cover,
   humidity, visibility, wind) from Open-Meteo and estimates a Bortle
   class from population density via OpenStreetMap's Overpass API.
4. Computes the astronomical-darkness window per night (sun below -18°)
   and the moon's illumination + above-horizon fraction during that
   window.
5. Scores each site on a 0-100 composite (cloud 40%, light pollution 30%,
   moon 20%, humidity 10%) and ranks them.
6. Renders the results on an OpenStreetMap basemap with the Lorenz 2022
   light-pollution overlay; tap any marker for a forecast breakdown.

## Stack

- Expo SDK 51 + Expo Router
- `react-native-maps` (OSM raster tiles, no Google/Apple key needed)
- `expo-location` for GPS
- `suncalc` for sun/moon ephemerides
- Open-Meteo for weather (no key)
- OSM Overpass API for population data (no key)
- David Lorenz's VIIRS light-pollution tile overlay (no key)

## Running

```bash
npm install
npx expo start
```

Then press `i` for iOS simulator, `a` for Android emulator, or scan the QR
code with Expo Go on a real device. The first run will ask for location
permission.

## Known limitations / honest caveats

- **Bortle estimate is a proxy.** Without a paid VIIRS-radiance API we
  approximate sky brightness as `Σ population_i / (distance_i + 1)²` over
  nearby populated places. That correctly favours remote spots over
  cities, but isn't a substitute for a real radiance lookup. Swap
  `src/services/lightPollution.ts:estimateBortle` if you bring one.
- **Overpass is rate-limited.** A search hits it once per candidate; for
  18 candidates that's fine, but don't crank `count` to hundreds without
  caching server-side.
- **Polar latitudes.** During polar day the astronomical-darkness window
  doesn't exist; that night is skipped rather than fudged.

## Project layout

```
app/
  _layout.tsx        Expo Router root
  index.tsx          Map screen
src/
  types.ts
  components/
    SpotDetails.tsx  Bottom sheet with per-night breakdown
    StatusBanner.tsx
  services/
    geo.ts           Haversine + tangent-plane offsets
    weather.ts       Open-Meteo client (single + batch)
    astronomy.ts     Twilight windows + moon stats via SunCalc
    lightPollution.ts  Overpass-based Bortle estimate + tile URL
    scoring.ts       Composite 0-100 score
    candidates.ts    Ring sampler + orchestration
```
