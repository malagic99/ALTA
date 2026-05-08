import { horizonAltAt, type HorizonProfile } from './horizon';
import type { TargetTrack } from './targets';

export type ClearanceWindow = {
  /** Start of clearance (target rises above the local horizon). */
  start: Date | null;
  /** End of clearance (target dips below the local horizon). */
  end: Date | null;
  /** Peak altitude during the clearance window, degrees. */
  peakAlt: number;
  /** Azimuth at peak altitude. */
  peakAz: number;
  /** Was the target above the horizon at the very start of the window? */
  alreadyUpAtStart: boolean;
  /** Was the target still above the horizon at the very end of the window? */
  stillUpAtEnd: boolean;
};

export type TargetClearance = {
  target: TargetTrack['target'];
  /** First clearance window in the time range; null if never above horizon. */
  window: ClearanceWindow | null;
};

/**
 * For each target track, finds the first contiguous interval where the
 * target is above the local horizon (terrain + obstructions). Returns
 * peak alt and azimuth so UI can show the best photo time.
 */
export function computeClearances(
  tracks: TargetTrack[],
  horizon: HorizonProfile,
): TargetClearance[] {
  return tracks.map((track) => ({
    target: track.target,
    window: firstClearanceWindow(track, horizon),
  }));
}

function firstClearanceWindow(
  track: TargetTrack,
  horizon: HorizonProfile,
): ClearanceWindow | null {
  const visibility = track.points.map((p) => ({
    ...p,
    horizonAlt: horizonAltAt(horizon, p.az),
    visible: p.alt > horizonAltAt(horizon, p.az),
  }));

  let startIdx = visibility.findIndex((p) => p.visible);
  if (startIdx === -1) return null;

  let endIdx = startIdx;
  while (endIdx + 1 < visibility.length && visibility[endIdx + 1].visible) {
    endIdx++;
  }

  let peakAlt = -90;
  let peakAz = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const p = visibility[i];
    if (p.alt > peakAlt) {
      peakAlt = p.alt;
      peakAz = p.az;
    }
  }

  const alreadyUpAtStart = startIdx === 0;
  const stillUpAtEnd = endIdx === visibility.length - 1;

  return {
    start: alreadyUpAtStart
      ? null
      : interpCrossing(visibility, startIdx - 1, startIdx),
    end: stillUpAtEnd ? null : interpCrossing(visibility, endIdx, endIdx + 1),
    peakAlt,
    peakAz,
    alreadyUpAtStart,
    stillUpAtEnd,
  };
}

/**
 * Linearly interpolate the moment the target's altitude crossed its local
 * horizon between two adjacent samples (one below, one above).
 */
function interpCrossing(
  pts: { t: number; alt: number; horizonAlt: number }[],
  i: number,
  j: number,
): Date {
  const a = pts[i];
  const b = pts[j];
  // Solve (alt - horizonAlt) at t = 0
  const fa = a.alt - a.horizonAlt;
  const fb = b.alt - b.horizonAlt;
  const denom = fb - fa;
  if (Math.abs(denom) < 1e-9) return new Date(b.t);
  const u = -fa / denom;
  const t = a.t + u * (b.t - a.t);
  return new Date(t);
}

export function describeClearance(c: TargetClearance): string {
  const w = c.window;
  if (!w) return `${c.target.name}: stays below the horizon all night.`;
  const startStr = w.start ? formatTime(w.start) : 'already up at dusk';
  const endStr = w.end ? formatTime(w.end) : 'still up at dawn';
  return `${c.target.name}: clears ${startStr} → dips ${endStr} (peak ${w.peakAlt.toFixed(0)}° alt).`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
