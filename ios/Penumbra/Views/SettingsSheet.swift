import SwiftUI

/// In-app BYOB (bring-your-own-backend) form. The Penumbra backend URL
/// lives in the iOS Keychain
/// (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) and takes
/// precedence over whatever shipped in the bundle.
///
/// The Google Maps API key isn't entered here any more — the backend
/// proxy holds it server-side, gated by App Attest.
struct SettingsSheet: View {
    @ObservedObject var secrets: SecretsStore
    @Environment(\.dismiss) private var dismiss

    @State private var canopyURL: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://penumbra-backend-…run.app", text: $canopyURL)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .submitLabel(.done)
                } header: {
                    HStack {
                        Text("Penumbra backend URL")
                        Spacer()
                        if secrets.canopyBackendURLOverridden {
                            Label("Keychain", systemImage: "key.fill")
                                .labelStyle(.titleAndIcon)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.cyan)
                        }
                    }
                } footer: {
                    Text("Required. The backend proxies the Google Maps Elevation API and serves Meta canopy heights. Each request is signed with App Attest so only this app on this device can call it. See backend/canopy in the repo for the Cloud Run service that produces this URL.")
                }

                Section {
                    Button(role: .destructive) {
                        secrets.clearAll()
                        canopyURL = ""
                    } label: {
                        Label("Clear stored secrets", systemImage: "trash")
                    }
                    .disabled(!secrets.canopyBackendURLOverridden)
                } footer: {
                    Text("Removes the value from this device's Keychain. Bundled defaults (if any) take over again.")
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
                canopyURL = secrets.canopyBackendURL ?? ""
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func save() {
        secrets.setCanopyBackendURL(canopyURL.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

#Preview {
    SettingsSheet(secrets: SecretsStore.shared)
}
