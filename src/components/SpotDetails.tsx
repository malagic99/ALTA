import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Candidate } from '../types';
import { bortleLabel } from '../services/lightPollution';
import { scoreColor, scoreLabel } from '../services/scoring';

type Props = {
  candidate: Candidate;
  onClose: () => void;
};

export function SpotDetails({ candidate, onClose }: Props) {
  const { score, nights, bestNightIndex, bortle, distanceKm } = candidate;
  const bestNight = nights[bestNightIndex];

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <View style={[styles.scoreBubble, { backgroundColor: scoreColor(score.total) }]}>
          <Text style={styles.scoreNum}>{score.total}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{scoreLabel(score.total)} conditions</Text>
          <Text style={styles.subtitle}>
            {distanceKm.toFixed(0)} km away · Bortle {bortle} · {bortleLabel(bortle)}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.nights}>
        {nights.map((n, i) => (
          <View
            key={n.date}
            style={[styles.nightCard, i === bestNightIndex && styles.bestNight]}
          >
            <Text style={styles.nightDate}>{formatDate(n.date)}</Text>
            <Stat label="Cloud" value={`${Math.round(n.meanCloud)}%`} />
            <Stat label="Humidity" value={`${Math.round(n.meanHumidity)}%`} />
            <Stat
              label="Moon"
              value={`${Math.round(n.moonIllumination * 100)}% · ${Math.round(
                n.moonUpFraction * 100,
              )}% up`}
            />
          </View>
        ))}
      </ScrollView>

      <View style={styles.breakdown}>
        <BreakdownBar label="Cloud" value={score.cloud} />
        <BreakdownBar label="Light pollution" value={score.lightPollution} />
        <BreakdownBar label="Moon" value={score.moon} />
        <BreakdownBar label="Humidity" value={score.humidity} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function BreakdownBar({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <View style={styles.breakdownTrack}>
        <View
          style={[
            styles.breakdownFill,
            { width: `${value}%`, backgroundColor: scoreColor(value) },
          ]}
        />
      </View>
      <Text style={styles.breakdownValue}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 16,
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
  scoreBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreNum: { color: '#0B1020', fontSize: 20, fontWeight: '700' },
  title: { color: '#F1F5FF', fontSize: 16, fontWeight: '600' },
  subtitle: { color: '#9AA8C7', fontSize: 12, marginTop: 2 },
  close: { color: '#9AA8C7', fontSize: 28, paddingHorizontal: 4 },

  nights: { marginTop: 14 },
  nightCard: {
    backgroundColor: '#1A2447',
    borderRadius: 12,
    padding: 12,
    marginRight: 8,
    minWidth: 140,
  },
  bestNight: { borderWidth: 1, borderColor: '#7ED957' },
  nightDate: { color: '#F1F5FF', fontWeight: '600', marginBottom: 6 },
  stat: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  statLabel: { color: '#9AA8C7', fontSize: 12 },
  statValue: { color: '#F1F5FF', fontSize: 12 },

  breakdown: { marginTop: 14, gap: 6 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLabel: { color: '#9AA8C7', fontSize: 12, width: 110 },
  breakdownTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#1A2447',
    borderRadius: 3,
    overflow: 'hidden',
  },
  breakdownFill: { height: '100%' },
  breakdownValue: {
    color: '#F1F5FF',
    fontSize: 12,
    width: 28,
    textAlign: 'right',
  },
});
