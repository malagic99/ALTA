# Penumbra

Native SwiftUI iOS app that finds astrophotography-friendly observation
spots: drop a pin, get a 360° horizon (terrain + tree canopy), a Bortle
dark-sky estimate, and per-target "Milky Way clears at 11:30 PM, dips
at 2:00 AM" clearance times for tonight's astronomical-darkness window.

> Repo directory and GitHub remote stay named `Marko` for historical
> reasons; the product is **Penumbra**.

## Layout

```
ios/                  Native SwiftUI app (iOS 17+)
  Penumbra/
    PenumbraApp.swift       @main, SwiftData container
    Models/                 SwiftData @Models + DTOs + target catalog
    Networking/             URLSession services + App Attest + Keychain
    Services/               Horizon math, ephemeris, clearance, twilight
    Views/                  ContentView, SettingsSheet, HorizonRadarView,
                            ClearanceList
    Resources/              Info.plist, xcconfig, entitlements
  project.yml               xcodegen config (optional)
  README.md                 Architecture notes
backend/
  penumbra/                 FastAPI service for Cloud Run
    main.py                 App + /canopy/sample + /health
    elevation.py            POST /elevation/sample → Google Elevation
    attest.py               App Attest router + verify_assertion dependency
    appattest_crypto.py     Real Apple verification (cert chain, ECDSA)
    attest_store.py         Firestore + in-memory key/challenge stores
    requirements.txt
    Dockerfile
    README.md               Deploy + env reference
BUILD_INSTRUCTIONS.txt      Step-by-step runbook for first build + ship
```

## Quick start

Read **`BUILD_INSTRUCTIONS.txt`** end to end. It covers:

1. Apple Developer setup (bundle ID + App Attest capability)
2. Google Cloud setup (project, APIs, Maps key, GEE service account,
   Secret Manager, Firestore, Cloud Run deploy)
3. Xcode build + run on a real device
4. TestFlight + App Store submission checklist

Everything else in this repo is reference material.

## What's where, for the impatient

| I want to… | Read |
|---|---|
| Set up + ship the app | `BUILD_INSTRUCTIONS.txt` |
| Understand the iOS architecture | `ios/README.md` |
| Understand or deploy the backend | `backend/penumbra/README.md` |
