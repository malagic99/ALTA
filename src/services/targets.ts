import * as Astro from 'astronomy-engine';
import type { LatLng } from '../types';

export type Target = {
  id: string;
  name: string;
  /** Right ascension in hours (J2000). */
  raHours: number;
  /** Declination in degrees (J2000). */
  decDeg: number;
  /** Hex color used to render this target on the radar. */
  color: string;
};

/**
 * A small catalog of popular astrophotography targets. RA/Dec from
 * SIMBAD / NED at J2000.
 */
export const TARGETS: Target[] = [
  // Galactic core (Sgr A*)
  { id: 'mw-core', name: 'Milky Way core', raHours: 17.7611, decDeg: -29.0078, color: '#F2C94C' },
  { id: 'orion-belt', name: 'Orion (M42)', raHours: 5.5881, decDeg: -5.391, color: '#56CCF2' },
  { id: 'andromeda', name: 'Andromeda (M31)', raHours: 0.7122, decDeg: 41.2692, color: '#F2994A' },
  { id: 'pleiades', name: 'Pleiades (M45)', raHours: 3.7903, decDeg: 24.1167, color: '#BB6BD9' },
  { id: 'na-nebula', name: 'North America Nebula', raHours: 20.9833, decDeg: 44.5167, color: '#7ED957' },
  { id: 'rho-oph', name: 'Rho Ophiuchi', raHours: 16.4595, decDeg: -23.4456, color: '#EB5757' },
  { id: 'polaris', name: 'Polaris', raHours: 2.5303, decDeg: 89.2641, color: '#F1F5FF' },
];

export type AltAzPoint = {
  /** ms since epoch. */
  t: number;
  /** Apparent altitude (degrees, refracted). */
  alt: number;
  /** Azimuth in degrees clockwise from north. */
  az: number;
};

export type TargetTrack = {
  target: Target;
  points: AltAzPoint[];
};

/**
 * Computes alt/az for `target` from `observer` at `stepMinutes` cadence
 * over [start, end].
 */
export function trackTarget(
  target: Target,
  observer: LatLng,
  start: Date,
  end: Date,
  stepMinutes = 15,
  observerElevationM = 0,
): TargetTrack {
  const obs = new Astro.Observer(
    observer.latitude,
    observer.longitude,
    observerElevationM,
  );
  const points: AltAzPoint[] = [];
  const stepMs = stepMinutes * 60_000;
  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const date = new Date(t);
    const horiz = Astro.Horizon(date, obs, target.raHours, target.decDeg, 'normal');
    points.push({ t, alt: horiz.altitude, az: horiz.azimuth });
  }
  return { target, points };
}

export function trackTargets(
  targets: Target[],
  observer: LatLng,
  start: Date,
  end: Date,
  stepMinutes = 15,
  observerElevationM = 0,
): TargetTrack[] {
  return targets.map((t) =>
    trackTarget(t, observer, start, end, stepMinutes, observerElevationM),
  );
}
