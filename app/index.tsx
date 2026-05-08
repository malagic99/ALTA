import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  UrlTile,
  type Region,
} from 'react-native-maps';

import { PinPanel } from '../src/components/PinPanel';
import { SpotDetails } from '../src/components/SpotDetails';
import { StatusBanner } from '../src/components/StatusBanner';
import { darknessWindow } from '../src/services/astronomy';
import { findDarkSkySpots } from '../src/services/candidates';
import { LIGHT_POLLUTION_TILE_URL } from '../src/services/lightPollution';
import { scoreColor } from '../src/services/scoring';
import type { Candidate, LatLng } from '../src/types';

const RADIUS_PRESETS_KM = [50, 120, 250] as const;
type RadiusKm = (typeof RADIUS_PRESETS_KM)[number];

export default function HomeScreen() {
  const mapRef = useRef<MapView>(null);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; tone?: 'info' | 'error' } | null>(
    { message: 'Locating you…' },
  );
  const [showOverlay, setShowOverlay] = useState(true);
  const [droppedPin, setDroppedPin] = useState<LatLng | null>(null);
  const [radiusKm, setRadiusKm] = useState<RadiusKm>(120);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [, setNow] = useState(Date.now()); // tick to refresh "x ago"

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setStatus({
          message: 'Location permission denied. Showing default region.',
          tone: 'error',
        });
        setOrigin({ latitude: 39.5, longitude: -106.0 }); // dark Colorado fallback
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setOrigin({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
    })();
  }, []);

  const initialRegion: Region | undefined = useMemo(() => {
    if (!origin) return undefined;
    return {
      latitude: origin.latitude,
      longitude: origin.longitude,
      latitudeDelta: 2.5,
      longitudeDelta: 2.5,
    };
  }, [origin]);

  const search = useCallback(
    async (r: RadiusKm) => {
      if (!origin) return;
      setBusy(true);
      setStatus({ message: `Scanning ${r} km radius for the next 3 nights…` });
      try {
        const results = await findDarkSkySpots({
          origin,
          radiusKm: r,
          count: 18,
          days: 3,
        });
        setCandidates(results);
        setLastUpdated(Date.now());
        setStatus({
          message: results.length
            ? `Ranked ${results.length} spots. Tap a marker, or long-press the map to inspect a custom spot.`
            : 'No candidate spots returned.',
        });
        const top = results[0];
        if (top && mapRef.current) {
          mapRef.current.animateToRegion(
            {
              latitude: top.location.latitude,
              longitude: top.location.longitude,
              latitudeDelta: Math.max(2, r / 50),
              longitudeDelta: Math.max(2, r / 50),
            },
            600,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setStatus({ message: `Search failed: ${msg}`, tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [origin],
  );

  useEffect(() => {
    if (origin) search(radiusKm);
  }, [origin, radiusKm, search]);

  const recenter = useCallback(() => {
    if (!origin || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: origin.latitude,
        longitude: origin.longitude,
        latitudeDelta: Math.max(2, radiusKm / 50),
        longitudeDelta: Math.max(2, radiusKm / 50),
      },
      400,
    );
  }, [origin, radiusKm]);

  if (!origin || !initialRegion) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Locating you…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton={false}
        onLongPress={(e) => {
          const c = e.nativeEvent.coordinate;
          setSelected(null);
          setDroppedPin({ latitude: c.latitude, longitude: c.longitude });
        }}
      >
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
        />
        {showOverlay ? (
          <UrlTile
            urlTemplate={LIGHT_POLLUTION_TILE_URL}
            maximumZ={8}
            opacity={0.55}
            zIndex={2}
          />
        ) : null}

        {candidates.map((c, i) => (
          <Marker
            key={c.id}
            coordinate={c.location}
            onPress={() => {
              setDroppedPin(null);
              setSelected(c);
            }}
            pinColor={scoreColor(c.score.total)}
            title={`#${i + 1} · Score ${c.score.total}`}
            description={`Bortle ${c.bortle} · ${c.distanceKm.toFixed(0)} km`}
          />
        ))}

        {droppedPin ? (
          <Marker
            coordinate={droppedPin}
            pinColor="#56CCF2"
            draggable
            onDragEnd={(e) => {
              const c = e.nativeEvent.coordinate;
              setDroppedPin({ latitude: c.latitude, longitude: c.longitude });
            }}
            title="Pinned spot"
            description="Long-press to move; use the panel to compute horizon"
          />
        ) : null}
      </MapView>

      {status ? (
        <StatusBanner
          message={
            lastUpdated && !busy
              ? `${status.message} · Updated ${formatRelative(lastUpdated)}`
              : status.message
          }
          busy={busy}
          tone={status.tone}
        />
      ) : null}

      <View style={styles.topControls}>
        <View style={styles.pillRow}>
          {RADIUS_PRESETS_KM.map((r) => (
            <Pressable
              key={r}
              onPress={() => setRadiusKm(r)}
              disabled={busy}
              style={[styles.pill, radiusKm === r && styles.pillActive]}
            >
              <Text
                style={[
                  styles.pillText,
                  radiusKm === r && styles.pillTextActive,
                ]}
              >
                {r} km
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.button, styles.buttonGhost]}
          onPress={() => setShowOverlay((v) => !v)}
        >
          <Text style={styles.buttonGhostText}>
            {showOverlay ? 'Hide LP overlay' : 'Show LP overlay'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.fabColumn}>
        <Pressable
          style={[styles.fab, styles.fabPrimary]}
          onPress={() => search(radiusKm)}
          disabled={busy}
        >
          <Text style={styles.fabPrimaryText}>{busy ? '…' : '↻'}</Text>
        </Pressable>
        <Pressable style={styles.fab} onPress={recenter}>
          <Text style={styles.fabText}>◎</Text>
        </Pressable>
      </View>

      {selected ? (
        <SpotDetails candidate={selected} onClose={() => setSelected(null)} />
      ) : null}

      {droppedPin ? <PinPanelHost pin={droppedPin} onClose={() => setDroppedPin(null)} /> : null}
    </View>
  );
}

/**
 * Resolves the astronomical-darkness window for the dropped pin's location
 * and tonight, then renders the PinPanel. Falls back to a sane window if
 * SunCalc returns nothing (polar day): start = now, end = now + 8h.
 */
function PinPanelHost({ pin, onClose }: { pin: LatLng; onClose: () => void }) {
  const { nightStart, nightEnd } = useMemo(() => {
    const w = darknessWindow(pin, new Date());
    if (w) return { nightStart: w.start, nightEnd: w.end };
    const start = new Date();
    const end = new Date(start.getTime() + 8 * 3600_000);
    return { nightStart: start, nightEnd: end };
  }, [pin.latitude, pin.longitude]);
  return (
    <PinPanel pin={pin} nightStart={nightStart} nightEnd={nightEnd} onClose={onClose} />
  );
}

function formatRelative(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  loading: {
    flex: 1,
    backgroundColor: '#0B1020',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { color: '#F1F5FF', fontSize: 14 },

  topControls: {
    position: 'absolute',
    top: 70,
    right: 12,
    gap: 8,
    alignItems: 'flex-end',
  },
  pillRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(18, 26, 51, 0.92)',
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  pillActive: { backgroundColor: '#3DD68C' },
  pillText: { color: '#9AA8C7', fontWeight: '600', fontSize: 12 },
  pillTextActive: { color: '#0B1020' },

  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  buttonGhost: { backgroundColor: 'rgba(18, 26, 51, 0.92)' },
  buttonGhostText: { color: '#F1F5FF', fontWeight: '600', fontSize: 12 },

  fabColumn: {
    position: 'absolute',
    bottom: 220,
    right: 12,
    gap: 10,
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(18, 26, 51, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { color: '#F1F5FF', fontSize: 20 },
  fabPrimary: { backgroundColor: '#3DD68C' },
  fabPrimaryText: { color: '#0B1020', fontSize: 20, fontWeight: '700' },
});
