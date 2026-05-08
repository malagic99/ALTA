import type { LatLng } from '../types';

const EARTH_RADIUS_KM = 6371;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Move `origin` by (north_km, east_km) along the local tangent plane. */
export function offsetKm(
  origin: LatLng,
  northKm: number,
  eastKm: number,
): LatLng {
  const dLat = northKm / EARTH_RADIUS_KM;
  const dLon = eastKm / (EARTH_RADIUS_KM * Math.cos(toRadians(origin.latitude)));
  return {
    latitude: origin.latitude + toDegrees(dLat),
    longitude: origin.longitude + toDegrees(dLon),
  };
}

/** Initial bearing from `from` to `to`, in degrees clockwise from north. */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const φ1 = toRadians(from.latitude);
  const φ2 = toRadians(to.latitude);
  const Δλ = toRadians(to.longitude - from.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function compassPoint(bearing: number): string {
  const idx = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_POINTS[idx];
}
