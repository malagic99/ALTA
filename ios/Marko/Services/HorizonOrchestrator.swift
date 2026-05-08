import Foundation
import CoreLocation
import SwiftData

/// Errors surfaced by the horizon pipeline.
enum HorizonError: LocalizedError {
    case missingCanopyService
    case rateLimited(remainingSeconds: Int)
    case canopy(any Error)

    var errorDescription: String? {
        switch self {
        case .missingCanopyService:
            return "Canopy backend isn't configured."
        case .rateLimited(let s):
            return RateLimitError.exhausted(remainingSeconds: s).localizedDescription
        case .canopy(let err):
            return err.localizedDescription
        }
    }
}

/// Result classification so the UI can show "from cache" vs "fresh".
enum HorizonSource {
    case cache(CachedHorizon)
    case fresh(HorizonProfile)

    var profile: HorizonProfile {
        switch self {
        case .cache(let cached):
            return HorizonProfile(
                center: LatLng(lat: cached.latitude, lng: cached.longitude),
                observerElevation: cached.observerElevation,
                eyeHeightM: cached.eyeHeightM,
                azimuths: cached.azimuths,
                altitudes: cached.altitudes,
                maxRangeKm: cached.maxRangeKm,
                includesTerrain: cached.includesTerrain,
                includesCanopy: cached.includesCanopy,
                includesBuildings: cached.includesBuildings
            )
        case .fresh(let profile):
            return profile
        }
    }
}

/// Glues the cache, rate limiter, and the network services together.
///
/// `getOrComputeHorizon` is the only public entry point — it serves a
/// fresh-enough cached profile when one exists, otherwise it consumes a
/// rate-limit slot, fetches the underlying data, computes the profile,
/// stores it, and returns it.
@MainActor
final class HorizonOrchestrator {
    /// How long a computed profile remains valid in the cache.
    static let cacheTTL: TimeInterval = 60 * 60 * 24 * 30  // 30 days

    private let context: ModelContext
    private let rateLimiter: RateLimiter
    private let canopyService: CanopyService?

    init(context: ModelContext, canopyService: CanopyService?) {
        self.context = context
        self.rateLimiter = RateLimiter(context: context)
        self.canopyService = canopyService
    }

    /// Cache lookup; nil if there's nothing for this location or the
    /// stored profile has expired.
    func cachedProfile(at coord: CLLocationCoordinate2D) -> CachedHorizon? {
        let key = CachedHorizon.key(latitude: coord.latitude, longitude: coord.longitude)
        var descriptor = FetchDescriptor<CachedHorizon>(
            predicate: #Predicate { $0.locationKey == key }
        )
        descriptor.fetchLimit = 1
        let cached = (try? context.fetch(descriptor))?.first
        if let cached, cached.isExpired { return nil }
        return cached
    }

    func remainingToday() -> Int { rateLimiter.remaining() }

    /// Returns a horizon profile, possibly served from cache. Throws on
    /// rate-limit or network errors. If `forceRefresh` is true the cache
    /// is bypassed and a slot is consumed.
    func getOrComputeHorizon(
        at coord: CLLocationCoordinate2D,
        includeCanopy: Bool = true,
        forceRefresh: Bool = false
    ) async throws -> HorizonSource {
        if !forceRefresh, let cached = cachedProfile(at: coord) {
            return .cache(cached)
        }

        // Reserve the budget BEFORE any network I/O so a flaky network
        // doesn't burn slots only on success.
        try rateLimiter.consume()

        do {
            let profile = try await computeHorizon(coord: coord, includeCanopy: includeCanopy)
            try persist(profile: profile, coord: coord)
            return .fresh(profile)
        } catch {
            throw HorizonError.canopy(error)
        }
    }

    // MARK: - Compute

    private struct RaySpec {
        static let azimuthCount = 36
        static let samplesPerRay = 20
        static let minKm = 0.1
        static let maxKm = 10.0
        static let eyeHeightM = 1.6
    }

    /// Builds a 36 × 20 sample grid around `coord`, fetches canopy heights
    /// (and, in a future revision, ground elevations) for every point,
    /// then projects the maximum apparent altitude per azimuth.
    ///
    /// NOTE: ground elevations come from the Google Elevation API in the
    /// finished app. This file ships the pipeline and treats elevations
    /// as a flat 0 m surface so the canopy work end-to-end is testable
    /// without the Maps key. Add an `ElevationService` mirroring
    /// `CanopyService` and fold its results into `surface[i]` to enable
    /// terrain.
    private func computeHorizon(
        coord: CLLocationCoordinate2D,
        includeCanopy: Bool
    ) async throws -> HorizonProfile {
        let observer = LatLng(coord)
        var samples: [LatLng] = []
        samples.append(observer)
        var rays: [[Int]] = []
        rays.reserveCapacity(RaySpec.azimuthCount)

        let step = (RaySpec.maxKm - RaySpec.minKm) / Double(RaySpec.samplesPerRay - 1)
        for a in 0..<RaySpec.azimuthCount {
            let azDeg = 360.0 * Double(a) / Double(RaySpec.azimuthCount)
            let azRad = azDeg * .pi / 180
            var indices: [Int] = []
            indices.reserveCapacity(RaySpec.samplesPerRay)
            for s in 0..<RaySpec.samplesPerRay {
                let dKm = RaySpec.minKm + Double(s) * step
                let north = cos(azRad) * dKm
                let east = sin(azRad) * dKm
                let p = Self.offsetKm(coord, northKm: north, eastKm: east)
                indices.append(samples.count)
                samples.append(LatLng(p))
            }
            rays.append(indices)
        }

        // Ground elevation: 0 placeholder. See note above.
        let groundElevations = [Double](repeating: 0, count: samples.count)

        var canopyHeights = [Double](repeating: 0, count: samples.count)
        var hadCanopy = false
        if includeCanopy, let service = canopyService {
            do {
                canopyHeights = try await service.sampleHeights(points: samples)
                hadCanopy = true
            } catch {
                // Soft-fail: we still return a terrain profile. Could
                // surface a "canopy unavailable" warning instead.
            }
        }

        let observerEyeM = groundElevations[0] + RaySpec.eyeHeightM
        var azimuths: [Double] = []
        var altitudes: [Double] = []
        azimuths.reserveCapacity(RaySpec.azimuthCount)
        altitudes.reserveCapacity(RaySpec.azimuthCount)

        for a in 0..<RaySpec.azimuthCount {
            let azDeg = 360.0 * Double(a) / Double(RaySpec.azimuthCount)
            var maxAlt = -90.0
            for sampleIndex in rays[a] {
                let surface = groundElevations[sampleIndex] + canopyHeights[sampleIndex]
                let lat = samples[sampleIndex]
                let dKm = Self.haversineKm(
                    LatLng(lat: coord.latitude, lng: coord.longitude),
                    lat
                )
                let alt = Self.apparentElevationAngle(
                    observerEyeM: observerEyeM,
                    targetSurfaceM: surface,
                    distanceM: dKm * 1000
                )
                if alt > maxAlt { maxAlt = alt }
            }
            azimuths.append(azDeg)
            altitudes.append(max(0, maxAlt))
        }

        return HorizonProfile(
            center: observer,
            observerElevation: groundElevations[0],
            eyeHeightM: RaySpec.eyeHeightM,
            azimuths: azimuths,
            altitudes: altitudes,
            maxRangeKm: RaySpec.maxKm,
            includesTerrain: false, // flip true once ElevationService is wired
            includesCanopy: hadCanopy,
            includesBuildings: false
        )
    }

    private func persist(profile: HorizonProfile, coord: CLLocationCoordinate2D) throws {
        let key = CachedHorizon.key(latitude: coord.latitude, longitude: coord.longitude)
        let descriptor = FetchDescriptor<CachedHorizon>(
            predicate: #Predicate { $0.locationKey == key }
        )
        for old in try context.fetch(descriptor) {
            context.delete(old)
        }
        let now = Date()
        let cached = CachedHorizon(
            locationKey: key,
            latitude: coord.latitude,
            longitude: coord.longitude,
            fetchedAt: now,
            expiresAt: now.addingTimeInterval(Self.cacheTTL),
            azimuths: profile.azimuths,
            altitudes: profile.altitudes,
            observerElevation: profile.observerElevation,
            maxRangeKm: profile.maxRangeKm,
            eyeHeightM: profile.eyeHeightM,
            includesTerrain: profile.includesTerrain,
            includesCanopy: profile.includesCanopy,
            includesBuildings: profile.includesBuildings
        )
        context.insert(cached)
        try context.save()
    }

    // MARK: - Geo helpers

    private static let earthRadiusKm = 6371.0
    private static let earthRadiusM = 6_371_000.0
    private static let refractionCoefficient = 0.13

    private static func offsetKm(
        _ origin: CLLocationCoordinate2D,
        northKm: Double,
        eastKm: Double
    ) -> CLLocationCoordinate2D {
        let dLat = northKm / earthRadiusKm
        let dLon = eastKm / (earthRadiusKm * cos(origin.latitude * .pi / 180))
        return CLLocationCoordinate2D(
            latitude: origin.latitude + dLat * 180 / .pi,
            longitude: origin.longitude + dLon * 180 / .pi
        )
    }

    private static func haversineKm(_ a: LatLng, _ b: LatLng) -> Double {
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLon = (b.lng - a.lng) * .pi / 180
        let lat1 = a.lat * .pi / 180
        let lat2 = b.lat * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusKm * asin(min(1, sqrt(h)))
    }

    private static func apparentElevationAngle(
        observerEyeM: Double,
        targetSurfaceM: Double,
        distanceM: Double
    ) -> Double {
        guard distanceM > 0 else { return -90 }
        let drop = (1 - refractionCoefficient) * distanceM * distanceM / (2 * earthRadiusM)
        let apparent = targetSurfaceM - drop
        return atan2(apparent - observerEyeM, distanceM) * 180 / .pi
    }
}
