import Foundation
import CoreLocation

// MARK: - Value types

struct LatLng: Codable, Hashable, Sendable {
    var lat: Double
    var lng: Double

    init(_ coord: CLLocationCoordinate2D) {
        self.lat = coord.latitude
        self.lng = coord.longitude
    }

    init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

/// In-memory representation of a horizon profile, the same shape as
/// `CachedHorizon` but value-typed so it can move freely across actor
/// boundaries before persisting.
struct HorizonProfile: Sendable, Equatable {
    var center: LatLng
    var observerElevation: Double
    var eyeHeightM: Double
    var azimuths: [Double]
    var altitudes: [Double]
    var maxRangeKm: Double
    var includesTerrain: Bool
    var includesCanopy: Bool
    var includesBuildings: Bool

    /// Linear-interpolated horizon altitude (degrees) at an arbitrary azimuth.
    func altitude(at azimuthDegrees: Double) -> Double {
        guard !azimuths.isEmpty else { return 0 }
        let normalized = ((azimuthDegrees.truncatingRemainder(dividingBy: 360)) + 360)
            .truncatingRemainder(dividingBy: 360)
        let n = azimuths.count
        let step = 360.0 / Double(n)
        let i = Int(floor(normalized / step)) % n
        let j = (i + 1) % n
        let t = (normalized - Double(i) * step) / step
        return altitudes[i] * (1 - t) + altitudes[j] * t
    }
}

// MARK: - Target tracks & clearance

/// A single sample of a target's apparent position.
struct TargetSample: Sendable, Equatable {
    let time: Date
    /// Apparent (refracted) altitude in degrees.
    let altitudeDegrees: Double
    /// Azimuth in degrees, 0 = north, increasing clockwise.
    let azimuthDegrees: Double
    /// True if the target is above the local horizon profile at this
    /// moment (i.e. visible from the pinned spot).
    let isVisible: Bool
}

/// A target's path across the night plus the clearance summary the
/// user actually reads.
struct TargetTrack: Sendable, Equatable, Identifiable {
    let target: DSOTarget
    let samples: [TargetSample]

    /// First moment the target rises above the local horizon during
    /// the night window. nil means it was already up at dusk or it
    /// never clears.
    let clearTime: Date?
    /// Last moment the target is above the local horizon. nil means
    /// it's still up at dawn or it never clears.
    let dipTime: Date?
    /// Peak apparent altitude during the visible portion (degrees).
    let peakAltitudeDegrees: Double
    /// Time of peak altitude. nil if never visible.
    let peakTime: Date?
    /// Already up when the night begins.
    let upAtDusk: Bool
    /// Still up when the night ends.
    let upAtDawn: Bool
    /// Target never clears the horizon profile during the window.
    let neverClears: Bool

    var id: String { target.id }

    var isVisibleSomeTime: Bool { !neverClears }
}

// MARK: - Canopy backend wire types
// These match backend/canopy/main.py's request/response models.

struct CanopySampleRequest: Encodable {
    var points: [LatLng]
    var asset: String?
    var band: String?
    var scale_m: Int?

    enum CodingKeys: String, CodingKey {
        case points, asset, band
        case scale_m
    }
}

struct CanopySampleResponse: Decodable {
    var heightsM: [Double]
    var asset: String
    var band: String
    var scaleM: Int

    enum CodingKeys: String, CodingKey {
        case heightsM = "heights_m"
        case asset, band
        case scaleM = "scale_m"
    }
}
