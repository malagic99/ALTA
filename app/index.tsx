import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  UrlTile,
  type Region,
} from 'react-native-maps';

import { SpotDetails } from '../src/components/SpotDetails';
import { StatusBanner } from '../src/components/StatusBanner';
import { findDarkSkySpots } from '../src/services/candidates';
import { LIGHT_POLLUTION_TILE_URL } from '../src/services/lightPollution';
import { scoreColor } from '../src/services/scoring';
import type { Candidate, LatLng } from '../src/types';

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

  const search = useCallback(async () => {
    if (!origin) return;
    setBusy(true);
    setStatus({ message: 'Scanning the next 3 nights for clear skies…' });
    try {
      const results = await findDarkSkySpots({ origin, radiusKm: 120, count: 18, days: 3 });
      setCandidates(results);
      setStatus({
        message: results.length
          ? `Ranked ${results.length} spots. Tap a marker for details.`
          : 'No candidate spots returned.',
      });
      const top = results[0];
      if (top && mapRef.current) {
        mapRef.current.animateToRegion(
          {
            latitude: top.location.latitude,
            longitude: top.location.longitude,
            latitudeDelta: 2,
            longitudeDelta: 2,
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
  }, [origin]);

  useEffect(() => {
    if (origin) search();
  }, [origin, search]);

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
      >
        {/* OSM basemap so we don't depend on Apple/Google credentials. */}
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
            onPress={() => setSelected(c)}
            pinColor={scoreColor(c.score.total)}
            title={`#${i + 1} · Score ${c.score.total}`}
            description={`Bortle ${c.bortle} · ${c.distanceKm.toFixed(0)} km`}
          />
        ))}
      </MapView>

      {status ? <StatusBanner message={status.message} busy={busy} tone={status.tone} /> : null}

      <View style={styles.controls}>
        <Pressable
          style={styles.button}
          onPress={search}
          disabled={busy}
        >
          <Text style={styles.buttonText}>{busy ? 'Searching…' : 'Refresh'}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonGhost]}
          onPress={() => setShowOverlay((v) => !v)}
        >
          <Text style={styles.buttonText}>
            {showOverlay ? 'Hide LP overlay' : 'Show LP overlay'}
          </Text>
        </Pressable>
      </View>

      {selected ? (
        <SpotDetails candidate={selected} onClose={() => setSelected(null)} />
      ) : null}
    </View>
  );
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
  controls: {
    position: 'absolute',
    top: 70,
    right: 12,
    gap: 8,
    alignItems: 'flex-end',
  },
  button: {
    backgroundColor: '#3DD68C',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  buttonGhost: { backgroundColor: '#1A2447' },
  buttonText: { color: '#0B1020', fontWeight: '700' },
});
