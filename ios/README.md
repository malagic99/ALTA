# Penumbra (iOS)

Native SwiftUI app. Targets **iOS 17+** so we can use SwiftData, the
new `Map` content APIs, and `MapReader.convert(_:from:)` for
tap-to-coordinate.

## What's here

```
ios/
├── project.yml                       # xcodegen config (optional)
├── Penumbra/
│   ├── PenumbraApp.swift                # @main, ModelContainer
│   ├── Models/
│   │   ├── CachedHorizon.swift       # @Model: cached horizon profiles
│   │   ├── RateLimitRecord.swift     # @Model: per-UTC-day request counter
│   │   └── HorizonDTOs.swift         # Codable wire types + value type
│   ├── Networking/
│   │   ├── SecretsStore.swift        # Keychain BYO-backend + Info.plist fallback
│   │   ├── AttestationManager.swift  # DCAppAttestService wrapper, signs requests
│   │   ├── ElevationService.swift    # actor, URLSession, batched ≤512 via backend
│   │   ├── CanopyService.swift       # actor, URLSession, /canopy/sample
│   │   ├── LightPollutionService.swift # Overpass-based Bortle estimator
│   │   └── RateLimiter.swift         # 5/day + refund(), backed by SwiftData
│   ├── Services/
│   │   ├── HorizonOrchestrator.swift # cache + rate limit + ground+canopy
│   │   ├── Ephemeris.swift           # Pure-Swift J2000 → alt/az + refraction
│   │   ├── Twilight.swift            # Astro twilight via sun position
│   │   └── ClearanceCalculator.swift # Target tracks + clears/dips times
│   ├── Views/
│   │   ├── ContentView.swift         # Map, pin drop, calculate, status
│   │   ├── SettingsSheet.swift       # BYOK form (Keychain-backed)
│   │   ├── ClearanceList.swift       # "Milky Way clears at 11:30 PM…"
│   │   └── HorizonRadarView.swift    # SwiftUI Canvas radar + target tracks
│   └── Resources/
│       ├── Info.plist                # Location desc + $(PENUMBRA_*) refs
│       ├── App.xcconfig              # Default build settings (tracked)
│       └── Secrets.example.xcconfig  # Template; copy to Secrets.xcconfig
```

## Setup — option A: drop into an existing Xcode project

1. In Xcode: `File → New → Project → iOS App → Penumbra`. Set deployment
   target to **iOS 17.0**.
2. Delete the boilerplate `ContentView.swift` and `PenumbraApp.swift`
   that the template generates.
3. Drag the `Penumbra/` folder from this repo into the project navigator
   ("Create groups", add to the Penumbra target).
4. Replace the project's `Info.plist` with `Penumbra/Resources/Info.plist`,
   or merge in the keys (`NSLocationWhenInUseUsageDescription` and
   `PenumbraCanopyBackendURL`).
5. Set `PenumbraCanopyBackendURL` to your deployed canopy service URL.

## Setup — option B: generate the project with xcodegen

```bash
brew install xcodegen
cd ios
xcodegen generate         # produces Penumbra.xcodeproj
open Penumbra.xcodeproj
```

xcodegen reads `project.yml` and produces a regenerable `.xcodeproj`,
which is friendlier in source control than the default Xcode-managed
file.

## Configuration — two paths

The app supports **runtime BYOK** (recommended for end-users) and a
**build-time xcconfig** path (developer convenience). Either covers
the keys; both is fine. **Info.plist holds no literal keys** — it
references `$(PENUMBRA_*)` build settings that come from xcconfig and,
at runtime, can be overridden from the Keychain.

### Runtime BYOK (Settings sheet)

Tap the gear in the top-right and paste your **backend URL**. It's
stored in the iOS Keychain
(`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`), so it stays
on-device, survives reinstalls of the same app/team ID, and isn't
synced to iCloud. Tap **Clear stored secrets** to wipe it.

The Google Maps API key is **not** entered here. It lives only on
the backend (Cloud Run + Secret Manager); the iOS app calls
`/elevation/sample` on the backend, which forwards to Google. Each
request is signed with App Attest so the proxy can't be hammered by
arbitrary clients.

### Build-time defaults (xcconfig)

For your own dev builds you can ship a default backend URL without
typing it on every device:

```bash
cd ios/Penumbra/Resources
cp Secrets.example.xcconfig Secrets.xcconfig
# edit Secrets.xcconfig with your real backend URL
```

`Secrets.xcconfig` is gitignored. `App.xcconfig` (tracked) does an
`#include?` so the build still succeeds with no Secrets file — the
backend URL just comes through empty, and the in-app Settings sheet
becomes the only source.

xcconfig quirk to remember: `//` is a comment, even inside a value.
For URLs, break the double-slash with `$()/`:
```
PENUMBRA_BACKEND_URL = https:/$()/penumbra-backend-xxxx.a.run.app
```
The example file already does this.

### Server-side Google Maps key — setup, restrictions, cost

The key only ever exists on the server. To deploy:

1. In the [Google Cloud Console](https://console.cloud.google.com/),
   enable **Maps Elevation API** on your project.
2. Create an API key, restrict it to **Maps Elevation API only** and
   to your Cloud Run service's egress (or leave unrestricted; the
   key never leaves Secret Manager).
3. `gcloud secrets create penumbra-google-maps-key --data-file=key.txt`.
4. Mount on the Cloud Run service:
   ```
   --set-secrets GOOGLE_MAPS_API_KEY=penumbra-google-maps-key:latest
   ```

Because the key never ships in the binary, the old "iOS bundle ID"
restriction isn't necessary. Pulling the key from the IPA is no
longer possible.

**Cost math.** The Elevation API charges $5.00 per 1,000 requests
with 5,000 free requests per month. Each horizon calculation in
this app fits in **one** upstream request (the 36 × 14 grid is
505 points, under the 512-locations-per-request cap), and the
daily rate limiter caps fresh calculations at 5/day. Worst case:
5 × 30 = **150 requests per month**, comfortably inside the free
tier. The cache makes repeats free.

### App Attest

`AttestationManager` (`ios/Penumbra/Networking/AttestationManager.swift`)
wraps `DCAppAttestService`:

1. On first launch the app generates a key in the secure enclave,
   fetches a single-use challenge from the backend's
   `/attest/challenge`, calls `attestKey` against that challenge,
   and POSTs `{key_id, attestation, challenge}` to
   `/attest/register`.
2. Each subsequent request to `/elevation/sample` or
   `/canopy/sample` carries `X-Attest-Key-Id`,
   `X-Attest-Assertion` (ECDSA-P256 over `SHA256(body ‖ challenge)`),
   and `X-Attest-Challenge` headers.

The backend verifies all of this for real
(`backend/canopy/appattest_crypto.py`): cert-chain validation
against the Apple App Attestation Root CA, nonce binding, rpIdHash
= `SHA256(team.bundle)`, aaguid/environment match, ECDSA-P256
signature verification, and atomic compare-and-set on the
App Attest counter for replay protection. Set
`APP_ATTEST_ENFORCE=1` on the backend to turn it on; the dev path
(`0`) accepts any well-formed headers so the simulator can still
exercise the rest of the plumbing.

The entitlement (`Penumbra.entitlements`) ships with
`com.apple.developer.devicecheck.appattest-environment = development`.
Switch to `production` for App Store / TestFlight builds and set
`APP_ATTEST_ENVIRONMENT=appattest` on the backend to match.

### Rate limiter & refunds

- 5 fresh horizon calculations per UTC day (`RateLimiter.dailyLimit`).
- Cache hits are free.
- The slot is consumed *before* network I/O so flaky retries can't
  bypass the cap.
- If the **Elevation backend** fails (quota exceeded, App Attest
  rejected, network error, …) `RateLimiter.refund()` returns the
  slot — you only pay for successful work. Canopy errors are
  soft-failed (terrain-only profile, slot stays consumed since
  terrain still cost a request).

## Light pollution & Bortle estimate

Each fresh horizon also runs a Bortle estimate against OpenStreetMap's
public Overpass API: we pull populated places (city/town/village
nodes with a `population` tag) within 200 km of the pin and compute
a brightness proxy `Σ population_i / (distance_km_i + 1)²`. The sum
is bucketed into a Bortle class 1-9 ("Excellent dark sky" through
"Inner-city"), shown as a colour-graded badge in the horizon card.

The estimate is concurrent with the Elevation + Canopy fetches, so
it doesn't add to the wall-clock time. It soft-fails: if Overpass is
slow or down, the horizon still ships and the badge shows "—" with
"Light-pollution estimate unavailable" — same posture as canopy.

Honest caveats:

- Population/distance² isn't a substitute for a real per-pixel VIIRS
  radiance sample. The dominant signal for "find a spot far from
  cities" *is* distance from cities though, so for ranking pins on
  a road trip it works well. The Bortle bucket boundaries match
  the original Expo build so users moving between platforms see the
  same number for the same pin.
- A visual light-pollution **tile overlay** on the map (the Lorenz
  VIIRS atlas the Expo app showed) needs an `MKMapView` wrapped via
  `UIViewRepresentable` because iOS 17 SwiftUI `Map` doesn't accept
  custom tile sources. Queued for a follow-up.
- Overpass is a free public service; please don't crank `radiusKm`
  to 1000+ km without thinking about the load you'd put on it.

## Target clearance times

After a horizon profile is computed (or pulled from cache), the app
runs a pure-Swift ephemeris pass against a curated catalog of
deep-sky targets — Milky Way core, Andromeda, Orion, Pleiades, North
America Nebula, Lagoon, Rho Ophiuchi, California Nebula — and the
night's astronomical-darkness window. For each target it reports a
sentence like:

> Milky Way core: clears 11:30 PM, dips 2:00 AM (peak 32°).

Plus the same data drawn as a coloured curve on the radar (solid
when the target clears the local horizon, dashed when it's blocked
by terrain/canopy/buildings, with a filled disc at peak altitude).

Edge cases handled:
- **Up at dusk** — "up at dusk, dips 2:00 AM"
- **Up at dawn** — "clears 4:12 AM, still up at dawn"
- **Never visible from this pin** — "Below horizon all night"
- **Polar summer** — twilight solver reports "no astronomical
  darkness tonight" and the list collapses gracefully

The whole pass is local (no network, no key, no rate-limit slot).
Twilight uses a low-precision sun-position formula good to ~1
arcminute through this century; target alt/az uses J2000 RA/Dec
without precession — drift over the next few decades is well below
the radar's resolution.

## Architecture notes

- **SwiftData container** lives on `PenumbraApp`; `Schema` includes
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
- **HorizonOrchestrator** runs the pipeline as
  `surface[i] = ground[i] + canopy[i]`, with ground heights from the
  Elevation API (required) and canopy heights from the Cloud Run
  backend (optional, soft-fails to terrain-only). The 36 × 14 sample
  grid is sized to fit in one Elevation API request — bumping
  `samplesPerRay` past 14 will start splitting into two requests
  per calc and double your billing.

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
