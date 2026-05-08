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
