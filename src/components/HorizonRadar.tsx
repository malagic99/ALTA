import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Polyline, Text as SvgText } from 'react-native-svg';

import type { HorizonProfile } from '../services/horizon';
import type { TargetTrack } from '../services/targets';

type Props = {
  horizon: HorizonProfile;
  tracks: TargetTrack[];
  size?: number;
};

const PADDING = 18;

/**
 * 360° altazimuth radar.
 *  - Outer circle is the geometric horizon (alt 0°).
 *  - Center is the zenith (alt 90°).
 *  - The shaded annular band between the geometric horizon and the
 *    obstruction polygon is unviewable terrain; sky inside the polygon
 *    is open.
 *  - Each target's path through the sky is drawn as a coloured polyline
 *    over the same alt/az grid.
 */
export function HorizonRadar({ horizon, tracks, size = 280 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - PADDING;

  const obstructionPoints = horizon.azimuths.map((az, i) => {
    const alt = horizon.altitudes[i];
    const radius = r * (1 - clamp(alt, 0, 90) / 90);
    return polarToXY(cx, cy, radius, az);
  });

  // Closed polygon path covering the obstruction annulus, so it can be
  // filled with a single <Path>.
  const obstructionPath = buildAnnulusPath(cx, cy, r, obstructionPoints);

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="#0E1733" />

        {[30, 60].map((altLine) => (
          <Circle
            key={altLine}
            cx={cx}
            cy={cy}
            r={r * (1 - altLine / 90)}
            stroke="#27345E"
            strokeWidth={1}
            fill="none"
          />
        ))}

        {/* Cardinal direction tick lines */}
        {[0, 90, 180, 270].map((az) => {
          const end = polarToXY(cx, cy, r, az);
          return (
            <Line
              key={az}
              x1={cx}
              y1={cy}
              x2={end.x}
              y2={end.y}
              stroke="#27345E"
              strokeWidth={1}
            />
          );
        })}

        <Path d={obstructionPath} fill="#1A2447" stroke="#3B4B7A" strokeWidth={1} />

        {tracks.map((track) => (
          <G key={track.target.id}>
            <Polyline
              points={track.points
                .filter((p) => p.alt > -3)
                .map((p) => {
                  const radius = r * (1 - clamp(p.alt, 0, 90) / 90);
                  const xy = polarToXY(cx, cy, radius, p.az);
                  return `${xy.x},${xy.y}`;
                })
                .join(' ')}
              fill="none"
              stroke={track.target.color}
              strokeWidth={2}
              strokeOpacity={0.9}
            />
          </G>
        ))}

        <Circle cx={cx} cy={cy} r={r} stroke="#3B4B7A" strokeWidth={1.5} fill="none" />

        {[
          { label: 'N', az: 0 },
          { label: 'E', az: 90 },
          { label: 'S', az: 180 },
          { label: 'W', az: 270 },
        ].map(({ label, az }) => {
          const xy = polarToXY(cx, cy, r + 8, az);
          return (
            <SvgText
              key={label}
              x={xy.x}
              y={xy.y + 4}
              fontSize={11}
              fontWeight="700"
              fill="#9AA8C7"
              textAnchor="middle"
            >
              {label}
            </SvgText>
          );
        })}
      </Svg>

      <View style={styles.legend}>
        {tracks.map((t) => (
          <View key={t.target.id} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: t.target.color }]} />
            <Text style={styles.legendText}>{t.target.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function polarToXY(cx: number, cy: number, r: number, azDeg: number) {
  const az = (azDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(az), y: cy - r * Math.cos(az) };
}

function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

/**
 * Builds a single SVG path that fills the annular region between the
 * outer horizon circle and the obstruction-altitude polygon.
 */
function buildAnnulusPath(
  cx: number,
  cy: number,
  r: number,
  innerPoints: { x: number; y: number }[],
): string {
  if (innerPoints.length === 0) return '';
  // Outer ring as a circle approximated by 72-vertex polygon (clockwise)
  const outer: { x: number; y: number }[] = [];
  for (let i = 0; i < 72; i++) {
    const az = (360 * i) / 72;
    outer.push(polarToXY(cx, cy, r, az));
  }

  const outerD = outer.map((p, i) => (i === 0 ? `M${p.x} ${p.y}` : `L${p.x} ${p.y}`)).join(' ');
  // Reverse inner so the two subpaths have opposite winding (even-odd fill)
  const innerRev = [...innerPoints].reverse();
  const innerD = innerRev.map((p, i) => (i === 0 ? `M${p.x} ${p.y}` : `L${p.x} ${p.y}`)).join(' ');
  return `${outerD} Z ${innerD} Z`;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  legend: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: '#9AA8C7', fontSize: 11 },
});
