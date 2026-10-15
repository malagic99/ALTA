import Foundation
import CoreLocation

/// Pure-function clearance calculator: given a horizon profile, an
/// observer location, a night window, and a list of targets, returns
/// each target's path through the night plus the human-readable
/// "clears at" / "dips at" times the UI surfaces as the headline
/// readout.
///
/// All work is local — no network, no API key, no quota.
enum ClearanceCalculator {
    /// Sampling cadence through the night. 5 minutes is enough
    /// resolution that the reported clearance times don't visibly
    /// jitter when the user nudges the pin, while keeping the math
    /// at ~10 targets × 96 samples × cheap trig = sub-millisecond.
    static let sampleStepMinutes: Int = 5

    /// Tracks for the full catalog. Sorted so the most observable
    /// targets come first (peak altitude descending) — that's the
    /// most useful order for "what should I shoot tonight".
    static func tracksForCatalog(
        profile: HorizonProfile,
        observer: CLLocationCoordinate2D,
        window: TwilightWindow
    ) -> [TargetTrack] {
        let tracks = DSOCatalog.all.map {
            track(for: $0, profile: profile, observer: observer, window: window)
        }
        return tracks.sorted { lhs, rhs in
            // Visible targets above never-clears, then by peak alt.
            switch (lhs.neverClears, rhs.neverClears) {
            case (false, true): return true
            case (true, false): return false
            default: return lhs.peakAltitudeDegrees > rhs.peakAltitudeDegrees
            }
        }
    }

    /// Track for a single target.
    static func track(
        for target: DSOTarget,
        profile: HorizonProfile,
        observer: CLLocationCoordinate2D,
        window: TwilightWindow
    ) -> TargetTrack {
        guard window.quality != .neverDark else {
            return TargetTrack(
                target: target,
                samples: [],
                clearTime: nil,
                dipTime: nil,
                peakAltitudeDegrees: 0,
                peakTime: nil,
                upAtDusk: false,
                upAtDawn: false,
                neverClears: true
            )
        }

        let samples = sampleTrack(target: target, observer: observer, window: window, profile: profile)

        var firstVisible: Date?
        var lastVisible: Date?
        var peak: TargetSample?
        for sample in samples where sample.isVisible {
            if firstVisible == nil { firstVisible = sample.time }
            lastVisible = sample.time
            if peak == nil || sample.altitudeDegrees > peak!.altitudeDegrees {
                peak = sample
            }
        }

        let neverClears = (firstVisible == nil)
        let upAtDusk = (samples.first?.isVisible == true)
        let upAtDawn = (samples.last?.isVisible == true)

        return TargetTrack(
            target: target,
            samples: samples,
            clearTime: upAtDusk ? nil : firstVisible,
            dipTime: upAtDawn ? nil : lastVisible,
            peakAltitudeDegrees: peak?.altitudeDegrees ?? 0,
            peakTime: peak?.time,
            upAtDusk: upAtDusk,
            upAtDawn: upAtDawn,
            neverClears: neverClears
        )
    }

    // MARK: - Private

    private static func sampleTrack(
        target: DSOTarget,
        observer: CLLocationCoordinate2D,
        window: TwilightWindow,
        profile: HorizonProfile
    ) -> [TargetSample] {
        let step = TimeInterval(sampleStepMinutes * 60)
        var samples: [TargetSample] = []
        samples.reserveCapacity(Int(window.duration / step) + 2)

        var t = window.dusk
        while t <= window.dawn {
            let jd = Ephemeris.julianDate(t)
            let lst = Ephemeris.lstRadians(jd, longitudeDegrees: observer.longitude)
            let (altRad, azRad) = Ephemeris.equatorialToHorizontal(
                raRadians: target.raRadians,
                decRadians: target.decRadians,
                lstRadians: lst,
                latitudeDegrees: observer.latitude
            )
            let altDeg = Ephemeris.refractedAltitudeDegrees(
                altRad * Ephemeris.degreesPerRadian
            )
            let azDeg = azRad * Ephemeris.degreesPerRadian

            // Visibility: target altitude must clear both the geometric
            // horizon (alt > 0) AND the observer's local horizon profile
            // at that azimuth.
            let horizonAlt = profile.altitude(at: azDeg)
            let visible = altDeg > 0 && altDeg > horizonAlt

            samples.append(TargetSample(
                time: t,
                altitudeDegrees: altDeg,
                azimuthDegrees: azDeg,
                isVisible: visible
            ))

            t = t.addingTimeInterval(step)
        }
        return samples
    }
}

// MARK: - Formatting

extension TargetTrack {
    /// "Milky Way core: clears 11:30 PM, dips 2:00 AM (peak 32°)"
    /// or one of the edge-case variants.
    func clearanceSentence() -> String {
        if neverClears {
            return "Below horizon all night."
        }
        let timeFmt: (Date) -> String = { date in
            date.formatted(date: .omitted, time: .shortened)
        }
        let start = upAtDusk ? "up at dusk" : (clearTime.map { "clears \(timeFmt($0))" } ?? "clears —")
        let end   = upAtDawn ? "still up at dawn" : (dipTime.map { "dips \(timeFmt($0))" } ?? "dips —")
        return "\(start), \(end) (peak \(Int(peakAltitudeDegrees.rounded()))°)."
    }
}
