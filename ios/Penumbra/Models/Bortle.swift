import Foundation

/// Bortle dark-sky scale, 1 (excellent) through 9 (inner-city).
/// See https://en.wikipedia.org/wiki/Bortle_scale.
struct BortleEstimate: Sendable, Equatable {
    /// Bortle class, 1...9.
    let `class`: Int
    /// Raw brightness proxy (population / distance² sum, dimensionless).
    /// Useful for diffing two pins in the same Bortle bucket.
    let brightnessProxy: Double

    var label: String { Self.label(for: `class`) }

    static func label(for bortle: Int) -> String {
        switch bortle {
        case 1: return "Excellent dark sky"
        case 2: return "Typical dark site"
        case 3: return "Rural sky"
        case 4: return "Rural / suburban transition"
        case 5: return "Suburban sky"
        case 6: return "Bright suburban"
        case 7: return "Suburban / urban transition"
        case 8: return "City sky"
        default: return "Inner-city sky"
        }
    }

    /// Map the brightness proxy to a Bortle bucket. Thresholds are
    /// tuned so remote desert sites land at class 1-2, suburbs at
    /// 5-6, and city centers at 8-9 with the population/distance²
    /// model used by `LightPollutionService`. They match the Expo
    /// implementation so users moving between platforms see the same
    /// number for the same pin.
    static func classify(brightnessProxy b: Double) -> Int {
        if b < 50 { return 1 }
        if b < 200 { return 2 }
        if b < 800 { return 3 }
        if b < 3_000 { return 4 }
        if b < 12_000 { return 5 }
        if b < 40_000 { return 6 }
        if b < 120_000 { return 7 }
        if b < 400_000 { return 8 }
        return 9
    }
}
