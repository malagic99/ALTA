import type { Candidate, LatLng } from '../types';
import { buildNights } from './astronomy';
import { bearingDeg, haversineKm, offsetKm } from './geo';
import { bortleFromPlaces, fetchPopulatedPlaces } from './lightPollution';
import { scoreNight } from './scoring';
import { fetchForecastBatch } from './weather';

export type SearchOptions = {
  /** Origin (typically the user's location). */
  origin: LatLng;
  /** Search radius in km. */
  radiusKm?: number;
  /** Number of candidate points to evaluate. */
  count?: number;
  /** Number of forecast days to consider. */
  days?: number;
};

/**
 * Generates a set of candidate observation spots arranged on concentric
 * rings around the origin, evaluates each against the next few nights of
 * weather, and returns them ranked by best-night composite score.
 */
export async function findDarkSkySpots(
  opts: SearchOptions,
): Promise<Candidate[]> {
  const radiusKm = opts.radiusKm ?? 120;
  const count = opts.count ?? 18;
  const days = opts.days ?? 3;

  const points = sampleRing(opts.origin, radiusKm, count);

  // Fetch populated places ONCE around the origin with a generous margin so
  // every candidate's brightness sum sees all relevant cities. Cities much
  // farther than 2× radiusKm contribute negligibly via 1/d².
  const placesRadiusKm = Math.max(150, radiusKm * 2.5);

  const [forecasts, places] = await Promise.all([
    fetchForecastBatch(points, days),
    fetchPopulatedPlaces(opts.origin, placesRadiusKm),
  ]);

  const candidates: Candidate[] = points.map((point, i) => {
    const nights = buildNights(point, forecasts[i], days);
    const { bortle } = bortleFromPlaces(point, places);

    let bestIdx = 0;
    let bestScore = -1;
    let bestSkyScore = scoreNight(nights[0] ?? emptyNight(), bortle);
    for (let j = 0; j < nights.length; j++) {
      const s = scoreNight(nights[j], bortle);
      if (s.total > bestScore) {
        bestScore = s.total;
        bestIdx = j;
        bestSkyScore = s;
      }
    }

    return {
      id: `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)}`,
      location: point,
      distanceKm: haversineKm(opts.origin, point),
      bearingDeg: bearingDeg(opts.origin, point),
      bortle,
      nights,
      score: bestSkyScore,
      bestNightIndex: bestIdx,
    };
  });

  return candidates.sort((a, b) => b.score.total - a.score.total);
}

function sampleRing(origin: LatLng, radiusKm: number, count: number): LatLng[] {
  const points: LatLng[] = [origin];
  const rings = [0.4, 0.7, 1.0]; // fraction of radiusKm
  const perRing = Math.max(1, Math.round((count - 1) / rings.length));

  for (const r of rings) {
    for (let i = 0; i < perRing; i++) {
      const angle = (2 * Math.PI * i) / perRing + (r * Math.PI) / 7; // small phase offset per ring
      const north = Math.cos(angle) * radiusKm * r;
      const east = Math.sin(angle) * radiusKm * r;
      points.push(offsetKm(origin, north, east));
    }
  }
  return points;
}

function emptyNight() {
  return {
    date: '',
    start: new Date().toISOString(),
    end: new Date().toISOString(),
    meanCloud: 100,
    meanHumidity: 100,
    meanVisibility: 0,
    meanWind: 0,
    moonIllumination: 1,
    moonUpFraction: 1,
  };
}
