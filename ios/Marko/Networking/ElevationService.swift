import Foundation

/// Errors thrown by `ElevationService`.
enum ElevationServiceError: LocalizedError {
    case missingBackendURL
    case invalidResponse
    case httpStatus(Int, String?)
    case decoding(any Error)
    case partialResults(expected: Int, got: Int)
    case attestation(any Error)

    var errorDescription: String? {
        switch self {
        case .missingBackendURL:
            return "Canopy backend URL is not configured. Open Settings to set it."
        case .invalidResponse:
            return "Elevation backend returned a non-HTTP response."
        case .httpStatus(let code, let body):
            if let body, !body.isEmpty {
                return "Elevation backend HTTP \(code): \(body)"
            }
            return "Elevation backend HTTP \(code)."
        case .decoding(let underlying):
            return "Failed to decode elevation response: \(underlying.localizedDescription)"
        case .partialResults(let expected, let got):
            return "Elevation backend returned \(got) of \(expected) requested points."
        case .attestation(let underlying):
            return "App Attest failed: \(underlying.localizedDescription)"
        }
    }
}

/// Native URLSession client for the **backend's** `/elevation/sample`
/// proxy. The Google Maps API key never ships in the app binary —
/// the backend holds it in Secret Manager and forwards requests to
/// Google. Each call carries an Apple App Attest assertion via the
/// `X-Attest-*` headers, which the backend's middleware verifies
/// against the device's registered public key.
///
/// Batching still respects Google's 512-locations-per-request cap —
/// the backend mirrors the same chunk size — so the on-device
/// orchestrator's 36×14 grid (505 points) costs exactly one
/// upstream request.
actor ElevationService {
    static let maxPointsPerRequest = 512

    /// Convenience: pulls the backend URL from `SecretsStore` (Keychain
    /// or Info.plist). Returns nil when nothing is configured.
    @MainActor
    static func fromBundle() -> ElevationService? {
        guard let url = CanopyService.loadBackendURL() else { return nil }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = true
        config.requestCachePolicy = .useProtocolCachePolicy
        return ElevationService(backendURL: url, session: URLSession(configuration: config))
    }

    private let backendURL: URL
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(backendURL: URL, session: URLSession = .shared) {
        self.backendURL = backendURL
        self.session = session
    }

    /// Returns ground elevations (metres) at each input point, in input
    /// order. Splits batches of `maxPointsPerRequest` transparently.
    func sampleElevations(points: [LatLng]) async throws -> [Double] {
        guard !points.isEmpty else { return [] }

        var out = [Double](repeating: 0, count: points.count)
        let chunkSize = Self.maxPointsPerRequest
        for offset in stride(from: 0, to: points.count, by: chunkSize) {
            let end = min(offset + chunkSize, points.count)
            let batch = Array(points[offset..<end])
            let elevations = try await fetchBatch(batch)
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
        let url = backendURL.appendingPathComponent("elevation/sample")
        let body = try encoder.encode(ElevationRequest(points: batch))

        let attestHeaders: [String: String]
        do {
            attestHeaders = try await AttestationManager.shared
                .attestationHeaders(for: body)
        } catch {
            throw ElevationServiceError.attestation(error)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (key, value) in attestHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ElevationServiceError.invalidResponse
        }
        guard 200..<300 ~= http.statusCode else {
            let snippet = String(data: data.prefix(512), encoding: .utf8)
            throw ElevationServiceError.httpStatus(http.statusCode, snippet)
        }

        do {
            let decoded = try decoder.decode(ElevationResponse.self, from: data)
            return decoded.elevationsM
        } catch {
            throw ElevationServiceError.decoding(error)
        }
    }
}

// MARK: - Wire types matching backend/canopy/elevation.py

private struct ElevationRequest: Encodable {
    let points: [LatLng]
}

private struct ElevationResponse: Decodable {
    let elevationsM: [Double]

    enum CodingKeys: String, CodingKey {
        case elevationsM = "elevations_m"
    }
}
