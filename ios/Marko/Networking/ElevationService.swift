import Foundation

/// Errors thrown by `ElevationService`. All conform to `LocalizedError`
/// so the UI can surface human-readable messages without an extra
/// translation layer.
enum ElevationServiceError: LocalizedError {
    case missingAPIKey
    case invalidURL
    case invalidResponse
    case httpStatus(Int, String?)
    case apiStatus(String, String?)
    case decoding(any Error)
    case partialResults(expected: Int, got: Int)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            return "Google Maps API key is missing. Set MarkoGoogleMapsAPIKey in Info.plist."
        case .invalidURL:
            return "Couldn't construct the Elevation API URL."
        case .invalidResponse:
            return "Elevation API returned a non-HTTP response."
        case .httpStatus(let code, let body):
            if let body, !body.isEmpty {
                return "Elevation API HTTP \(code): \(body)"
            }
            return "Elevation API HTTP \(code)."
        case .apiStatus(let status, let message):
            let suffix = (message?.isEmpty == false) ? " — \(message ?? "")" : ""
            switch status {
            case "OVER_DAILY_LIMIT":
                return "Daily Elevation API quota exceeded.\(suffix)"
            case "OVER_QUERY_LIMIT":
                return "Per-second Elevation API quota exceeded.\(suffix)"
            case "REQUEST_DENIED":
                return "Elevation API request denied — check the key restrictions and that the API is enabled.\(suffix)"
            case "INVALID_REQUEST":
                return "Elevation API rejected the request.\(suffix)"
            case "UNKNOWN_ERROR":
                return "Elevation API server error. Try again.\(suffix)"
            default:
                return "Elevation API status \(status).\(suffix)"
            }
        case .decoding(let err):
            return "Failed to decode Elevation API response: \(err.localizedDescription)"
        case .partialResults(let expected, let got):
            return "Elevation API returned \(got) of \(expected) requested points."
        }
    }
}

/// Native URLSession client for the Google Maps Elevation API.
///
/// Pricing context (2026): $5.00 per 1,000 requests with 5,000 free
/// requests/month — billed per HTTP request, not per coordinate. A
/// single request can carry up to 512 locations, so we batch
/// aggressively. With the orchestrator's 36×14 grid (505 points + 1
/// observer = 506) every horizon calculation costs exactly **one**
/// request, leaving the free tier comfortable: 5 fresh calculations a
/// day × 30 days = 150 req/month, well below the 5,000 cap.
///
/// Locations are joined by the literal `|` character; `URLComponents`
/// percent-encodes it to `%7C` automatically because pipe is not in
/// `urlQueryAllowed`.
actor ElevationService {
    /// Per Google's docs, the maximum number of locations in one
    /// request. Don't bump this without checking that limit.
    static let maxPointsPerRequest = 512

    /// Pulls the API key from `Info.plist`. Returns nil when the key
    /// is missing or still set to the placeholder, so callers can
    /// detect an unconfigured build.
    static func loadAPIKey() -> String? {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "MarkoGoogleMapsAPIKey") as? String,
              !key.isEmpty,
              !key.contains("YOUR_GOOGLE_MAPS_API_KEY"),
              !key.hasPrefix("YOUR_")
        else { return nil }
        return key
    }

    /// Convenience for the common case: read the key from Info.plist
    /// and build a service with a request-tuned URLSession. Returns
    /// nil when the API key isn't configured.
    static func fromBundle() -> ElevationService? {
        guard let key = loadAPIKey() else { return nil }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = true
        config.requestCachePolicy = .useProtocolCachePolicy
        return ElevationService(apiKey: key, session: URLSession(configuration: config))
    }

    private let apiKey: String
    private let session: URLSession
    private let decoder: JSONDecoder

    init(apiKey: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.session = session
        self.decoder = JSONDecoder()
    }

    /// Returns the ground elevation in metres at each input point, in
    /// input order. Splits into batches of `maxPointsPerRequest`
    /// transparently — for the orchestrator's default grid the whole
    /// thing fits in a single HTTP request.
    func sampleElevations(points: [LatLng]) async throws -> [Double] {
        guard !points.isEmpty else { return [] }

        var out = [Double](repeating: 0, count: points.count)
        let chunkSize = Self.maxPointsPerRequest

        for offset in stride(from: 0, to: points.count, by: chunkSize) {
            let end = min(offset + chunkSize, points.count)
            let batch = Array(points[offset..<end])
            let elevations = try await fetchBatch(batch)

            // Google returns results in the same order as the input
            // locations. We still defensively check the count so we
            // don't silently return zeros where data went missing.
            guard elevations.count == batch.count else {
                throw ElevationServiceError.partialResults(
                    expected: batch.count,
                    got: elevations.count
                )
            }
            for (i, e) in elevations.enumerated() {
                out[offset + i] = e
            }
        }

        return out
    }

    // MARK: - Private

    private func fetchBatch(_ batch: [LatLng]) async throws -> [Double] {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "maps.googleapis.com"
        components.path = "/maps/api/elevation/json"

        // "lat1,lng1|lat2,lng2|…" — URLQueryItem will percent-encode
        // the pipe to %7C since it's not in `urlQueryAllowed`.
        let locations = batch
            .map { "\($0.lat),\($0.lng)" }
            .joined(separator: "|")

        components.queryItems = [
            URLQueryItem(name: "locations", value: locations),
            URLQueryItem(name: "key", value: apiKey),
        ]
        guard let url = components.url else {
            throw ElevationServiceError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ElevationServiceError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            // Google returns useful detail in the body for some
            // failures (e.g. a 403 with "API key not authorized").
            // Surface up to the first ~512 chars so the UI can show
            // something actionable.
            let body = String(data: data.prefix(512), encoding: .utf8)
            throw ElevationServiceError.httpStatus(http.statusCode, body)
        }

        let decoded: ElevationResponse
        do {
            decoded = try decoder.decode(ElevationResponse.self, from: data)
        } catch {
            throw ElevationServiceError.decoding(error)
        }

        // The Elevation API uses 200 OK with a `status` field for
        // application-level errors (OVER_DAILY_LIMIT, REQUEST_DENIED,
        // etc.), so HTTP success isn't enough.
        guard decoded.status == "OK" else {
            throw ElevationServiceError.apiStatus(decoded.status, decoded.errorMessage)
        }
        return (decoded.results ?? []).map(\.elevation)
    }
}

// MARK: - Wire types

private struct ElevationResponse: Decodable {
    let status: String
    let results: [ElevationResult]?
    let errorMessage: String?

    enum CodingKeys: String, CodingKey {
        case status, results
        case errorMessage = "error_message"
    }
}

private struct ElevationResult: Decodable {
    let elevation: Double
    let resolution: Double?
    let location: ElevationLocation?
}

private struct ElevationLocation: Decodable {
    let lat: Double
    let lng: Double
}
