import type { LatLng } from '../types';
import { buildHorizonRays, fetchElevations } from './elevation';
import { haversineKm, toDegrees } from './geo';

export type HorizonProfile = {
  /** Center / observer location. */
  center: LatLng;
  /** Observer ground elevation in meters. */
  observerElevation: number;
  /** Eye height above ground used for the observer (meters). */
  eyeHeightM: number;
  /** Azimuth bins, in degrees clockwise from north. */
  azimuths: number[];
  /** Apparent altitude angle of the obstruction (degrees) per azimuth. */
  altitudes: number[];
  /** Maximum sample distance used (km). */
  maxRangeKm: number;
};

const EARTH_RADIUS_M = 6_371_000;
/**
 * Standard atmospheric refraction coefficient for terrestrial sight lines.
 * Reduces the apparent dip of a distant object by ~14% — see e.g.
 * Bomford, Geodesy.
 */
const REFRACTION_COEFFICIENT = 0.13;
const DEFAULT_EYE_HEIGHT_M = 1.6;

export type HorizonOptions = {
  azimuthCount?: number;
  samplesPerRay?: number;
  maxRangeKm?: number;
  eyeHeightM?: number;
};

/**
 * Computes a 360° terrain-only horizon profile around `center`.
 *
 * For each azimuth we sample ground elevations along a ray out to
 * `maxRangeKm`, and the horizon altitude in that direction is the maximum
 * apparent elevation angle of any sample, accounting for earth curvature
 * and standard atmospheric refraction.
 *
 * Trees and buildings are intentionally not included here — the canopy
 * (Phase 2) and Solar API (Phase 3) layers add to this baseline.
 */
export async function computeTerrainHorizon(
  center: LatLng,
  opts: HorizonOptions = {},
): Promise<HorizonProfile> {
  const azimuthCount = opts.azimuthCount ?? 36; // 10° resolution
  const samplesPerRay = opts.samplesPerRay ?? 20; // ~500m steps to 10km
  const maxRangeKm = opts.maxRangeKm ?? 10;
  const eyeHeightM = opts.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;

  const { rays } = buildHorizonRays(
    center,
    azimuthCount,
    samplesPerRay,
    0.1,
    maxRangeKm,
  );

  // Flatten center + all rays into one batch, preserving offsets so we can
  // recover per-ray slices.
  const allPoints: LatLng[] = [center, ...rays.flat()];
  const elevations = await fetchElevations(allPoints);

  const observerElevation = elevations[0];
  const observerEyeM = observerElevation + eyeHeightM;

  const azimuths: number[] = [];
  const altitudes: number[] = [];

  let cursor = 1;
  for (let a = 0; a < azimuthCount; a++) {
    const azDeg = (360 * a) / azimuthCount;
    const ray = rays[a];

    let maxAlt = -90;
    for (let s = 0; s < ray.length; s++) {
      const sampleElev = elevations[cursor + s];
      const sample = ray[s];
      const distM = haversineKm(center, sample) * 1000;
      const alt = apparentElevationAngle(observerEyeM, sampleElev, distM);
      if (alt > maxAlt) maxAlt = alt;
    }
    azimuths.push(azDeg);
    altitudes.push(Math.max(0, maxAlt)); // clamp: a depression below 0 is "open"

    cursor += ray.length;
  }

  return {
    center,
    observerElevation,
    eyeHeightM,
    azimuths,
    altitudes,
    maxRangeKm,
  };
}

/**
 * Apparent elevation angle (degrees) from observer at height `obsH` above
 * sea level looking at a point at height `targetH`, distance `distM` away
 * along the surface, with earth-curvature drop and atmospheric refraction
 * applied.
 */
function apparentElevationAngle(
  obsH: number,
  targetH: number,
  distM: number,
): number {
  if (distM <= 0) return -90;
  // Effective drop due to curvature minus refraction lift.
  const drop = ((1 - REFRACTION_COEFFICIENT) * distM * distM) / (2 * EARTH_RADIUS_M);
  const apparentTargetH = targetH - drop;
  return toDegrees(Math.atan2(apparentTargetH - obsH, distM));
}

/** Linear-interpolated horizon altitude at an arbitrary azimuth (deg). */
export function horizonAltAt(profile: HorizonProfile, azDeg: number): number {
  if (profile.azimuths.length === 0) return 0;
  const az = ((azDeg % 360) + 360) % 360;
  const n = profile.azimuths.length;
  const step = 360 / n;
  const i = Math.floor(az / step) % n;
  const j = (i + 1) % n;
  const t = (az - i * step) / step;
  return profile.altitudes[i] * (1 - t) + profile.altitudes[j] * t;
}
