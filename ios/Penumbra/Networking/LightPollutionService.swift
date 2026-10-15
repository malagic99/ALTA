import Foundation
import CoreLocation

/// Errors raised by the Overpass / Bortle pipeline. Most call sites
/// soft-fail on these — a missing Bortle estimate isn't a reason to
/// throw away the user's terrain + canopy work.
enum LightPollutionError: LocalizedError {
    case invalidResponse
    case httpStatus(Int, String?)
    case decoding(any Error)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Overpass returned a non-HTTP response."
        case .httpStatus(let code, let body):
            if let body, !body.isEmpty {
                return "Overpass HTTP \(code): \(body)"
            }
            return "Overpass HTTP \(code)."
        case .decoding(let err):
            return "Failed to decode Overpass response: \(err.localizedDescription)"
        }
    }
}

/// Bortle estimator backed by the public OpenStreetMap Overpass API.
///
/// Approach: query populated places (cities, towns, villages with a
/// `population` tag) within `radiusKm` of the pin. Each place
/// contributes a brightness term of `population / (distance_km + 1)²`
/// — a soft-floored inverse-square light-propagation model. The sum
/// is mapped to a Bortle bucket by `BortleEstimate.classify`. Same
/// math as the Expo build, so users see consistent numbers across
/// platforms.
///
/// This isn't a substitute for a real per-pixel VIIRS sample, but the
/// dominant signal for "find a dark spot away from cities" *is*
/// distance from cities, so for ranking pins it works well.
actor LightPollutionService {
    static let shared = LightPollutionService()

    private static let endpoint = URL(string: "https://overpass-api.de/api/interpreter")!

    private let session: URLSession
    private let decoder = JSONDecoder()

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Fetches populated places around `coord` and returns a Bortle
    /// estimate. Throws on transport / decode errors; the orchestrator
    /// soft-fails on those (same as canopy).
    func bortle(
        at coord: CLLocationCoordinate2D,
        radiusKm: Double = 200
    ) async throws -> BortleEstimate {
        let places = try await fetchPopulatedPlaces(center: coord, radiusKm: radiusKm)
        let proxy = brightnessProxy(at: coord, places: places)
        return BortleEstimate(
            class: BortleEstimate.classify(brightnessProxy: proxy),
            brightnessProxy: proxy
        )
    }

    // MARK: - Private

    private func fetchPopulatedPlaces(
        center: CLLocationCoordinate2D,
        radiusKm: Double
    ) async throws -> [PopulatedPlace] {
        let radiusM = Int(radiusKm * 1000)
        let query = """
        [out:json][timeout:25];
        node(around:\(radiusM),\(String(format: "%.4f", center.latitude)),\(String(format: "%.4f", center.longitude)))
          ["place"~"^(city|town|village)$"]["population"];
        out tags center;
        """

        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = "POST"
        request.setValue(
            "application/x-www-form-urlencoded",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = "data=\(percentEncoded(query))".data(using: .utf8)
        request.timeoutInterval = 30

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw LightPollutionError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            let body = String(data: data.prefix(512), encoding: .utf8)
            throw LightPollutionError.httpStatus(http.statusCode, body)
        }

        let decoded: OverpassResponse
        do {
            decoded = try decoder.decode(OverpassResponse.self, from: data)
        } catch {
            throw LightPollutionError.decoding(error)
        }

        return (decoded.elements ?? []).compactMap { node in
            guard let popString = node.tags?["population"],
                  let population = Self.parsePopulation(popString),
                  population > 0
            else { return nil }
            return PopulatedPlace(
                latitude: node.lat,
                longitude: node.lon,
                population: population,
                name: node.tags?["name"]
            )
        }
    }

    private func brightnessProxy(
        at coord: CLLocationCoordinate2D,
        places: [PopulatedPlace]
    ) -> Double {
        var sum = 0.0
        for place in places {
            let d = haversineKm(
                lat1: coord.latitude,
                lon1: coord.longitude,
                lat2: place.latitude,
                lon2: place.longitude
            )
            // 1 km soft floor so a pin sitting on a town node doesn't
            // blow up the proxy.
            sum += Double(place.population) / pow(d + 1, 2)
        }
        return sum
    }

    /// Population strings on OSM include commas, periods, "approx.",
    /// etc. Strip everything that isn't a digit and parse what's left.
    nonisolated static func parsePopulation(_ raw: String) -> Int? {
        let digits = raw.unicodeScalars
            .filter { CharacterSet.decimalDigits.contains($0) }
        guard !digits.isEmpty else { return nil }
        return Int(String(String.UnicodeScalarView(digits)))
    }

    private func haversineKm(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ) -> Double {
        let R = 6371.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat/2) * sin(dLat/2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180)
            * sin(dLon/2) * sin(dLon/2)
        return 2 * R * asin(min(1, sqrt(a)))
    }

    private func percentEncoded(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
    }
}

private struct PopulatedPlace {
    let latitude: Double
    let longitude: Double
    let population: Int
    let name: String?
}

private struct OverpassResponse: Decodable {
    let elements: [OverpassNode]?
}

private struct OverpassNode: Decodable {
    let lat: Double
    let lon: Double
    let tags: [String: String]?
}
