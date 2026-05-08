import type { LatLng } from '../types';
import { GOOGLE_MAPS_API_KEY } from './config';
import { offsetKm, toRadians } from './geo';

const ELEVATION_URL = 'https://maps.googleapis.com/maps/api/elevation/json';
const MAX_LOCATIONS_PER_REQUEST = 256; // Google allows 512; use 256 for URL length safety

type ElevationResponse = {
  status: string;
  results: { location: { lat: number; lng: number }; elevation: number }[];
  error_message?: string;
};

/**
 * Fetches elevations for an arbitrary set of points. Batches into
 * <=256-point requests and parallelises.
 */
export async function fetchElevations(points: LatLng[]): Promise<number[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error(
      'Missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY. Add it to .env.local to enable horizon calculation.',
    );
  }
  if (points.length === 0) return [];

  const batches: LatLng[][] = [];
  for (let i = 0; i < points.length; i += MAX_LOCATIONS_PER_REQUEST) {
    batches.push(points.slice(i, i + MAX_LOCATIONS_PER_REQUEST));
  }

  const results = await Promise.all(batches.map(fetchBatch));
  return results.flat();
}

async function fetchBatch(batch: LatLng[]): Promise<number[]> {
  const locations = batch
    .map((p) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`)
    .join('|');
  const url = `${ELEVATION_URL}?locations=${encodeURIComponent(
    locations,
  )}&key=${GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Elevation API HTTP ${res.status}`);
  }
  const data = (await res.json()) as ElevationResponse;
  if (data.status !== 'OK') {
    throw new Error(`Elevation API: ${data.status} ${data.error_message ?? ''}`);
  }
  // Google preserves input order in the results array.
  return data.results.map((r) => r.elevation);
}

/**
 * Generates rays of sample points emanating from `center` along each
 * azimuth. For each azimuth we produce `samples` points evenly spaced from
 * `minKm` (skipping the very-near zone where parallax noise dominates) out
 * to `maxKm`.
 */
export function buildHorizonRays(
  center: LatLng,
  azimuthCount: number,
  samples: number,
  minKm = 0.1,
  maxKm = 10,
): { center: LatLng; rays: LatLng[][] } {
  const rays: LatLng[][] = [];
  const step = (maxKm - minKm) / (samples - 1);
  for (let a = 0; a < azimuthCount; a++) {
    const azDeg = (360 * a) / azimuthCount;
    const azRad = toRadians(azDeg);
    const ray: LatLng[] = [];
    for (let s = 0; s < samples; s++) {
      const dKm = minKm + s * step;
      const north = Math.cos(azRad) * dKm;
      const east = Math.sin(azRad) * dKm;
      ray.push(offsetKm(center, north, east));
    }
    rays.push(ray);
  }
  return { center, rays };
}
