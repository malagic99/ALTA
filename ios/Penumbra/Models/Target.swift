import Foundation
import SwiftUI

/// A deep-sky astrophotography target. Coordinates are J2000.0
/// equatorial — the precession drift over the next few decades
/// (~50″/year) is well below the resolution of this app's horizon
/// radar, so we don't bother with epoch transforms.
struct DSOTarget: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let shortName: String
    /// Right Ascension in decimal hours, J2000.
    let raHours: Double
    /// Declination in decimal degrees, J2000.
    let decDegrees: Double
    /// Display tint for the radar track and the list-row dot.
    let tintHex: String
    let category: Category

    enum Category: String, Sendable {
        case milkyWay = "Milky Way region"
        case galaxy = "Galaxy"
        case nebula = "Nebula"
        case cluster = "Cluster"
    }

    var raRadians: Double { raHours * 15 * .pi / 180 }
    var decRadians: Double { decDegrees * .pi / 180 }
    var tint: Color { Color(hex: tintHex) }
}

/// Curated catalog of common northern-hemisphere astrophotography
/// targets. Kept short on purpose — eight rows fit comfortably on
/// an iPhone screen and represent the distinct seasonal lanes a
/// hobbyist actually shoots.
enum DSOCatalog {
    static let all: [DSOTarget] = [
        DSOTarget(
            id: "mw_core",
            name: "Milky Way galactic core",
            shortName: "Milky Way core",
            raHours: 17.7611,
            decDegrees: -28.9928,
            tintHex: "#FFD27A",
            category: .milkyWay
        ),
        DSOTarget(
            id: "m31",
            name: "Andromeda Galaxy (M31)",
            shortName: "Andromeda",
            raHours: 0.7122,
            decDegrees: 41.2689,
            tintHex: "#9FCAFF",
            category: .galaxy
        ),
        DSOTarget(
            id: "m42",
            name: "Orion Nebula (M42)",
            shortName: "Orion",
            raHours: 5.5878,
            decDegrees: -5.3911,
            tintHex: "#FFAAAA",
            category: .nebula
        ),
        DSOTarget(
            id: "m45",
            name: "Pleiades (M45)",
            shortName: "Pleiades",
            raHours: 3.7903,
            decDegrees: 24.1167,
            tintHex: "#A8E6FF",
            category: .cluster
        ),
        DSOTarget(
            id: "ngc7000",
            name: "North America Nebula (NGC 7000)",
            shortName: "N.A. Nebula",
            raHours: 20.9806,
            decDegrees: 44.3333,
            tintHex: "#FFB6C1",
            category: .nebula
        ),
        DSOTarget(
            id: "m8",
            name: "Lagoon Nebula (M8)",
            shortName: "Lagoon",
            raHours: 18.0608,
            decDegrees: -24.3866,
            tintHex: "#FF9D9D",
            category: .nebula
        ),
        DSOTarget(
            id: "rho_oph",
            name: "Rho Ophiuchi cloud complex",
            shortName: "Rho Oph",
            raHours: 16.4144,
            decDegrees: -23.4567,
            tintHex: "#E0BBE4",
            category: .milkyWay
        ),
        DSOTarget(
            id: "ngc1499",
            name: "California Nebula (NGC 1499)",
            shortName: "California",
            raHours: 4.0322,
            decDegrees: 36.4167,
            tintHex: "#FFC1A6",
            category: .nebula
        ),
    ]
}

private extension Color {
    init(hex: String) {
        let trimmed = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        Scanner(string: trimmed).scanHexInt64(&v)
        let r = Double((v >> 16) & 0xFF) / 255
        let g = Double((v >> 8) & 0xFF) / 255
        let b = Double(v & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
