import SwiftUI

/// 360° altazimuth radar.
/// - Outer circle is the geometric horizon (alt 0°).
/// - Centre is the zenith (alt 90°).
/// - Shaded annulus between the outer circle and the obstruction polygon
///   is the unviewable terrain/canopy.
/// - Each `TargetTrack` is overlaid as a coloured curve through the
///   night, with the visible portion drawn solid and the obscured
///   portion dashed.
struct HorizonRadarView: View {
    let profile: HorizonProfile
    var tracks: [TargetTrack] = []

    var body: some View {
        Canvas { context, size in
            let cx = size.width / 2
            let cy = size.height / 2
            let radius = min(size.width, size.height) / 2 - 18

            // Backdrop circle (sky).
            let skyRect = CGRect(x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2)
            context.fill(Path(ellipseIn: skyRect), with: .color(Color(red: 0.05, green: 0.09, blue: 0.20)))

            // Concentric altitude rings at 30° and 60°.
            for altLine in [30.0, 60.0] {
                let r = radius * (1 - altLine / 90)
                let rect = CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2)
                context.stroke(
                    Path(ellipseIn: rect),
                    with: .color(.white.opacity(0.08)),
                    lineWidth: 1
                )
            }

            // Cardinal spokes.
            for az in [0.0, 90.0, 180.0, 270.0] {
                let p = polar(cx: cx, cy: cy, r: radius, azDeg: az)
                var path = Path()
                path.move(to: CGPoint(x: cx, y: cy))
                path.addLine(to: p)
                context.stroke(path, with: .color(.white.opacity(0.10)), lineWidth: 1)
            }

            // Obstruction band (between outer circle and the per-azimuth altitude).
            if !profile.azimuths.isEmpty {
                var inner = Path()
                for (i, az) in profile.azimuths.enumerated() {
                    let alt = max(0, min(90, profile.altitudes[i]))
                    let r = radius * (1 - alt / 90)
                    let p = polar(cx: cx, cy: cy, r: r, azDeg: az)
                    if i == 0 {
                        inner.move(to: p)
                    } else {
                        inner.addLine(to: p)
                    }
                }
                inner.closeSubpath()

                // Outer ring approximated with the same number of segments
                // so we can fill the annulus via even-odd.
                var outer = Path()
                let n = max(72, profile.azimuths.count)
                for i in 0..<n {
                    let az = 360.0 * Double(i) / Double(n)
                    let p = polar(cx: cx, cy: cy, r: radius, azDeg: az)
                    if i == 0 { outer.move(to: p) } else { outer.addLine(to: p) }
                }
                outer.closeSubpath()

                var combined = outer
                combined.addPath(inner)
                context.fill(
                    combined,
                    with: .color(Color(red: 0.10, green: 0.14, blue: 0.28)),
                    style: FillStyle(eoFill: true)
                )
                context.stroke(
                    inner,
                    with: .color(Color(red: 0.23, green: 0.30, blue: 0.48)),
                    lineWidth: 1
                )
            }

            // Target tracks. Each track is a polyline through the
            // night; we draw the visible portion solid and the
            // obscured portion as a dashed ghost so users can still
            // see "the target was up there but blocked by trees".
            for track in tracks where track.isVisibleSomeTime || hasAnyAboveZero(track) {
                drawTrack(track, context: context, cx: cx, cy: cy, radius: radius)
            }

            // Outer rim.
            context.stroke(
                Path(ellipseIn: skyRect),
                with: .color(Color(red: 0.23, green: 0.30, blue: 0.48)),
                lineWidth: 1.5
            )

            // Cardinal labels.
            for (label, az) in [("N", 0.0), ("E", 90.0), ("S", 180.0), ("W", 270.0)] {
                let p = polar(cx: cx, cy: cy, r: radius + 9, azDeg: az)
                let text = Text(label).font(.caption2.weight(.bold)).foregroundColor(.secondary)
                context.draw(text, at: p, anchor: .center)
            }
        }
    }

    private func hasAnyAboveZero(_ track: TargetTrack) -> Bool {
        track.samples.contains { $0.altitudeDegrees > 0 }
    }

    private func drawTrack(
        _ track: TargetTrack,
        context: GraphicsContext,
        cx: CGFloat,
        cy: CGFloat,
        radius: CGFloat
    ) {
        // Build segments split on visibility transitions so we can
        // style visible vs obscured differently in one pass.
        var segments: [(visible: Bool, points: [CGPoint])] = []
        var current: (visible: Bool, points: [CGPoint])?

        for sample in track.samples where sample.altitudeDegrees > 0 {
            let r = radius * (1 - sample.altitudeDegrees / 90)
            let p = polar(cx: cx, cy: cy, r: r, azDeg: sample.azimuthDegrees)
            if current == nil || current!.visible != sample.isVisible {
                if let c = current { segments.append(c) }
                current = (sample.isVisible, [p])
            } else {
                current?.points.append(p)
            }
        }
        if let c = current { segments.append(c) }

        let solid = StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round)
        let dashed = StrokeStyle(
            lineWidth: 1.2,
            lineCap: .round,
            lineJoin: .round,
            dash: [2.5, 3.5]
        )

        for segment in segments {
            guard segment.points.count >= 2 else { continue }
            var path = Path()
            path.move(to: segment.points[0])
            for p in segment.points.dropFirst() {
                path.addLine(to: p)
            }
            let color = segment.visible
                ? track.target.tint
                : track.target.tint.opacity(0.35)
            context.stroke(path, with: .color(color), style: segment.visible ? solid : dashed)
        }

        // Mark peak with a small filled disc, if visible at all.
        if let peakTime = track.peakTime,
           let peak = track.samples.first(where: { $0.time == peakTime }),
           peak.altitudeDegrees > 0 {
            let r = radius * (1 - peak.altitudeDegrees / 90)
            let p = polar(cx: cx, cy: cy, r: r, azDeg: peak.azimuthDegrees)
            let dot = CGRect(x: p.x - 2.5, y: p.y - 2.5, width: 5, height: 5)
            context.fill(Path(ellipseIn: dot), with: .color(track.target.tint))
            context.stroke(
                Path(ellipseIn: dot),
                with: .color(.black.opacity(0.5)),
                lineWidth: 0.8
            )
        }
    }

    private func polar(cx: CGFloat, cy: CGFloat, r: CGFloat, azDeg: Double) -> CGPoint {
        let az = azDeg * .pi / 180
        return CGPoint(x: cx + r * sin(az), y: cy - r * cos(az))
    }
}
