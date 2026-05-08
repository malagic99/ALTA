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
    @State private var statusMessage: String = "Long-press the map to drop a pin."
    @State private var statusTone: StatusTone = .info
    @State private var isCalculating: Bool = false
    @State private var includeCanopy: Bool = true

    @State private var orchestrator: HorizonOrchestrator?

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
        .task {
            if orchestrator == nil {
                let canopy = CanopyService.fromBundle()
                orchestrator = HorizonOrchestrator(
                    context: modelContext,
                    canopyService: canopy
                )
                if canopy == nil {
                    statusMessage = "Canopy backend URL not set in Info.plist — running terrain-only."
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

            HorizonRadarView(profile: profile)
                .aspectRatio(1, contentMode: .fit)
                .frame(maxWidth: 320)
                .frame(maxWidth: .infinity)

            HStack(spacing: 12) {
                meta("Range", "\(Int(profile.maxRangeKm)) km")
                meta("Layers", layerSummary(profile))
                meta("Cached", "\(cachedHorizons.count) spots")
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.ultraThinMaterial)
        )
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
        pinnedCoordinate != nil && !isCalculating && remainingToday > 0
    }

    private var buttonTitle: String {
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
            horizonProfile = HorizonSource.cache(cached).profile
            sourceLabel = "From cache · " + relativeFetched(cached.fetchedAt)
        } else {
            horizonProfile = nil
            sourceLabel = ""
        }
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
