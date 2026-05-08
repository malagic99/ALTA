import type { LatLng } from '../types';
import { CANOPY_BACKEND_URL } from './config';

const MAX_POINTS_PER_REQUEST = 1024;

type SampleResponse = {
  heights_m: number[];
  asset: string;
  band: string;
  scale_m: number;
};

/** Whether the canopy backend has been configured. */
export function canopyAvailable(): boolean {
  return CANOPY_BACKEND_URL.length > 0;
}

/**
 * Fetches Meta CHM canopy heights (meters) at the given points, in the
 * same order as the input. Returns 0 for points outside coverage / over
 * water. Throws on transport or backend errors.
 */
export async function fetchCanopyHeights(points: LatLng[]): Promise<number[]> {
  if (!canopyAvailable()) {
    throw new Error(
      'Missing EXPO_PUBLIC_CANOPY_BACKEND_URL. Deploy backend/canopy and set the URL.',
    );
  }
  if (points.length === 0) return [];

  const out: number[] = new Array(points.length).fill(0);

  for (let offset = 0; offset < points.length; offset += MAX_POINTS_PER_REQUEST) {
    const chunk = points.slice(offset, offset + MAX_POINTS_PER_REQUEST);
    const body = {
      points: chunk.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    };
    const url = `${CANOPY_BACKEND_URL.replace(/\/$/, '')}/canopy/sample`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Canopy backend HTTP ${res.status}: ${text || res.statusText}`);
    }
    const data = (await res.json()) as SampleResponse;
    for (let i = 0; i < chunk.length; i++) {
      out[offset + i] = data.heights_m[i] ?? 0;
    }
  }

  return out;
}
