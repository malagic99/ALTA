import Foundation
import SwiftData

/// Offline-first cache of a computed 360° horizon profile for a single
/// observation point. Keyed by a coarse lat/lng grid so pins dropped a
/// few metres apart share an entry.
@Model
final class CachedHorizon {
    /// "lat,lng" rounded to 3 decimal places (~110 m grid at the equator).
    @Attribute(.unique) var locationKey: String

    /// Original coordinates of the point that produced this profile.
    var latitude: Double
    var longitude: Double

    /// When the profile was computed and when it should be considered stale.
    var fetchedAt: Date
    var expiresAt: Date

    /// Azimuth bins, in degrees clockwise from north.
    var azimuths: [Double]
    /// Apparent obstruction altitude per azimuth, degrees.
    var altitudes: [Double]

    /// Observer ground elevation, metres above sea level.
    var observerElevation: Double
    /// Maximum sample distance used along each ray, kilometres.
    var maxRangeKm: Double
    /// Eye height above ground used during the calculation, metres.
    var eyeHeightM: Double

    /// Which surface layers contributed to the horizon altitudes.
    var includesTerrain: Bool
    var includesCanopy: Bool
    var includesBuildings: Bool

    init(
        locationKey: String,
        latitude: Double,
        longitude: Double,
        fetchedAt: Date,
        expiresAt: Date,
        azimuths: [Double],
        altitudes: [Double],
        observerElevation: Double,
        maxRangeKm: Double,
        eyeHeightM: Double,
        includesTerrain: Bool,
        includesCanopy: Bool,
        includesBuildings: Bool
    ) {
        self.locationKey = locationKey
        self.latitude = latitude
        self.longitude = longitude
        self.fetchedAt = fetchedAt
        self.expiresAt = expiresAt
        self.azimuths = azimuths
        self.altitudes = altitudes
        self.observerElevation = observerElevation
        self.maxRangeKm = maxRangeKm
        self.eyeHeightM = eyeHeightM
        self.includesTerrain = includesTerrain
        self.includesCanopy = includesCanopy
        self.includesBuildings = includesBuildings
    }

    var isExpired: Bool { Date() > expiresAt }
}

extension CachedHorizon {
    /// Round coordinates to a ~110 m grid and return the cache key. Pins
    /// dropped extremely close to each other will resolve to the same
    /// horizon (terrain doesn't change at sub-100 m scale for our
    /// purposes), saving an Elevation API call.
    static func key(latitude: Double, longitude: Double) -> String {
        let lat = (latitude * 1000).rounded() / 1000
        let lng = (longitude * 1000).rounded() / 1000
        return String(format: "%.3f,%.3f", lat, lng)
    }
}
