import SwiftUI

/// In-app BYOK form. The keys never leave the device — they live in
/// the iOS Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`)
/// and take precedence over whatever shipped in the bundle.
struct SettingsSheet: View {
    @ObservedObject var secrets: SecretsStore
    @Environment(\.dismiss) private var dismiss

    @State private var apiKey: String = ""
    @State private var canopyURL: String = ""
    @State private var revealKey: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Group {
                            if revealKey {
                                TextField("AIzaSy…", text: $apiKey)
                            } else {
                                SecureField("AIzaSy…", text: $apiKey)
                            }
                        }
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.done)

                        Button {
                            revealKey.toggle()
                        } label: {
                            Image(systemName: revealKey ? "eye.slash" : "eye")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(revealKey ? "Hide key" : "Show key")
                    }
                } header: {
                    HStack {
                        Text("Google Maps API key")
                        Spacer()
                        if secrets.googleMapsAPIKeyOverridden {
                            Label("Keychain", systemImage: "key.fill")
                                .labelStyle(.titleAndIcon)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.cyan)
                        }
                    }
                } footer: {
                    Text("Required to compute the terrain horizon. In Google Cloud Console, restrict the key to your bundle ID and to the Maps Elevation API only — the key ships in the app binary, so an unrestricted key can be misused if it leaks.")
                }

                Section {
                    TextField("https://marko-canopy-…run.app", text: $canopyURL)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.done)
                } header: {
                    HStack {
                        Text("Canopy backend URL")
                        Spacer()
                        if secrets.canopyBackendURLOverridden {
                            Label("Keychain", systemImage: "key.fill")
                                .labelStyle(.titleAndIcon)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.cyan)
                        }
                    }
                } footer: {
                    Text("Optional. Without it, the horizon falls back to terrain only. See backend/canopy in the repo for the Cloud Run service that produces this URL.")
                }

                Section {
                    Button(role: .destructive) {
                        secrets.clearAll()
                        apiKey = ""
                        canopyURL = ""
                    } label: {
                        Label("Clear stored secrets", systemImage: "trash")
                    }
                    .disabled(!secrets.googleMapsAPIKeyOverridden && !secrets.canopyBackendURLOverridden)
                } footer: {
                    Text("Removes the values from this device's Keychain. Bundled defaults (if any) take over again.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                        dismiss()
                    }
                    .bold()
                }
            }
            .onAppear {
                apiKey = secrets.googleMapsAPIKey ?? ""
                canopyURL = secrets.canopyBackendURL ?? ""
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func save() {
        secrets.setGoogleMapsAPIKey(apiKey.trimmingCharacters(in: .whitespacesAndNewlines))
        secrets.setCanopyBackendURL(canopyURL.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

#Preview {
    SettingsSheet(secrets: SecretsStore.shared)
}
