import type { LatLng } from '../types';
import { canopyAvailable, fetchCanopyHeights } from './canopy';
import { buildHorizonRays, fetchElevations } from './elevation';
import { haversineKm, toDegrees } from './geo';

export type HorizonLayers = {
  /** Whether canopy heights were added on top of the terrain. */
  canopy: boolean;
  /** Whether building heights (Solar API) were added — Phase 3, not yet. */
  buildings: boolean;
};

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
  /** Which obstruction layers were included in this profile. */
  layers: HorizonLayers;
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
  /**
   * If true and the canopy backend is configured, add Meta CHM canopy
   * heights to the terrain at each sample point. Falls back to terrain
   * only if the backend isn't reachable.
   */
  includeCanopy?: boolean;
};

/**
 * Computes a 360° horizon profile around `center`.
 *
 * For each azimuth we sample ground elevations along a ray out to
 * `maxRangeKm`, optionally add canopy heights from the Meta CHM (via
 * the canopy backend), and the horizon altitude in that direction is
 * the maximum apparent elevation angle of any sample, with earth
 * curvature and standard atmospheric refraction applied.
 *
 * Buildings (Solar API) are not yet wired in — Phase 3.
 */
export async function computeHorizon(
  center: LatLng,
  opts: HorizonOptions = {},
): Promise<HorizonProfile> {
  const azimuthCount = opts.azimuthCount ?? 36; // 10° resolution
  const samplesPerRay = opts.samplesPerRay ?? 20; // ~500m steps to 10km
  const maxRangeKm = opts.maxRangeKm ?? 10;
  const eyeHeightM = opts.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M;
  const wantCanopy = !!opts.includeCanopy && canopyAvailable();

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

  const [elevations, canopy] = await Promise.all([
    fetchElevations(allPoints),
    wantCanopy
      ? fetchCanopyHeights(allPoints).catch(() => null)
      : Promise.resolve(null),
  ]);

  const surfaceHeight = (i: number) =>
    elevations[i] + (canopy ? canopy[i] : 0);

  const observerElevation = elevations[0];
  // The observer is *under* the canopy (or on a building roof) is not
  // something we can know from the data, so we put the observer at
  // ground + eye height regardless of canopy at the center.
  const observerEyeM = observerElevation + eyeHeightM;

  const azimuths: number[] = [];
  const altitudes: number[] = [];

  let cursor = 1;
  for (let a = 0; a < azimuthCount; a++) {
    const azDeg = (360 * a) / azimuthCount;
    const ray = rays[a];

    let maxAlt = -90;
    for (let s = 0; s < ray.length; s++) {
      const sample = ray[s];
      const sampleSurface = surfaceHeight(cursor + s);
      const distM = haversineKm(center, sample) * 1000;
      const alt = apparentElevationAngle(observerEyeM, sampleSurface, distM);
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
    layers: { canopy: !!canopy, buildings: false },
  };
}

/** @deprecated Use `computeHorizon` with `includeCanopy: false`. */
export const computeTerrainHorizon = computeHorizon;

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
