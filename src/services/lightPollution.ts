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
 * Per-point Bortle estimate.
 *
 * We don't have a free per-pixel VIIRS sampling API, so we approximate sky
 * brightness from nearby populated places via the OpenStreetMap Overpass
 * API. Each populated place contributes a brightness term proportional to
 * population / (distance + d0)^2 — a standard inverse-square light
 * propagation model with a soft floor to avoid singularities at zero
 * distance. The aggregate is then mapped to a Bortle bucket using
 * thresholds calibrated against well-known sites.
 *
 * This is a coarse proxy, but for "find a dark spot away from the city"
 * the dominant signal is exactly distance-from-cities, so it works well
 * for ranking. Replace with a real radiance lookup if you bring a
 * commercial source.
 */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

type OverpassNode = {
  lat: number;
  lon: number;
  tags?: { population?: string; name?: string; place?: string };
};

type OverpassResponse = { elements: OverpassNode[] };

const CACHE = new Map<string, { value: number; bortle: number }>();
const CACHE_RADIUS_KM = 5;

export async function estimateBortle(
  point: LatLng,
  searchRadiusKm = 200,
): Promise<{ value: number; bortle: number }> {
  const cached = lookupCache(point);
  if (cached) return cached;

  const radiusM = Math.round(searchRadiusKm * 1000);
  const query = `[out:json][timeout:25];
node(around:${radiusM},${point.latitude.toFixed(4)},${point.longitude.toFixed(4)})
  ["place"~"^(city|town|village)$"]["population"];
out tags center;`;

  let nodes: OverpassNode[] = [];
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (res.ok) {
      const data = (await res.json()) as OverpassResponse;
      nodes = data.elements ?? [];
    }
  } catch {
    // network/timeout: fall through with empty list → treated as very dark
  }

  let brightness = 0;
  for (const n of nodes) {
    const popStr = n.tags?.population;
    if (!popStr) continue;
    const pop = parseInt(popStr.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(pop) || pop <= 0) continue;
    const d = haversineKm(point, { latitude: n.lat, longitude: n.lon });
    // soft floor of 1km prevents blow-up when sitting on top of a node
    brightness += pop / Math.pow(d + 1, 2);
  }

  const bortle = brightnessToBortle(brightness);
  const result = { value: brightness, bortle };
  CACHE.set(cacheKey(point), result);
  return result;
}

function lookupCache(point: LatLng) {
  for (const [key, val] of CACHE) {
    const [lat, lon] = key.split(',').map(Number);
    if (haversineKm({ latitude: lat, longitude: lon }, point) < CACHE_RADIUS_KM) {
      return val;
    }
  }
  return null;
}

function cacheKey(p: LatLng): string {
  return `${p.latitude.toFixed(2)},${p.longitude.toFixed(2)}`;
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
