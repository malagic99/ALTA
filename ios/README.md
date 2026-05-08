# Marko (iOS)

Native SwiftUI app. Targets **iOS 17+** so we can use SwiftData, the
new `Map` content APIs, and `MapReader.convert(_:from:)` for
tap-to-coordinate.

## What's here

```
ios/
├── project.yml                       # xcodegen config (optional)
├── Marko/
│   ├── MarkoApp.swift                # @main, ModelContainer
│   ├── Models/
│   │   ├── CachedHorizon.swift       # @Model: cached horizon profiles
│   │   ├── RateLimitRecord.swift     # @Model: per-UTC-day request counter
│   │   └── HorizonDTOs.swift         # Codable wire types + value type
│   ├── Networking/
│   │   ├── CanopyService.swift       # actor, URLSession, /canopy/sample
│   │   └── RateLimiter.swift         # 5/day, backed by SwiftData
│   ├── Services/
│   │   └── HorizonOrchestrator.swift # cache + rate limit + sample grid
│   ├── Views/
│   │   ├── ContentView.swift         # Map, pin drop, calculate, status
│   │   └── HorizonRadarView.swift    # SwiftUI Canvas radar
│   └── Resources/
│       └── Info.plist                # Location desc + MarkoCanopyBackendURL
```

## Setup — option A: drop into an existing Xcode project

1. In Xcode: `File → New → Project → iOS App → Marko`. Set deployment
   target to **iOS 17.0**.
2. Delete the boilerplate `ContentView.swift` and `MarkoApp.swift`
   that the template generates.
3. Drag the `Marko/` folder from this repo into the project navigator
   ("Create groups", add to the Marko target).
4. Replace the project's `Info.plist` with `Marko/Resources/Info.plist`,
   or merge in the keys (`NSLocationWhenInUseUsageDescription` and
   `MarkoCanopyBackendURL`).
5. Set `MarkoCanopyBackendURL` to your deployed canopy service URL.

## Setup — option B: generate the project with xcodegen

```bash
brew install xcodegen
cd ios
xcodegen generate         # produces Marko.xcodeproj
open Marko.xcodeproj
```

xcodegen reads `project.yml` and produces a regenerable `.xcodeproj`,
which is friendlier in source control than the default Xcode-managed
file.

## Configuration

Edit `Marko/Resources/Info.plist`:

```xml
<key>MarkoCanopyBackendURL</key>
<string>https://marko-canopy-xxxx-uc.a.run.app</string>
```

If the URL is left as the default `https://YOUR-CANOPY-SERVICE.run.app`
the app falls back to terrain-only mode and surfaces a warning banner
(once `ElevationService` is wired in — see below).

## Architecture notes

- **SwiftData container** lives on `MarkoApp`; `Schema` includes
  `CachedHorizon` + `RateLimitRecord`.
- **Cache key** is lat/lng rounded to 3 decimal places (~110 m grid).
  Pins very close together share an entry, which means free
  recalculations for nearby spots.
- **TTL**: 30 days. Tweak `HorizonOrchestrator.cacheTTL`. Expired
  entries are returned as `nil` from `cachedProfile(at:)` but aren't
  purged until they're overwritten by a fresh fetch.
- **Rate limit**: 5 fresh calculations per UTC day. Cache hits are
  free. The slot is consumed *before* network I/O so flaky connections
  don't burn it on partial successes — adjust `RateLimiter.consume()`
  if you'd rather refund on error.
- **CanopyService** is an `actor`, so the JSON encoder/decoder are
  protected from concurrent reuse. Batches ≤1024 points, mirroring the
  backend's `MAX_POINTS_PER_REQUEST`.
- **HorizonOrchestrator** ships with ground elevations stubbed at 0 m
  so the canopy + radar pipeline can be exercised end-to-end against
  the existing backend. Implement `ElevationService` mirroring
  `CanopyService`, fold its results into `groundElevations` inside
  `computeHorizon`, and flip `includesTerrain` on the produced profile.

## Honest caveats

- I haven't compiled this in Xcode (no macOS in this sandbox), so
  there may be small build issues — typically Info.plist key strings,
  signing, or the deployment target. The Swift itself targets the
  public iOS 17 SDK.
- The radar polygon uses `FillStyle(eoFill: true)` for the annulus.
  On iOS 17 this works in `Canvas`; if you see the obstruction render
  inverted on a future SDK, swap to a stroked outline of the same
  polygon.
- `Map(position:)` long-press → coordinate conversion uses
  `MapReader.proxy.convert(_:from:)`, which can return nil while the
  initial camera animation is still in flight. The handler treats nil
  as "ignore this gesture" rather than placing a pin at (0,0).
