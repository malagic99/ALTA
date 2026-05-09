import Foundation
import Security

/// Single source of truth for the API key + canopy backend URL.
///
/// Lookup precedence on every read:
///   1. Keychain (user-supplied via the in-app Settings sheet)
///   2. Info.plist (developer default from the build's xcconfig)
///
/// This means a TestFlight user can BYOK without rebuilding — they
/// open Settings, paste their key, and it's persisted to the device
/// Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`)
/// where it stays until they clear it. Removing the Keychain entry
/// reverts to whatever shipped in the bundle (or "missing", which
/// the services already handle by disabling Calculate).
@MainActor
final class SecretsStore: ObservableObject {
    static let shared = SecretsStore()

    @Published private(set) var canopyBackendURL: String?

    /// True when the active value came from the Keychain rather than
    /// the bundle. Lets the Settings sheet show a "Stored on device"
    /// indicator next to overridden fields.
    @Published private(set) var canopyBackendURLOverridden: Bool = false

    private static let keychainService = "com.marko.astro.secrets"

    private enum Account {
        static let canopyBackendURL = "canopy_backend_url"
    }

    private init() {
        reload()
    }

    /// Re-reads Keychain + bundle and republishes. Called automatically
    /// from `set…` mutators; also exposed for app-foreground refresh.
    func reload() {
        let keychainURL = Self.read(account: Account.canopyBackendURL)
        canopyBackendURL = keychainURL ?? Self.bundleString("MarkoCanopyBackendURL")
        canopyBackendURLOverridden = (keychainURL != nil)
    }

    /// Persists or clears (pass nil/empty) the user's canopy backend URL.
    func setCanopyBackendURL(_ value: String?) {
        Self.write(account: Account.canopyBackendURL, value: value)
        reload()
    }

    /// Wipes all user-supplied secrets. Bundle defaults take over again.
    func clearAll() {
        Self.write(account: Account.canopyBackendURL, value: nil)
        reload()
    }

    // MARK: - Keychain helpers

    private static func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let string = String(data: data, encoding: .utf8),
              !string.isEmpty
        else { return nil }
        return string
    }

    private static func write(account: String, value: String?) {
        // Treat nil and whitespace-only as "clear".
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmed, !trimmed.isEmpty else {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keychainService,
                kSecAttrAccount as String: account,
            ]
            SecItemDelete(query as CFDictionary)
            return
        }

        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: Data(trimmed.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attrs as CFDictionary)
        if updateStatus == errSecItemNotFound {
            var addQuery = baseQuery
            for (k, v) in attrs { addQuery[k] = v }
            SecItemAdd(addQuery as CFDictionary, nil)
        }
        // Other update statuses are silently ignored — the Settings
        // sheet shows a generic toast on failure via reload's diff.
    }

    /// Returns the Info.plist string at `key`, unless it's empty or
    /// still set to one of the documented placeholders. This matches
    /// the prior `loadAPIKey` / `loadBackendURL` heuristics so the
    /// services keep treating "unconfigured" the same way.
    private static func bundleString(_ key: String) -> String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              !raw.isEmpty,
              !raw.contains("YOUR_"),
              !raw.contains("YOUR-")
        else { return nil }
        return raw
    }
}
