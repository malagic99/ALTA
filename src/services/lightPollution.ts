import type { LatLng } from '../types';
import { haversineKm } from './geo';

/**
 * Public VIIRS-derived light-pollution overlay (David Lorenz, 2022 atlas).
 * Fully free; we layer it on the basemap at low opacity so users can see
 * dark/bright zones at a glance.
 */
export const LIGHT_POLLUTION_TILE_URL =
  'https://djlorenz.github.io/astronomy/lp2022/overlay/tiles/{z}/{x}/{y}.png';

/**
 * A populated place with population, used to estimate sky brightness.
 */
export type PopulatedPlace = {
  lat: number;
  lng: number;
  population: number;
  name?: string;
};

/**
 * Per-point Bortle estimate.
 *
 * We don't have a free per-pixel VIIRS sampling API, so we approximate sky
 * brightness from nearby populated places via the OpenStreetMap Overpass
 * API. Each populated place contributes a brightness term proportional to
 * population / (distance + 1)² — a standard inverse-square light
 * propagation model with a soft floor to avoid singularities at zero
 * distance. The aggregate is then mapped to a Bortle bucket using
 * thresholds calibrated against well-known sites.
 *
 * For ranked-search workloads we fetch all relevant places ONCE around
 * the origin (`fetchPopulatedPlaces`) and compute Bortle locally per
 * candidate via `bortleFromPlaces`. This avoids hitting Overpass once
 * per candidate, which would get rate-limited.
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

type OverpassNode = {
  lat: number;
  lon: number;
  tags?: { population?: string; name?: string; place?: string };
};

type OverpassResponse = { elements: OverpassNode[] };

export async function fetchPopulatedPlaces(
  center: LatLng,
  radiusKm: number,
): Promise<PopulatedPlace[]> {
  const radiusM = Math.round(radiusKm * 1000);
  const query = `[out:json][timeout:25];
node(around:${radiusM},${center.latitude.toFixed(4)},${center.longitude.toFixed(4)})
  ["place"~"^(city|town|village)$"]["population"];
out tags center;`;

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as OverpassResponse;
    const places: PopulatedPlace[] = [];
    for (const n of data.elements ?? []) {
      const popStr = n.tags?.population;
      if (!popStr) continue;
      const pop = parseInt(popStr.replace(/[^0-9]/g, ''), 10);
      if (!Number.isFinite(pop) || pop <= 0) continue;
      places.push({
        lat: n.lat,
        lng: n.lon,
        population: pop,
        name: n.tags?.name,
      });
    }
    return places;
  } catch {
    return [];
  }
}

export function bortleFromPlaces(
  point: LatLng,
  places: PopulatedPlace[],
): { value: number; bortle: number } {
  let brightness = 0;
  for (const p of places) {
    const d = haversineKm(point, { latitude: p.lat, longitude: p.lng });
    brightness += p.population / Math.pow(d + 1, 2);
  }
  return { value: brightness, bortle: brightnessToBortle(brightness) };
}

/** Convenience for one-off lookups. Prefer the batch path for rankings. */
export async function estimateBortle(
  point: LatLng,
  searchRadiusKm = 200,
): Promise<{ value: number; bortle: number }> {
  const places = await fetchPopulatedPlaces(point, searchRadiusKm);
  return bortleFromPlaces(point, places);
}

/**
 * Map the brightness proxy to a Bortle class 1-9. Thresholds are tuned so
 * remote desert sites land at class 1-2, suburbs at 5-6, and city centers
 * at 8-9 with the population/distance model above.
 */
function brightnessToBortle(b: number): number {
  if (b < 50) return 1;
  if (b < 200) return 2;
  if (b < 800) return 3;
  if (b < 3_000) return 4;
  if (b < 12_000) return 5;
  if (b < 40_000) return 6;
  if (b < 120_000) return 7;
  if (b < 400_000) return 8;
  return 9;
}

export function bortleLabel(bortle: number): string {
  switch (bortle) {
    case 1:
      return 'Excellent dark sky';
    case 2:
      return 'Typical truly dark site';
    case 3:
      return 'Rural sky';
    case 4:
      return 'Rural/suburban transition';
    case 5:
      return 'Suburban sky';
    case 6:
      return 'Bright suburban';
    case 7:
      return 'Suburban/urban transition';
    case 8:
      return 'City sky';
    default:
      return 'Inner-city sky';
  }
}
