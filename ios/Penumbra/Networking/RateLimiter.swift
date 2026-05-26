import Foundation
import SwiftData

/// Errors thrown when the daily horizon-calculation budget is exhausted.
enum RateLimitError: LocalizedError {
    case exhausted(remainingSeconds: Int)

    var errorDescription: String? {
        switch self {
        case .exhausted(let seconds):
            let hours = seconds / 3600
            let minutes = (seconds % 3600) / 60
            if hours > 0 {
                return "Daily horizon limit reached. Resets in \(hours)h \(minutes)m."
            }
            return "Daily horizon limit reached. Resets in \(minutes)m."
        }
    }
}

/// Enforces a per-day cap on fresh horizon calculations. Cache hits
/// shouldn't go through this — only network calls. Keyed off the UTC
/// calendar day so the limit resets at the same wall-clock moment for
/// everyone regardless of timezone.
@MainActor
final class RateLimiter {
    static let dailyLimit: Int = 5

    private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
    }

    /// Number of fresh horizon calculations remaining today.
    func remaining(now: Date = .now) -> Int {
        let used = (try? record(for: now))?.count ?? 0
        return max(0, Self.dailyLimit - used)
    }

    /// Time until the daily counter resets (next UTC midnight).
    func secondsUntilReset(now: Date = .now) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        guard let nextMidnight = calendar.nextDate(
            after: now,
            matching: DateComponents(hour: 0, minute: 0, second: 0),
            matchingPolicy: .nextTime,
            direction: .forward
        ) else { return 0 }
        return max(0, Int(nextMidnight.timeIntervalSince(now)))
    }

    /// Increments today's counter and persists. Throws if the limit has
    /// already been reached. Atomic from the caller's perspective: if it
    /// returns successfully the slot is reserved, if it throws the
    /// counter wasn't touched.
    func consume(now: Date = .now) throws {
        let key = RateLimitRecord.todayKey(now: now)
        if let existing = try record(for: now) {
            guard existing.count < Self.dailyLimit else {
                throw RateLimitError.exhausted(remainingSeconds: secondsUntilReset(now: now))
            }
            existing.count += 1
            existing.lastHitAt = now
        } else {
            let new = RateLimitRecord(dayKey: key, count: 1, firstHitAt: now, lastHitAt: now)
            context.insert(new)
            // Best-effort prune of yesterday's records.
            pruneOldRecords(keeping: key)
        }
        try context.save()
    }

    /// Returns a previously-consumed slot. Called when an upstream API
    /// (e.g. the Google Elevation API) failed *after* `consume()` had
    /// already reserved a slot — we don't want to charge the user for
    /// network round-trips that didn't produce a result. No-op if the
    /// counter is already at zero or if the day has rolled over since
    /// the consume.
    ///
    /// Best-effort: any persistence error is swallowed because the
    /// caller is already in an error path and we don't want to mask
    /// the original failure with a refund failure.
    func refund(now: Date = .now) {
        guard let existing = try? record(for: now), existing.count > 0 else { return }
        existing.count -= 1
        existing.lastHitAt = now
        try? context.save()
    }

    // MARK: - Private

    private func record(for now: Date) throws -> RateLimitRecord? {
        let key = RateLimitRecord.todayKey(now: now)
        var descriptor = FetchDescriptor<RateLimitRecord>(
            predicate: #Predicate { $0.dayKey == key }
        )
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    private func pruneOldRecords(keeping todayKey: String) {
        let descriptor = FetchDescriptor<RateLimitRecord>(
            predicate: #Predicate { $0.dayKey != todayKey }
        )
        if let stale = try? context.fetch(descriptor) {
            for r in stale {
                context.delete(r)
            }
        }
    }
}
