import Foundation

/// Pure-Swift astronomical ephemeris. Self-contained — no SPM
/// dependency, no API call, no key, no quota.
///
/// Accuracy is sub-degree for arbitrary epochs and sub-arcminute
/// for the next few decades, which is more than enough for "is the
/// Milky Way core above the trees" decisions. Sources:
///   - Jean Meeus, "Astronomical Algorithms" 2nd ed. (1998)
///   - USNO Circular 179
///   - Saemundsson refraction formula (Sky & Telescope, 1986)
enum Ephemeris {
    static let degreesPerRadian = 180.0 / .pi
    static let radiansPerDegree = .pi / 180.0

    /// Julian Date for a given moment. JD 2440587.5 = 1970-01-01T00:00Z.
    static func julianDate(_ date: Date) -> Double {
        2440587.5 + date.timeIntervalSince1970 / 86_400.0
    }

    /// Greenwich Mean Sidereal Time, in radians, normalised to [0, 2π).
    /// IAU low-precision form — accurate to a few milliseconds, plenty
    /// for our use case.
    static func gmstRadians(_ jd: Double) -> Double {
        // 18h 41m 50.54841s at J2000 + 24.06570982441908 h per Julian day
        let elapsed = jd - 2_451_545.0
        var hours = 18.697374558 + 24.065_709_824_419_08 * elapsed
        hours.formTruncatingRemainder(dividingBy: 24)
        if hours < 0 { hours += 24 }
        return hours * 15 * radiansPerDegree
    }

    /// Local Mean Sidereal Time at the observer's longitude (radians,
    /// [0, 2π)). East-positive longitude convention.
    static func lstRadians(_ jd: Double, longitudeDegrees: Double) -> Double {
        var lst = gmstRadians(jd) + longitudeDegrees * radiansPerDegree
        lst.formTruncatingRemainder(dividingBy: 2 * .pi)
        if lst < 0 { lst += 2 * .pi }
        return lst
    }

    /// True (un-refracted) altitude and azimuth at the observer for an
    /// equatorial coordinate. RA in radians, Dec in radians, output in
    /// radians. Azimuth follows the navigation convention (0 = north,
    /// increases clockwise through east).
    static func equatorialToHorizontal(
        raRadians ra: Double,
        decRadians dec: Double,
        lstRadians lst: Double,
        latitudeDegrees lat: Double
    ) -> (altitude: Double, azimuth: Double) {
        let H = lst - ra
        let phi = lat * radiansPerDegree

        let sinAlt = sin(dec) * sin(phi) + cos(dec) * cos(phi) * cos(H)
        let alt = asin(min(1, max(-1, sinAlt)))

        let cosAlt = cos(alt)
        // Numerator/denominator come from the standard rotation; atan2
        // resolves the quadrant cleanly without explicit branching.
        let sinAz = -cos(dec) * sin(H) / cosAlt
        let cosAz = (sin(dec) - sin(alt) * sin(phi)) / (cosAlt * cos(phi))
        var az = atan2(sinAz, cosAz)
        if az < 0 { az += 2 * .pi }
        return (alt, az)
    }

    /// Adds atmospheric refraction (Saemundsson). Input/output in
    /// degrees. Below ~-1.5° the formula diverges, so we leave very
    /// negative altitudes unchanged.
    static func refractedAltitudeDegrees(_ trueAltitudeDegrees: Double) -> Double {
        guard trueAltitudeDegrees > -1.5 else { return trueAltitudeDegrees }
        let h = trueAltitudeDegrees
        let arcminutes = 1.02 / tan((h + 10.3 / (h + 5.11)) * radiansPerDegree)
        return h + arcminutes / 60.0
    }

    /// Geocentric apparent RA/Dec of the Sun (radians) for a given JD.
    /// Low-precision formula good to ~1 arcminute through the 21st
    /// century — fine for finding twilight times.
    static func sunPosition(_ jd: Double) -> (raRadians: Double, decRadians: Double) {
        let n = jd - 2_451_545.0
        // Mean longitude and mean anomaly (degrees)
        var L = 280.460 + 0.985_647_4 * n
        var g = 357.528 + 0.985_600_3 * n
        L.formTruncatingRemainder(dividingBy: 360)
        g.formTruncatingRemainder(dividingBy: 360)
        if L < 0 { L += 360 }
        if g < 0 { g += 360 }

        // Ecliptic longitude (apparent), latitude assumed 0
        let gRad = g * radiansPerDegree
        let lambda = L + 1.915 * sin(gRad) + 0.020 * sin(2 * gRad)
        let lambdaRad = lambda * radiansPerDegree

        // Obliquity of the ecliptic
        let epsilonRad = (23.439 - 0.000_000_4 * n) * radiansPerDegree

        let ra = atan2(cos(epsilonRad) * sin(lambdaRad), cos(lambdaRad))
        let dec = asin(sin(epsilonRad) * sin(lambdaRad))
        return (ra < 0 ? ra + 2 * .pi : ra, dec)
    }

    /// Sun altitude (degrees, refracted) at observer for a given moment.
    static func sunAltitudeDegrees(
        at date: Date,
        latitudeDegrees lat: Double,
        longitudeDegrees lon: Double
    ) -> Double {
        let jd = julianDate(date)
        let (ra, dec) = sunPosition(jd)
        let lst = lstRadians(jd, longitudeDegrees: lon)
        let (altRad, _) = equatorialToHorizontal(
            raRadians: ra,
            decRadians: dec,
            lstRadians: lst,
            latitudeDegrees: lat
        )
        return refractedAltitudeDegrees(altRad * degreesPerRadian)
    }
}
