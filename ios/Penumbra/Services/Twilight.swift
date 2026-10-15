import Foundation
import CoreLocation

/// Window of useful astrophotography darkness for a single calendar
/// night. Falls back from astronomical (sun ≤ -18°) to nautical
/// (sun ≤ -12°) at high latitudes where true astro-darkness never
/// happens during summer.
struct TwilightWindow: Sendable, Equatable {
    enum Quality: String, Sendable {
        case astronomical = "Astronomical darkness"
        case nautical = "Nautical twilight only"
        case civil = "Civil twilight only"
        case neverDark = "No darkness tonight"
    }

    let dusk: Date
    let dawn: Date
    let quality: Quality

    var duration: TimeInterval { dawn.timeIntervalSince(dusk) }
}

/// Solver that scans sun altitude over the upcoming night to find
/// dusk and dawn. We sample every 5 minutes — accurate to better
/// than half a minute on the resulting times after a single bisection
/// pass, and the whole scan finishes in ~0.5 ms.
enum TwilightSolver {
    private static let astroAlt = -18.0
    private static let nauticalAlt = -12.0
    private static let civilAlt = -6.0

    /// Returns the twilight window covering the night that *starts*
    /// after `referenceDate` (defaulting to now). If the user opens
    /// the app at noon we look at tonight; if at 2 a.m. we still
    /// capture the rest of the current night.
    static func nextWindow(
        from referenceDate: Date = .now,
        latitudeDegrees: Double,
        longitudeDegrees: Double
    ) -> TwilightWindow {
        // Search a 36-hour span: from 6 hours before reference to 30
        // after. That covers "tonight" whether the user opens the app
        // at noon, midnight, or 4 a.m.
        let start = referenceDate.addingTimeInterval(-6 * 3600)
        let end = referenceDate.addingTimeInterval(30 * 3600)
        let stepSeconds: TimeInterval = 5 * 60

        // Try astronomical first; fall through to nautical / civil if
        // the sun never gets that low.
        for (alt, quality) in [
            (astroAlt, TwilightWindow.Quality.astronomical),
            (nauticalAlt, .nautical),
            (civilAlt, .civil),
        ] {
            if let window = findWindow(
                start: start,
                end: end,
                step: stepSeconds,
                threshold: alt,
                latitude: latitudeDegrees,
                longitude: longitudeDegrees
            ) {
                return TwilightWindow(dusk: window.dusk, dawn: window.dawn, quality: quality)
            }
        }

        // Polar day fallback: just hand back an empty window so the
        // UI can render "No darkness tonight" without crashing.
        return TwilightWindow(
            dusk: referenceDate,
            dawn: referenceDate,
            quality: .neverDark
        )
    }

    private static func findWindow(
        start: Date,
        end: Date,
        step: TimeInterval,
        threshold: Double,
        latitude: Double,
        longitude: Double
    ) -> (dusk: Date, dawn: Date)? {
        var dusk: Date?
        var dawn: Date?

        var prevTime = start
        var prevAlt = Ephemeris.sunAltitudeDegrees(
            at: prevTime,
            latitudeDegrees: latitude,
            longitudeDegrees: longitude
        )
        var t = start.addingTimeInterval(step)
        while t <= end {
            let alt = Ephemeris.sunAltitudeDegrees(
                at: t,
                latitudeDegrees: latitude,
                longitudeDegrees: longitude
            )
            // Descending crossing → dusk
            if dusk == nil, prevAlt > threshold, alt <= threshold {
                dusk = bisect(
                    a: prevTime, aValue: prevAlt,
                    b: t, bValue: alt,
                    threshold: threshold,
                    latitude: latitude,
                    longitude: longitude
                )
            }
            // Ascending crossing after dusk → dawn
            if dusk != nil, dawn == nil, prevAlt <= threshold, alt > threshold {
                dawn = bisect(
                    a: prevTime, aValue: prevAlt,
                    b: t, bValue: alt,
                    threshold: threshold,
                    latitude: latitude,
                    longitude: longitude
                )
                break
            }
            prevTime = t
            prevAlt = alt
            t = t.addingTimeInterval(step)
        }

        guard let dusk, let dawn, dawn > dusk else { return nil }
        return (dusk, dawn)
    }

    private static func bisect(
        a: Date, aValue: Double,
        b: Date, bValue: Double,
        threshold: Double,
        latitude: Double,
        longitude: Double,
        iterations: Int = 12
    ) -> Date {
        var lo = a
        var hi = b
        var loV = aValue
        var hiV = bValue
        for _ in 0..<iterations {
            let mid = Date(timeIntervalSince1970: (lo.timeIntervalSince1970 + hi.timeIntervalSince1970) / 2)
            let v = Ephemeris.sunAltitudeDegrees(
                at: mid,
                latitudeDegrees: latitude,
                longitudeDegrees: longitude
            )
            // Maintain the property that loV and hiV bracket `threshold`.
            if (loV - threshold) * (v - threshold) <= 0 {
                hi = mid
                hiV = v
            } else {
                lo = mid
                loV = v
            }
        }
        return Date(timeIntervalSince1970: (lo.timeIntervalSince1970 + hi.timeIntervalSince1970) / 2)
    }
}
