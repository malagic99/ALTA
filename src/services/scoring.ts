import type { AstroNight, SkyScore } from '../types';

/**
 * Default weights for the composite score. They sum to 1 so the result is
 * directly interpretable on a 0-100 scale.
 */
export const DEFAULT_WEIGHTS = {
  cloud: 0.4,
  lightPollution: 0.3,
  moon: 0.2,
  humidity: 0.1,
};

export function scoreNight(
  night: AstroNight,
  bortle: number,
  weights = DEFAULT_WEIGHTS,
): SkyScore {
  const cloud = clamp01(1 - night.meanCloud / 100) * 100;
  const humidity = clamp01(1 - night.meanHumidity / 100) * 100;
  // Bortle 1 → 100, Bortle 9 → 0, linear in between.
  const lightPollution = clamp01((9 - bortle) / 8) * 100;
  // Moon penalty: only the fraction of night the moon is above horizon
  // matters, scaled by illumination. New moon up = 100, full moon up = 0.
  const moon =
    clamp01(1 - night.moonIllumination * night.moonUpFraction) * 100;

  const total =
    weights.cloud * cloud +
    weights.lightPollution * lightPollution +
    weights.moon * moon +
    weights.humidity * humidity;

  return {
    total: Math.round(total),
    cloud: Math.round(cloud),
    lightPollution: Math.round(lightPollution),
    moon: Math.round(moon),
    humidity: Math.round(humidity),
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 30) return 'Poor';
  return 'Avoid';
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#3DD68C';
  if (score >= 65) return '#7ED957';
  if (score >= 50) return '#F2C94C';
  if (score >= 30) return '#F2994A';
  return '#EB5757';
}
