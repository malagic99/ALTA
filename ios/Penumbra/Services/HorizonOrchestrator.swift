import Foundation
import CoreLocation
import SwiftData

/// Errors surfaced by the horizon pipeline.
enum HorizonError: LocalizedError {
    case missingElevationService
    case missingCanopyService
    case rateLimited(remainingSeconds: Int)
    case elevation(any Error)
    case canopy(any Error)

    var errorDescription: String? {
        switch self {
        case .missingElevationService:
            return "Penumbra backend URL isn't configured. Open Settings to set it before calculating a horizon."
        case .missingCanopyService:
            return "Canopy backend isn't configured."
        case .rateLimited(let s):
            return RateLimitError.exhausted(remainingSeconds: s).localizedDescription
        case .elevation(let err):
            return err.localizedDescription
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
                includesBuildings: cached.includesBuildings,
                bortleClass: cached.bortleClass,
                skyBrightnessProxy: cached.skyBrightnessProxy
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
    private let elevationService: ElevationService?
    private let canopyService: CanopyService?

    init(
        context: ModelContext,
        elevationService: ElevationService?,
        canopyService: CanopyService?
    ) {
        self.context = context
        self.rateLimiter = RateLimiter(context: context)
        self.elevationService = elevationService
        self.canopyService = canopyService
    }

    /// Whether a fresh `Calculate horizon` call can succeed. The cache
    /// path doesn't need this; only fresh computes do.
    var hasElevationService: Bool { elevationService != nil }

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
    ///
    /// Behaviour for fresh computes:
    /// 1. Validate that an `ElevationService` is configured. If not, no
    ///    slot is consumed and `.missingElevationService` is thrown.
    /// 2. Reserve a rate-limit slot so flaky retries can't bypass the
    ///    daily cap.
    /// 3. Fetch ground elevations (required). On any
    ///    `ElevationServiceError` the slot is **refunded** and
    ///    `.elevation(...)` is thrown — the user keeps their daily
    ///    budget for genuinely successful work only.
    /// 4. Fetch canopy heights (optional, soft-fail). A canopy error
    ///    leaves the resulting profile flagged as terrain-only but
    ///    does not refund — terrain still cost an API request.
    func getOrComputeHorizon(
        at coord: CLLocationCoordinate2D,
        includeCanopy: Bool = true,
        forceRefresh: Bool = false
    ) async throws -> HorizonSource {
        if !forceRefresh, let cached = cachedProfile(at: coord) {
            return .cache(cached)
        }

        guard let elevationService else {
            throw HorizonError.missingElevationService
        }

        // Reserve the budget BEFORE any network I/O so a flaky network
        // doesn't burn slots only on success.
        try rateLimiter.consume()

        do {
            let profile = try await computeHorizon(
                coord: coord,
                includeCanopy: includeCanopy,
                elevationService: elevationService
            )
            try persist(profile: profile, coord: coord)
            return .fresh(profile)
        } catch let elevError as ElevationServiceError {
            // The Elevation API failed — quota, denied, network, etc.
            // Hand the slot back; the user didn't get a profile.
            rateLimiter.refund()
            throw HorizonError.elevation(elevError)
        } catch {
            // Any other failure (e.g. SwiftData persist) is unusual
            // enough that we keep the slot consumed: the elevation
            // and canopy fetches did succeed.
            throw error
        }
    }

    // MARK: - Compute

    private struct RaySpec {
        /// One azimuth bin every 10°.
        static let azimuthCount = 36
        /// Samples per ray. Sized so the full grid (azimuthCount *
        /// samplesPerRay + 1 observer) stays at or under the Elevation
        /// API's 512-locations-per-request cap, which keeps each
        /// horizon calc to exactly **one** billed Elevation API request.
        ///   36 × 14 + 1 = 505 ≤ 512.
        static let samplesPerRay = 14
        static let minKm = 0.1
        static let maxKm = 10.0
        static let eyeHeightM = 1.6
    }

    /// Builds a 36 × 14 sample grid around `coord`, fetches ground
    /// elevations from the Google Elevation API and (optionally)
    /// canopy heights from the canopy backend, then projects the
    /// maximum apparent altitude per azimuth.
    ///
    /// `surfaceHeight[i] = ground[i] + canopy[i]` — the building
    /// layer (Solar API, Phase 3) will add a third term to the same
    /// accumulator.
    ///
    /// Throws `ElevationServiceError` on any Elevation API failure;
    /// the caller is responsible for refunding the rate-limit slot.
    /// Canopy errors are soft-failed: the returned profile is
    /// terrain-only and `includesCanopy` is false.
    private func computeHorizon(
        coord: CLLocationCoordinate2D,
        includeCanopy: Bool,
        elevationService: ElevationService
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

        // 1. Ground elevations — required. Single batched request for
        //    the whole grid (505 points ≤ 512 cap). Throws on failure
        //    so the caller can refund the rate-limit slot.
        //
        //    We launch canopy and Bortle in parallel with elevation:
        //    they're independent network calls and racing them halves
        //    the worst-case wall time on a fresh compute.
        async let canopyTask: [Double]? = includeCanopy
            ? (try? await canopyService?.sampleHeights(points: samples))
            : nil
        async let bortleTask: BortleEstimate? = (
            try? await LightPollutionService.shared.bortle(at: coord)
        )

        let groundElevations = try await elevationService.sampleElevations(points: samples)

        // 2. Canopy heights — optional, soft-fail. Failure leaves
        //    canopyHeights as zeros and `hadCanopy` false; rate-limit
        //    slot stays consumed because terrain was real work.
        var canopyHeights = [Double](repeating: 0, count: samples.count)
        var hadCanopy = false
        if let resolved = await canopyTask, resolved.count == samples.count {
            canopyHeights = resolved
            hadCanopy = true
        }

        // 3. Bortle estimate — optional, soft-fail. Same cost story
        //    as canopy: nothing to refund, the user still got a
        //    horizon. nil bortleClass surfaces as "—" in the UI.
        let bortle = await bortleTask

        // 4. Per-sample surface height = ground + canopy (+ buildings, future).
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
                let p = samples[sampleIndex]
                let dKm = Self.haversineKm(observer, p)
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
            includesTerrain: true,
            includesCanopy: hadCanopy,
            includesBuildings: false,
            bortleClass: bortle?.class,
            skyBrightnessProxy: bortle?.brightnessProxy
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
            includesBuildings: profile.includesBuildings,
            bortleClass: profile.bortleClass,
            skyBrightnessProxy: profile.skyBrightnessProxy
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
