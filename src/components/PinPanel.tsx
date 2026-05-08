import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { computeClearances, type TargetClearance } from '../services/clearance';
import { computeTerrainHorizon, type HorizonProfile } from '../services/horizon';
import { TARGETS, trackTargets, type TargetTrack } from '../services/targets';
import type { LatLng } from '../types';

import { HorizonRadar } from './HorizonRadar';

type Props = {
  pin: LatLng;
  /** Astronomical-darkness window for tonight at the pin. */
  nightStart: Date;
  nightEnd: Date;
  onClose: () => void;
};

export function PinPanel({ pin, nightStart, nightEnd, onClose }: Props) {
  const [horizon, setHorizon] = useState<HorizonProfile | null>(null);
  const [tracks, setTracks] = useState<TargetTrack[]>([]);
  const [clearances, setClearances] = useState<TargetClearance[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculate = async () => {
    setBusy(true);
    setError(null);
    try {
      const profile = await computeTerrainHorizon(pin, {
        azimuthCount: 36,
        samplesPerRay: 20,
        maxRangeKm: 10,
      });
      const ts = trackTargets(
        TARGETS,
        pin,
        nightStart,
        nightEnd,
        15,
        profile.observerElevation,
      );
      const cs = computeClearances(ts, profile);
      setHorizon(profile);
      setTracks(ts);
      setClearances(cs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Pinned spot</Text>
          <Text style={styles.subtitle}>
            {pin.latitude.toFixed(4)}, {pin.longitude.toFixed(4)}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 12 }}>
        {!horizon && !busy ? (
          <View style={styles.helpRow}>
            <Text style={styles.help}>
              Tap to compute terrain horizon (Google Elevation API) and tonight's
              target paths.
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {horizon ? <HorizonRadar horizon={horizon} tracks={tracks} /> : null}

        {clearances.length > 0 ? (
          <View style={styles.clearanceList}>
            {clearances.map((c) => (
              <Text key={c.target.id} style={styles.clearanceLine}>
                <Text style={{ color: c.target.color, fontWeight: '700' }}>•</Text>{' '}
                {clearanceLine(c)}
              </Text>
            ))}
          </View>
        ) : null}

        {horizon ? (
          <Text style={styles.meta}>
            Observer elevation {horizon.observerElevation.toFixed(0)} m · range {horizon.maxRangeKm} km · terrain only (no canopy or buildings yet)
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, styles.actionPrimary]}
          onPress={calculate}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#0B1020" />
          ) : (
            <Text style={styles.actionPrimaryText}>
              {horizon ? 'Recalculate horizon' : 'Calculate horizon'}
            </Text>
          )}
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => openInMaps(pin.latitude, pin.longitude)}
        >
          <Text style={styles.actionText}>Directions</Text>
        </Pressable>
      </View>
    </View>
  );
}

function clearanceLine(c: TargetClearance): string {
  const w = c.window;
  if (!w) return `${c.target.name}: below horizon all night.`;
  const startStr = w.start ? formatTime(w.start) : 'already up at dusk';
  const endStr = w.end ? formatTime(w.end) : 'still up at dawn';
  return `${c.target.name}: clears ${startStr}, dips ${endStr} (peak ${w.peakAlt.toFixed(0)}°).`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function openInMaps(lat: number, lng: number) {
  const label = encodeURIComponent('Pinned dark sky spot');
  const url = Platform.select({
    ios: `maps://?daddr=${lat},${lng}&q=${label}`,
    android: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
    default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  });
  if (url) Linking.openURL(url).catch(() => {});
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
    maxHeight: '70%',
    backgroundColor: '#121A33',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: '#F1F5FF', fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#9AA8C7', fontSize: 12, marginTop: 2 },
  close: { color: '#9AA8C7', fontSize: 28, paddingHorizontal: 4 },

  body: { marginTop: 12 },
  helpRow: { paddingVertical: 6 },
  help: { color: '#9AA8C7', fontSize: 12 },

  errorBox: {
    backgroundColor: '#3A1D1D',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  errorText: { color: '#FFB4B4', fontSize: 12 },

  clearanceList: { marginTop: 12, gap: 4 },
  clearanceLine: { color: '#F1F5FF', fontSize: 13 },

  meta: { color: '#9AA8C7', fontSize: 11, marginTop: 10 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flex: 1,
    backgroundColor: '#1A2447',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionPrimary: { backgroundColor: '#3DD68C' },
  actionPrimaryText: { color: '#0B1020', fontWeight: '700' },
  actionText: { color: '#F1F5FF', fontWeight: '600' },
});
