import Foundation
import SwiftData

/// Tracks how many fresh horizon calculations the user has performed
/// today. Cache hits don't increment the counter — only network calls do.
/// One record per UTC day; old records are pruned by the rate limiter
/// the first time the day rolls over.
@Model
final class RateLimitRecord {
    /// "YYYY-MM-DD" in UTC.
    @Attribute(.unique) var dayKey: String

    /// Number of fresh horizon calculations consumed for `dayKey`.
    var count: Int

    /// First time the user hit the API on `dayKey`.
    var firstHitAt: Date

    /// Last time the user hit the API on `dayKey`.
    var lastHitAt: Date

    init(dayKey: String, count: Int = 0, firstHitAt: Date = .now, lastHitAt: Date = .now) {
        self.dayKey = dayKey
        self.count = count
        self.firstHitAt = firstHitAt
        self.lastHitAt = lastHitAt
    }
}

extension RateLimitRecord {
    /// "YYYY-MM-DD" for the current instant in UTC.
    static func todayKey(now: Date = .now) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        let comps = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
    }
}
