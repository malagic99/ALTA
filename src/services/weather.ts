import type { LatLng, WeatherForecast } from '../types';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

type OpenMeteoResponse = {
  hourly: {
    time: string[];
    cloud_cover: number[];
    relative_humidity_2m: number[];
    visibility: number[];
    wind_speed_10m: number[];
    temperature_2m: number[];
  };
};

/**
 * Fetches an hourly forecast for the next `days` days at the given point.
 * Uses Open-Meteo (no API key required).
 */
export async function fetchForecast(
  point: LatLng,
  days = 3,
): Promise<WeatherForecast> {
  const params = new URLSearchParams({
    latitude: point.latitude.toFixed(4),
    longitude: point.longitude.toFixed(4),
    hourly: [
      'cloud_cover',
      'relative_humidity_2m',
      'visibility',
      'wind_speed_10m',
      'temperature_2m',
    ].join(','),
    forecast_days: String(days),
    timezone: 'UTC',
    wind_speed_unit: 'ms',
  });

  const res = await fetch(`${OPEN_METEO}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status}`);
  }
  const data = (await res.json()) as OpenMeteoResponse;

  return {
    time: data.hourly.time,
    cloudCover: data.hourly.cloud_cover,
    humidity: data.hourly.relative_humidity_2m,
    visibility: data.hourly.visibility,
    windSpeed: data.hourly.wind_speed_10m,
    temperature: data.hourly.temperature_2m,
  };
}

/**
 * Bulk forecast for many candidate points. Open-Meteo's API supports
 * comma-separated lat/lon lists, returning an array of results.
 */
export async function fetchForecastBatch(
  points: LatLng[],
  days = 3,
): Promise<WeatherForecast[]> {
  if (points.length === 0) return [];

  const params = new URLSearchParams({
    latitude: points.map((p) => p.latitude.toFixed(4)).join(','),
    longitude: points.map((p) => p.longitude.toFixed(4)).join(','),
    hourly: [
      'cloud_cover',
      'relative_humidity_2m',
      'visibility',
      'wind_speed_10m',
      'temperature_2m',
    ].join(','),
    forecast_days: String(days),
    timezone: 'UTC',
    wind_speed_unit: 'ms',
  });

  const res = await fetch(`${OPEN_METEO}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo batch request failed: ${res.status}`);
  }
  const raw = await res.json();
  const list: OpenMeteoResponse[] = Array.isArray(raw) ? raw : [raw];

  return list.map((r) => ({
    time: r.hourly.time,
    cloudCover: r.hourly.cloud_cover,
    humidity: r.hourly.relative_humidity_2m,
    visibility: r.hourly.visibility,
    windSpeed: r.hourly.wind_speed_10m,
    temperature: r.hourly.temperature_2m,
  }));
}
