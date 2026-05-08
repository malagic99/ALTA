import SwiftUI

/// 360° altazimuth radar.
/// - Outer circle is the geometric horizon (alt 0°).
/// - Centre is the zenith (alt 90°).
/// - Shaded annulus between the outer circle and the obstruction polygon
///   is the unviewable terrain/canopy.
struct HorizonRadarView: View {
    let profile: HorizonProfile

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

    private func polar(cx: CGFloat, cy: CGFloat, r: CGFloat, azDeg: Double) -> CGPoint {
        let az = azDeg * .pi / 180
        return CGPoint(x: cx + r * sin(az), y: cy - r * cos(az))
    }
}
