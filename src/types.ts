export type LatLng = {
  latitude: number;
  longitude: number;
};

export type WeatherForecast = {
  /** Hourly timestamps (ISO) for the requested window. */
  time: string[];
  /** % cloud cover, 0-100. */
  cloudCover: number[];
  /** % relative humidity, 0-100. */
  humidity: number[];
  /** Horizontal visibility in meters. */
  visibility: number[];
  /** Wind speed m/s. */
  windSpeed: number[];
  /** Air temperature in C. */
  temperature: number[];
};

export type AstroNight = {
  /** Local night the score applies to (YYYY-MM-DD of the evening). */
  date: string;
  /** Astronomical-darkness window for that night (UTC ISO). */
  start: string;
  end: string;
  /** Mean cloud cover during the window, 0-100. */
  meanCloud: number;
  /** Mean humidity during the window, 0-100. */
  meanHumidity: number;
  /** Mean visibility (m) during the window. */
  meanVisibility: number;
  /** Moon illumination fraction, 0-1, at the window midpoint. */
  moonIllumination: number;
  /** Fraction of the window the moon is above the horizon, 0-1. */
  moonUpFraction: number;
};

export type SkyScore = {
  /** Composite score 0-100, higher is better. */
  total: number;
  /** Sub-scores 0-100 for transparency in UI. */
  cloud: number;
  moon: number;
  lightPollution: number;
  humidity: number;
};

export type Candidate = {
  id: string;
  location: LatLng;
  /** Distance from origin in km. */
  distanceKm: number;
  /** Bortle estimate 1 (excellent) to 9 (inner-city). */
  bortle: number;
  /** Per-night forecast and astro context. */
  nights: AstroNight[];
  /** Best-night score. */
  score: SkyScore;
  /** Index in `nights` of the best-scoring night. */
  bestNightIndex: number;
};
