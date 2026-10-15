import SwiftUI

/// Vertical list of target clearance summaries — the headline
/// readout: "Milky Way core: clears 11:30 PM, dips 2:00 AM (peak 32°)."
struct ClearanceList: View {
    let tracks: [TargetTrack]
    let window: TwilightWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.cyan)
                Text("Tonight's targets")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(windowLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 6) {
                ForEach(tracks) { track in
                    row(for: track)
                }
            }
        }
    }

    private func row(for track: TargetTrack) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(track.target.tint)
                .frame(width: 8, height: 8)
                .padding(.top, 5)
                .opacity(track.neverClears ? 0.35 : 1)

            VStack(alignment: .leading, spacing: 2) {
                Text(track.target.shortName)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(track.neverClears ? .secondary : .primary)
                Text(track.clearanceSentence())
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)
        }
    }

    private var windowLabel: String {
        switch window.quality {
        case .neverDark:
            return "no astronomical darkness tonight"
        case .astronomical:
            return "\(Self.timeFmt.string(from: window.dusk)) → \(Self.timeFmt.string(from: window.dawn))"
        case .nautical, .civil:
            return "\(window.quality.rawValue.lowercased()): \(Self.timeFmt.string(from: window.dusk)) → \(Self.timeFmt.string(from: window.dawn))"
        }
    }

    private static let timeFmt: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f
    }()
}
