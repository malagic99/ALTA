import SwiftUI
import SwiftData
import MapKit
import CoreLocation

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext

    /// Surface every cached profile so we can plot them as map pins and
    /// surface "X cached locations" in the status bar.
    @Query(sort: \CachedHorizon.fetchedAt, order: .reverse)
    private var cachedHorizons: [CachedHorizon]

    /// Drives the "X of 5 left today" indicator.
    @Query(sort: \RateLimitRecord.dayKey, order: .reverse)
    private var rateRecords: [RateLimitRecord]

    @State private var cameraPosition: MapCameraPosition = .userLocation(
        followsHeading: false,
        fallback: .region(.fallbackRegion)
    )
    @State private var pinnedCoordinate: CLLocationCoordinate2D?
    @State private var horizonProfile: HorizonProfile?
    @State private var sourceLabel: String = ""
    @State private var twilightWindow: TwilightWindow?
    @State private var targetTracks: [TargetTrack] = []
    @State private var statusMessage: String = "Long-press the map to drop a pin."
    @State private var statusTone: StatusTone = .info
    @State private var isCalculating: Bool = false
    @State private var includeCanopy: Bool = true

    @State private var orchestrator: HorizonOrchestrator?
    @State private var elevationConfigured: Bool = false
    @State private var showSettings: Bool = false

    @StateObject private var secrets = SecretsStore.shared

    var body: some View {
        ZStack(alignment: .bottom) {
            mapLayer

            statusBanner
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .frame(maxHeight: .infinity, alignment: .top)
                .ignoresSafeArea(edges: .bottom)
                .allowsHitTesting(false)

            controlsLayer
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
        }
        .overlay(alignment: .topTrailing) {
            settingsButton
                .padding(.top, 64)
                .padding(.trailing, 14)
        }
        .task {
            if orchestrator == nil {
                rebuildOrchestrator(initial: true)
            }
        }
        .onChange(of: secrets.canopyBackendURL) { _, _ in rebuildOrchestrator(initial: false) }
        .sheet(isPresented: $showSettings) {
            SettingsSheet(secrets: secrets)
        }
    }

    private var settingsButton: some View {
        Button { showSettings = true } label: {
            Image(systemName: "gearshape.fill")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(
                    Circle().fill(.thinMaterial)
                )
                .overlay(alignment: .topTrailing) {
                    if !elevationConfigured {
                        // Tiny dot to nudge users toward Settings when
                        // the app is unconfigured.
                        Circle()
                            .fill(.red)
                            .frame(width: 9, height: 9)
                            .offset(x: 2, y: -2)
                    }
                }
        }
        .accessibilityLabel("Settings")
    }

    private func rebuildOrchestrator(initial: Bool) {
        let elevation = ElevationService.fromBundle()
        let canopy = CanopyService.fromBundle()
        elevationConfigured = (elevation != nil)
        orchestrator = HorizonOrchestrator(
            context: modelContext,
            elevationService: elevation,
            canopyService: canopy
        )

        if elevation == nil || canopy == nil {
            statusMessage = "Open Settings to add your Penumbra backend URL."
            statusTone = .warning
        } else if !initial {
            statusMessage = "Settings updated."
            statusTone = .success
        }

        // Kick off App Attest registration as soon as a backend URL
        // is available. Idempotent: runs once per device, no-ops on
        // subsequent calls. Errors here are logged via the status
        // banner but don't block the rest of the UI.
        if elevation != nil {
            Task {
                do {
                    try await AttestationManager.shared.bootstrapIfNeeded()
                } catch {
                    statusMessage = "App Attest setup: \(error.localizedDescription)"
                    statusTone = .warning
                }
            }
        }
    }

    // MARK: - Map

    private var mapLayer: some View {
        MapReader { proxy in
            Map(position: $cameraPosition) {
                UserAnnotation()

                ForEach(cachedHorizons) { cached in
                    Annotation(
                        "Cached",
                        coordinate: CLLocationCoordinate2D(
                            latitude: cached.latitude,
                            longitude: cached.longitude
                        )
                    ) {
                        Image(systemName: "mappin.and.ellipse")
                            .foregroundStyle(.white.opacity(0.6))
                            .padding(4)
                            .background(Circle().fill(.black.opacity(0.55)))
                    }
                }

                if let pinnedCoordinate {
                    Annotation("Pinned", coordinate: pinnedCoordinate) {
                        Image(systemName: "scope")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.cyan)
                            .padding(6)
                            .background(Circle().fill(.black.opacity(0.65)))
                            .overlay(Circle().stroke(.cyan, lineWidth: 1.5))
                    }
                }
            }
            .mapStyle(.hybrid(elevation: .realistic))
            .gesture(
                LongPressGesture(minimumDuration: 0.4)
                    .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .local))
                    .onEnded { value in
                        switch value {
                        case .second(true, let drag?):
                            if let coord = proxy.convert(drag.location, from: .local) {
                                Task { await dropPin(at: coord) }
                            }
                        default:
                            break
                        }
                    }
            )
            .ignoresSafeArea()
        }
    }

    // MARK: - Status banner

    private var statusBanner: some View {
        HStack(spacing: 10) {
            if isCalculating {
                ProgressView().tint(.white)
            } else {
                Image(systemName: statusTone.icon)
                    .foregroundStyle(statusTone.color)
            }
            Text(statusMessage)
                .font(.callout)
                .foregroundStyle(.white)
                .lineLimit(2)
            Spacer(minLength: 0)
            quotaPill
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.thinMaterial)
        )
    }

    private var quotaPill: some View {
        let remaining = remainingToday
        return Text("\(remaining)/5")
            .font(.caption.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(remaining == 0 ? Color.red : .white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(
                Capsule().fill(remaining == 0 ? Color.red.opacity(0.18) : Color.white.opacity(0.10))
            )
    }

    // MARK: - Bottom controls / details

    private var controlsLayer: some View {
        VStack(spacing: 12) {
            if let profile = horizonProfile {
                horizonCard(profile)
            }

            HStack(spacing: 10) {
                Button {
                    Task { await calculate(forceRefresh: false) }
                } label: {
                    Label(buttonTitle, systemImage: "wand.and.stars")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(canCalculate ? Color.cyan : Color.gray.opacity(0.4))
                        )
                        .foregroundStyle(.black)
                }
                .disabled(!canCalculate)

                Button {
                    Task { await calculate(forceRefresh: true) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.headline)
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(.thinMaterial)
                        )
                }
                .disabled(!canCalculate)
                .accessibilityLabel("Force recalculate")
            }
        }
    }

    private func horizonCard(_ profile: HorizonProfile) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Horizon profile")
                        .font(.headline)
                    Text(sourceLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Toggle(isOn: $includeCanopy) {
                    Text("Canopy")
                        .font(.caption.weight(.semibold))
                }
                .labelsHidden()
                .toggleStyle(.switch)
                .tint(.cyan)
            }

            HorizonRadarView(profile: profile, tracks: targetTracks)
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: 320)
                .frame(maxWidth: .infinity)

            bortleRow(profile)

            HStack(spacing: 12) {
                meta("Range", "\(Int(profile.maxRangeKm)) km")
                meta("Layers", layerSummary(profile))
                meta("Cached", "\(cachedHorizons.count) spots")
            }

            if let window = twilightWindow, !targetTracks.isEmpty {
                Divider().background(Color.white.opacity(0.08))
                ClearanceList(tracks: targetTracks, window: window)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.ultraThinMaterial)
        )
    }

    @ViewBuilder
    private func bortleRow(_ profile: HorizonProfile) -> some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(bortleColor(profile.bortleClass))
                    .frame(width: 28, height: 28)
                Text(profile.bortleClass.map(String.init) ?? "—")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.black.opacity(0.85))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(profile.bortleClass.map { "Bortle \($0)" } ?? "Sky brightness")
                    .font(.subheadline.weight(.semibold))
                Text(profile.bortleClass.map(BortleEstimate.label(for:))
                     ?? "Light-pollution estimate unavailable")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    private func bortleColor(_ bortle: Int?) -> Color {
        guard let b = bortle else { return Color.gray.opacity(0.4) }
        // Cool dark green for excellent skies → desaturated red for inner-city.
        switch b {
        case 1: return Color(red: 0.23, green: 0.78, blue: 0.55)
        case 2: return Color(red: 0.40, green: 0.84, blue: 0.50)
        case 3: return Color(red: 0.65, green: 0.85, blue: 0.40)
        case 4: return Color(red: 0.92, green: 0.85, blue: 0.30)
        case 5: return Color(red: 0.96, green: 0.74, blue: 0.30)
        case 6: return Color(red: 0.98, green: 0.60, blue: 0.32)
        case 7: return Color(red: 0.95, green: 0.45, blue: 0.40)
        case 8: return Color(red: 0.90, green: 0.36, blue: 0.45)
        default: return Color(red: 0.78, green: 0.30, blue: 0.55)
        }
    }

    private func meta(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Behaviour

    private var canCalculate: Bool {
        elevationConfigured
            && pinnedCoordinate != nil
            && !isCalculating
            && remainingToday > 0
    }

    private var buttonTitle: String {
        if !elevationConfigured { return "Set backend URL" }
        if pinnedCoordinate == nil { return "Drop a pin first" }
        if remainingToday == 0 { return "Daily limit reached" }
        return "Calculate horizon"
    }

    private var remainingToday: Int {
        let key = RateLimitRecord.todayKey()
        let used = rateRecords.first(where: { $0.dayKey == key })?.count ?? 0
        return max(0, RateLimiter.dailyLimit - used)
    }

    private func dropPin(at coordinate: CLLocationCoordinate2D) async {
        pinnedCoordinate = coordinate
        statusMessage = String(
            format: "Pinned at %.4f, %.4f.",
            coordinate.latitude,
            coordinate.longitude
        )
        statusTone = .info

        // Auto-show a cached profile if we already have one for this spot.
        if let orchestrator, let cached = orchestrator.cachedProfile(at: coordinate) {
            let profile = HorizonSource.cache(cached).profile
            horizonProfile = profile
            sourceLabel = "From cache · " + relativeFetched(cached.fetchedAt)
            recomputeTracks(profile: profile, observer: coordinate)
        } else {
            horizonProfile = nil
            sourceLabel = ""
            twilightWindow = nil
            targetTracks = []
        }
    }

    /// Re-runs the local ephemeris + clearance pass against the
    /// current pin and a fresh twilight window. Pure, no network.
    private func recomputeTracks(profile: HorizonProfile, observer: CLLocationCoordinate2D) {
        let window = TwilightSolver.nextWindow(
            latitudeDegrees: observer.latitude,
            longitudeDegrees: observer.longitude
        )
        twilightWindow = window
        targetTracks = ClearanceCalculator.tracksForCatalog(
            profile: profile,
            observer: observer,
            window: window
        )
    }

    private func calculate(forceRefresh: Bool) async {
        guard let pinnedCoordinate, let orchestrator else { return }
        isCalculating = true
        defer { isCalculating = false }

        do {
            let result = try await orchestrator.getOrComputeHorizon(
                at: pinnedCoordinate,
                includeCanopy: includeCanopy,
                forceRefresh: forceRefresh
            )
            horizonProfile = result.profile
            recomputeTracks(profile: result.profile, observer: pinnedCoordinate)
            switch result {
            case .cache(let cached):
                sourceLabel = "From cache · " + relativeFetched(cached.fetchedAt)
                statusMessage = "Served from offline cache. No quota used."
                statusTone = .success
            case .fresh:
                sourceLabel = "Fresh · just now"
                statusMessage = "Horizon computed. \(remainingToday) of 5 calls left today."
                statusTone = .success
            }
        } catch let RateLimitError.exhausted(seconds) {
            statusMessage = RateLimitError.exhausted(remainingSeconds: seconds).localizedDescription
            statusTone = .error
        } catch {
            statusMessage = error.localizedDescription
            statusTone = .error
        }
    }

    private func relativeFetched(_ date: Date) -> String {
        let fmt = RelativeDateTimeFormatter()
        fmt.unitsStyle = .abbreviated
        return fmt.localizedString(for: date, relativeTo: .now)
    }

    private func layerSummary(_ p: HorizonProfile) -> String {
        var parts: [String] = []
        if p.includesTerrain { parts.append("terrain") }
        if p.includesCanopy { parts.append("canopy") }
        if p.includesBuildings { parts.append("buildings") }
        if parts.isEmpty { parts.append("none") }
        return parts.joined(separator: " + ")
    }
}

// MARK: - Helpers

private enum StatusTone {
    case info, success, warning, error

    var icon: String {
        switch self {
        case .info: "info.circle"
        case .success: "checkmark.circle"
        case .warning: "exclamationmark.triangle"
        case .error: "xmark.octagon"
        }
    }

    var color: Color {
        switch self {
        case .info: .white.opacity(0.7)
        case .success: .green
        case .warning: .orange
        case .error: .red
        }
    }
}

private extension MKCoordinateRegion {
    /// Continental US center as a generic fallback when the user denies
    /// location access on first launch.
    static var fallbackRegion: MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 39.5, longitude: -106.0),
            span: MKCoordinateSpan(latitudeDelta: 6, longitudeDelta: 6)
        )
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [CachedHorizon.self, RateLimitRecord.self], inMemory: true)
        .preferredColorScheme(.dark)
}
