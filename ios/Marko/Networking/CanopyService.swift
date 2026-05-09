import Foundation

/// Errors thrown by `CanopyService`. The `httpStatus` case carries the
/// raw response body so the UI can surface the backend's error message
/// when one is returned.
enum CanopyServiceError: LocalizedError {
    case missingBackendURL
    case invalidResponse
    case httpStatus(Int, String?)
    case decoding(any Error)

    var errorDescription: String? {
        switch self {
        case .missingBackendURL:
            return "Canopy backend URL is not configured. Set MarkoCanopyBackendURL in Info.plist."
        case .invalidResponse:
            return "The canopy backend returned a non-HTTP response."
        case .httpStatus(let code, let body):
            if let body, !body.isEmpty {
                return "Canopy backend returned HTTP \(code): \(body)"
            }
            return "Canopy backend returned HTTP \(code)."
        case .decoding(let underlying):
            return "Failed to decode canopy response: \(underlying.localizedDescription)"
        }
    }
}

/// URLSession-based client for the canopy proxy at `canopyBackendURL`.
///
/// Implemented as an actor so concurrent callers can't tear down a
/// shared encoder/decoder mid-call. Splits requests into batches of
/// `maxPointsPerRequest` to mirror the backend's MAX_POINTS_PER_REQUEST
/// guard.
actor CanopyService {
    /// Resolves the backend URL via `SecretsStore`: Keychain (BYOK)
    /// first, then Info.plist. Returns nil when neither holds a
    /// parseable URL.
    @MainActor
    static func loadBackendURL() -> URL? {
        guard let raw = SecretsStore.shared.canopyBackendURL,
              let url = URL(string: raw)
        else { return nil }
        return url
    }

    private let backendURL: URL
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder
    private let maxPointsPerRequest: Int

    init(
        backendURL: URL,
        session: URLSession = .shared,
        maxPointsPerRequest: Int = 1024
    ) {
        self.backendURL = backendURL
        self.session = session
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.maxPointsPerRequest = maxPointsPerRequest
    }

    /// Convenience initializer that pulls the URL from `SecretsStore`
    /// and returns nil if it isn't configured.
    @MainActor
    static func fromBundle() -> CanopyService? {
        guard let url = loadBackendURL() else { return nil }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = true
        return CanopyService(backendURL: url, session: URLSession(configuration: config))
    }

    /// Returns the canopy height in metres at each input point, in input
    /// order. Points outside the dataset's coverage come back as 0.
    func sampleHeights(points: [LatLng]) async throws -> [Double] {
        guard !points.isEmpty else { return [] }

        var heights = [Double](repeating: 0, count: points.count)

        for offset in stride(from: 0, to: points.count, by: maxPointsPerRequest) {
            let end = min(offset + maxPointsPerRequest, points.count)
            let batch = Array(points[offset..<end])
            let response = try await postSample(points: batch)
            for (i, h) in response.heightsM.enumerated() {
                heights[offset + i] = h
            }
        }

        return heights
    }

    /// Health probe — returns true when the backend's `/health` endpoint
    /// is reachable.
    func ping() async -> Bool {
        let url = backendURL.appendingPathComponent("health")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        do {
            let (_, response) = try await session.data(for: request)
            return (response as? HTTPURLResponse).map { 200..<300 ~= $0.statusCode } ?? false
        } catch {
            return false
        }
    }

    // MARK: - Private

    private func postSample(points: [LatLng]) async throws -> CanopySampleResponse {
        let url = backendURL.appendingPathComponent("canopy/sample")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try encoder.encode(
            CanopySampleRequest(points: points, asset: nil, band: nil, scale_m: nil)
        )

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw CanopyServiceError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            let body = String(data: data, encoding: .utf8)
            throw CanopyServiceError.httpStatus(http.statusCode, body)
        }
        do {
            return try decoder.decode(CanopySampleResponse.self, from: data)
        } catch {
            throw CanopyServiceError.decoding(error)
        }
    }
}
