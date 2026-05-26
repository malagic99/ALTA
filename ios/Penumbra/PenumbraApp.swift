import SwiftUI
import SwiftData

@main
struct PenumbraApp: App {
    /// Single shared SwiftData container. Both `CachedHorizon` and
    /// `RateLimitRecord` are persisted here.
    let modelContainer: ModelContainer = {
        let schema = Schema([
            CachedHorizon.self,
            RateLimitRecord.self,
        ])
        let configuration = ModelConfiguration(
            "Penumbra",
            schema: schema,
            isStoredInMemoryOnly: false,
            allowsSave: true
        )
        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            fatalError("Failed to create SwiftData container: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(modelContainer)
    }
}
