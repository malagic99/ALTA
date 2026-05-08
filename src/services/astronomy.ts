import SunCalc from 'suncalc';
import type { AstroNight, LatLng, WeatherForecast } from '../types';

/**
 * Returns up to `days` consecutive nights starting tonight. For each night
 * we use the astronomical-twilight window (sun ≤ -18°). If true astronomical
 * darkness never occurs at this latitude/season we fall back to nautical
 * twilight, then to civil; if it's polar day we skip the night.
 */
export function buildNights(
  point: LatLng,
  forecast: WeatherForecast,
  days: number,
): AstroNight[] {
  const nights: AstroNight[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() + i);
    day.setUTCHours(12, 0, 0, 0); // anchor near noon to derive evening times

    const times = SunCalc.getTimes(day, point.latitude, point.longitude);
    const start = pickFirstValid([
      times.night, // sun crosses -18° going down (astronomical dusk)
      times.nauticalDusk,
      times.dusk,
    ]);
    // For end, use the *next* morning twilight; SunCalc gives both events on same call.
    const tomorrow = new Date(day);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowTimes = SunCalc.getTimes(
      tomorrow,
      point.latitude,
      point.longitude,
    );
    const end = pickFirstValid([
      tomorrowTimes.nightEnd,
      tomorrowTimes.nauticalDawn,
      tomorrowTimes.dawn,
    ]);

    if (!start || !end || end.getTime() <= start.getTime()) {
      continue;
    }

    const stats = aggregateOverWindow(forecast, start, end);
    const moon = moonStatsOverWindow(point, start, end);

    nights.push({
      date: dateKey(start),
      start: start.toISOString(),
      end: end.toISOString(),
      meanCloud: stats.cloud,
      meanHumidity: stats.humidity,
      meanVisibility: stats.visibility,
      meanWind: stats.wind,
      moonIllumination: moon.illumination,
      moonUpFraction: moon.upFraction,
    });
  }

  return nights;
}

function pickFirstValid(candidates: (Date | null | undefined)[]): Date | null {
  for (const c of candidates) {
    if (c && !isNaN(c.getTime())) return c;
  }
  return null;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function aggregateOverWindow(
  forecast: WeatherForecast,
  start: Date,
  end: Date,
): { cloud: number; humidity: number; visibility: number; wind: number } {
  const startMs = start.getTime();
  const endMs = end.getTime();
  let n = 0;
  let cloudSum = 0;
  let humSum = 0;
  let visSum = 0;
  let windSum = 0;

  for (let i = 0; i < forecast.time.length; i++) {
    const t = Date.parse(forecast.time[i] + 'Z'); // Open-Meteo returns naive UTC strings
    if (t < startMs || t > endMs) continue;
    cloudSum += forecast.cloudCover[i] ?? 0;
    humSum += forecast.humidity[i] ?? 0;
    visSum += forecast.visibility[i] ?? 0;
    windSum += forecast.windSpeed[i] ?? 0;
    n++;
  }

  if (n === 0) {
    return { cloud: 100, humidity: 100, visibility: 0, wind: 0 };
  }
  return {
    cloud: cloudSum / n,
    humidity: humSum / n,
    visibility: visSum / n,
    wind: windSum / n,
  };
}

function moonStatsOverWindow(
  point: LatLng,
  start: Date,
  end: Date,
): { illumination: number; upFraction: number } {
  const mid = new Date((start.getTime() + end.getTime()) / 2);
  const illum = SunCalc.getMoonIllumination(mid).fraction;

  const stepMin = 15;
  const totalSteps =
    Math.max(1, Math.round((end.getTime() - start.getTime()) / (stepMin * 60_000)));
  let up = 0;
  for (let s = 0; s < totalSteps; s++) {
    const t = new Date(start.getTime() + s * stepMin * 60_000);
    const pos = SunCalc.getMoonPosition(t, point.latitude, point.longitude);
    if (pos.altitude > 0) up++;
  }
  return { illumination: illum, upFraction: up / totalSteps };
}
