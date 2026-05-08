/**
 * Runtime configuration. Keys are read from EXPO_PUBLIC_* env vars at
 * build time so they get inlined into the bundle. Set them via:
 *
 *   .env.local             EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=...
 *
 * EXPO_PUBLIC_* values are intentionally exposed in the client bundle,
 * so use Google Cloud key restrictions (bundle ID / API restrictions)
 * to scope what the key can do.
 */
export const GOOGLE_MAPS_API_KEY: string =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export const ASTROSPHERIC_API_KEY: string =
  process.env.EXPO_PUBLIC_ASTROSPHERIC_API_KEY ?? '';

export const METEOBLUE_API_KEY: string =
  process.env.EXPO_PUBLIC_METEOBLUE_API_KEY ?? '';

/** Backend that proxies Google Earth Engine canopy-height samples (Phase 2). */
export const CANOPY_BACKEND_URL: string =
  process.env.EXPO_PUBLIC_CANOPY_BACKEND_URL ?? '';
