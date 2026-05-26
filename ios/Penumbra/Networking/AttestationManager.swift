import Foundation
import DeviceCheck
import CryptoKit

/// Errors surfaced by the attestation flow.
enum AttestationError: LocalizedError {
    case unsupported
    case noKey
    case generateKeyFailed(any Error)
    case attestKeyFailed(any Error)
    case assertionFailed(any Error)
    case backend(Int, String?)
    case missingBackendURL

    var errorDescription: String? {
        switch self {
        case .unsupported:
            return "App Attest isn't supported on this device or simulator."
        case .noKey:
            return "No attestation key available. Re-run registration."
        case .generateKeyFailed(let e):
            return "Couldn't generate attestation key: \(e.localizedDescription)"
        case .attestKeyFailed(let e):
            return "Couldn't attest the key with Apple: \(e.localizedDescription)"
        case .assertionFailed(let e):
            return "Couldn't sign request assertion: \(e.localizedDescription)"
        case .backend(let code, let body):
            return "Backend rejected attestation (HTTP \(code)): \(body ?? "")"
        case .missingBackendURL:
            return "Canopy backend URL is required for App Attest."
        }
    }
}

/// Wraps `DCAppAttestService` so the rest of the app deals only with
/// "give me the headers to attach to this outgoing request".
///
/// Lifecycle:
///   1. First launch on a real device: `bootstrapIfNeeded()` calls
///      `DCAppAttestService.generateKey`, then `attestKey(...)` to
///      get an Apple-signed attestation, then POSTs it to
///      `/attest/register` on the backend. The keyId is persisted in
///      UserDefaults.
///   2. Subsequent requests: `attestationHeaders(for:)` produces a
///      per-request assertion over the request body and returns a
///      header dict for URLRequest. The backend's middleware verifies
///      the assertion with the public key it stored at registration.
///
/// On the simulator (where App Attest is unavailable) the manager
/// falls into a "dev mode" that emits a stable key id and a fixed
/// assertion placeholder, matching the backend's `APP_ATTEST_ENFORCE=0`
/// path. Real verification kicks in once both sides set production
/// flags.
actor AttestationManager {
    static let shared = AttestationManager()

    private let service = DCAppAttestService.shared
    private let defaults = UserDefaults.standard
    private let keyIdKey = "com.penumbra.astro.appattest.keyId"
    private let registeredKey = "com.penumbra.astro.appattest.registered"
    private let session: URLSession = .shared

    private init() {}

    var isSupported: Bool { service.isSupported }

    /// True once `/attest/register` has accepted us.
    private var isRegistered: Bool {
        get { defaults.bool(forKey: registeredKey) }
    }

    private var storedKeyId: String? {
        defaults.string(forKey: keyIdKey)
    }

    /// Generates a key, attests it, and POSTs the attestation to the
    /// backend. Idempotent — no-op if we've already registered. Call
    /// once at app launch, before the first elevation request.
    func bootstrapIfNeeded() async throws {
        guard let backendURL = await CanopyService.loadBackendURL() else {
            throw AttestationError.missingBackendURL
        }
        if isRegistered, storedKeyId != nil { return }

        guard service.isSupported else {
            // Simulator / unsupported device → dev-mode bootstrap so
            // requests still succeed against a backend with
            // APP_ATTEST_ENFORCE=0.
            let devKeyId = "DEV_" + UUID().uuidString
            defaults.set(devKeyId, forKey: keyIdKey)
            defaults.set(true, forKey: registeredKey)
            return
        }

        // 1. Generate a fresh key. Result is a base64 keyId reference
        //    to a private key Apple stores in the secure enclave.
        let keyId: String
        do {
            keyId = try await service.generateKey()
        } catch {
            throw AttestationError.generateKeyFailed(error)
        }

        // 2. Fetch a single-use challenge from /attest/challenge.
        //    The server tracks issued challenges and rejects reuse, so
        //    a captured attestation can't be replayed against a fresh
        //    registration request later.
        let challenge: Data
        do {
            challenge = try await fetchChallenge(backendURL: backendURL)
        } catch {
            throw AttestationError.attestKeyFailed(error)
        }
        let clientDataHash = Data(SHA256.hash(data: challenge))

        // 3. Ask Apple to attest the key against that challenge.
        let attestation: Data
        do {
            attestation = try await service.attestKey(keyId, clientDataHash: clientDataHash)
        } catch {
            throw AttestationError.attestKeyFailed(error)
        }

        // 4. Send {keyId, attestation, challenge} to the backend, which
        //    consumes the challenge and verifies the attestation.
        try await postRegistration(
            backendURL: backendURL,
            keyId: keyId,
            attestation: attestation,
            challenge: challenge
        )

        defaults.set(keyId, forKey: keyIdKey)
        defaults.set(true, forKey: registeredKey)
    }

    /// Builds the X-Attest-* headers for an outgoing request whose
    /// body is `requestBody`. The backend re-derives the same hash
    /// and verifies the assertion against the public key it stored at
    /// registration.
    func attestationHeaders(for requestBody: Data) async throws -> [String: String] {
        guard let keyId = storedKeyId else {
            throw AttestationError.noKey
        }

        let challenge = Data(UUID().uuidString.utf8)
        let combined = requestBody + challenge
        let clientDataHash = Data(SHA256.hash(data: combined))

        // On real hardware, sign with the attested key. On a
        // simulator or unsupported device, emit a placeholder
        // assertion so the backend's dev-mode path can accept it.
        let assertion: Data
        if service.isSupported, !keyId.hasPrefix("DEV_") {
            do {
                assertion = try await service.generateAssertion(
                    keyId,
                    clientDataHash: clientDataHash
                )
            } catch {
                throw AttestationError.assertionFailed(error)
            }
        } else {
            assertion = Data("DEV_MODE_NOT_SIGNED".utf8)
        }

        return [
            "X-Attest-Key-Id": keyId,
            "X-Attest-Assertion": assertion.base64URLEncodedString(),
            "X-Attest-Challenge": challenge.base64URLEncodedString(),
        ]
    }

    // MARK: - Private

    private struct ChallengeResponse: Decodable {
        let challenge: String
        let expiresAt: Double

        enum CodingKeys: String, CodingKey {
            case challenge
            case expiresAt = "expires_at"
        }
    }

    private func fetchChallenge(backendURL: URL) async throws -> Data {
        var request = URLRequest(url: backendURL.appendingPathComponent("attest/challenge"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            let snippet = String(
                data: data.prefix(512),
                encoding: .utf8
            )
            throw AttestationError.backend(
                (response as? HTTPURLResponse)?.statusCode ?? 0,
                snippet
            )
        }
        let decoded = try JSONDecoder().decode(ChallengeResponse.self, from: data)
        return Data(base64URLDecoding: decoded.challenge) ?? Data(decoded.challenge.utf8)
    }

    private func postRegistration(
        backendURL: URL,
        keyId: String,
        attestation: Data,
        challenge: Data
    ) async throws {
        var request = URLRequest(url: backendURL.appendingPathComponent("attest/register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: String] = [
            "key_id": keyId,
            "attestation": attestation.base64URLEncodedString(),
            "challenge": challenge.base64URLEncodedString(),
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AttestationError.backend(0, nil)
        }
        guard 200..<300 ~= http.statusCode else {
            throw AttestationError.backend(
                http.statusCode,
                String(data: data.prefix(512), encoding: .utf8)
            )
        }
    }
}

// MARK: - Helpers

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Round-trips a server-issued base64url string back into bytes.
    /// Returns nil if the string isn't valid base64url.
    init?(base64URLDecoding string: String) {
        var s = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // Pad to a multiple of 4 — Apple's base64url-encoded payloads
        // arrive without trailing '='.
        let mod = s.count % 4
        if mod > 0 { s.append(String(repeating: "=", count: 4 - mod)) }
        guard let decoded = Data(base64Encoded: s) else { return nil }
        self = decoded
    }
}
