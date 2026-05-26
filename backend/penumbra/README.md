# Penumbra backend

FastAPI service that the iOS app calls for every operation that
requires a credentialed upstream:

- `POST /canopy/sample` — Meta canopy height samples via Google
  Earth Engine.
- `POST /elevation/sample` — proxies the Google Maps Elevation API
  so the app never has to embed Google's key.
- `POST /attest/challenge` — server-issued single-use nonce for
  App Attest registration.
- `POST /attest/register` — verifies a `DCAppAttestService`
  attestation against Apple's App Attestation Root CA, stores the
  device's public key.
- `GET /health` — liveness probe.

Both `sample` endpoints are gated by App Attest assertions
(`X-Attest-Key-Id`, `X-Attest-Assertion`, `X-Attest-Challenge`) so
random callers can't hammer them.

## API

```
POST /canopy/sample
{
  "points": [{"lat": 40.0, "lng": -105.0}, ...],
  "asset": "projects/sat-io/open-datasets/facebook/meta-canopy-height", // optional
  "band": "b1",      // optional
  "scale_m": 1       // optional
}
→
{
  "heights_m": [12.4, 0.0, 23.1, ...],
  "asset": "...", "band": "b1", "scale_m": 1
}

POST /elevation/sample
{
  "points": [{"lat": 40.0, "lng": -105.0}, ...]
}
→
{
  "elevations_m": [1655.2, 1701.4, ...]
}

POST /attest/challenge
→
{
  "challenge": "<base64url, 32 random bytes>",
  "expires_at": 1700000000.0
}

POST /attest/register
{
  "key_id": "<base64url>",
  "attestation": "<base64url CBOR>",
  "challenge": "<base64url, from /attest/challenge>"
}
→
{ "ok": true }
```

`GET /health` returns `{ "ok": true, "default_asset": "..." }`.

## One-time GEE setup

1. Create a Google Cloud project (or reuse the one with your Maps key).
2. Enable the **Earth Engine API** on it.
3. Create a service account and download a JSON key.
4. Register the service account with Earth Engine:
   <https://signup.earthengine.google.com/#!/service_accounts>
5. Confirm the asset path is readable by the service account (the
   default `projects/sat-io/...` is public, but private assets need an
   explicit share).

## Local run

```bash
cd backend/canopy
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

export GEE_SERVICE_ACCOUNT='svc@your-proj.iam.gserviceaccount.com'
export GEE_KEY_FILE="$PWD/key.json"   # path to the JSON you downloaded

python main.py            # listens on :8080
# or
uvicorn main:app --reload
```

Smoke-test (note `APP_ATTEST_ENFORCE=0` and the dev-mode header):

```bash
APP_ATTEST_ENFORCE=0 GOOGLE_MAPS_API_KEY=... uvicorn main:app

curl -s localhost:8080/canopy/sample \
  -H 'Content-Type: application/json' \
  -H 'X-Attest-Key-Id: DEV_local' \
  -d '{"points":[{"lat":40.0,"lng":-105.0},{"lat":0,"lng":0}]}' | jq

curl -s localhost:8080/elevation/sample \
  -H 'Content-Type: application/json' \
  -H 'X-Attest-Key-Id: DEV_local' \
  -d '{"points":[{"lat":39.7392,"lng":-104.9903}]}' | jq
```

## Deploy to Cloud Run

```bash
PROJECT_ID=your-proj
REGION=us-central1
SVC_ACC='svc@your-proj.iam.gserviceaccount.com'
APPLE_TEAM=ABC123XYZ           # your Apple Developer team ID
BUNDLE=com.penumbra.astro

# Stash credentials in Secret Manager.
gcloud secrets create gee-key             --data-file=key.json    --project=$PROJECT_ID
gcloud secrets create penumbra-google-maps   --data-file=maps-key.txt --project=$PROJECT_ID

gcloud run deploy penumbra-backend \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars "GEE_SERVICE_ACCOUNT=$SVC_ACC,APPLE_TEAM_ID=$APPLE_TEAM,APPLE_BUNDLE_ID=$BUNDLE,APP_ATTEST_ENVIRONMENT=appattestdevelop,APP_ATTEST_ENFORCE=1,FIRESTORE_PROJECT_ID=$PROJECT_ID" \
  --set-secrets "GEE_KEY_JSON=gee-key:latest,GOOGLE_MAPS_API_KEY=penumbra-google-maps:latest" \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 10 \
  --max-instances 5
```

For App Store / TestFlight builds, switch
`APP_ATTEST_ENVIRONMENT=appattest` and make sure the iOS
entitlement matches.

## App Attest details

Verification is real. The pipeline:

1. **Server-issued challenges.** `/attest/challenge` mints a 32-byte
   single-use nonce, persisted in `attestChallenges/{hex}` with an
   `expires_at` field. The TTL is 5 minutes (`ATTEST_CHALLENGE_TTL`).
   When `FIRESTORE_PROJECT_ID` is set, enable a TTL policy on the
   collection's `expires_at` field so Firestore garbage-collects
   spent challenges automatically.
2. **Attestation.** `/attest/register` consumes the challenge in a
   transaction (single-use enforced even under concurrent registers),
   then verifies the attestation against Apple's App Attestation
   Root CA — cert chain, nonce binding, rpIdHash =
   SHA256(`APPLE_TEAM_ID.APPLE_BUNDLE_ID`), counter = 0, aaguid
   matching the configured environment, and credentialId = keyId.
   The leaf cert's public key is stored in
   `attestKeys/{key_id}` with `sign_count = 0`.
3. **Per-request assertions.** Both gated endpoints depend on the
   `verify_assertion` helper. It loads the stored public key,
   checks ECDSA-P256 over SHA256(authData ‖ clientDataHash), and
   then atomically does compare-and-set on `sign_count` —
   `update_sign_count_if_greater` only commits when the new counter
   is strictly greater than the stored one, rejecting replays even
   under concurrent traffic from the same device.

### Required env

| Var | Required? | Notes |
|---|---|---|
| `APP_ATTEST_ENFORCE` | yes | `1` in production. `0` for dev / simulator. |
| `APP_ATTEST_ENVIRONMENT` | yes | `appattestdevelop` for Xcode-signed dev builds, `appattest` for App Store / TestFlight. Must match the iOS entitlement. |
| `APPLE_TEAM_ID` | yes | Your Apple Developer team ID (10 chars). |
| `APPLE_BUNDLE_ID` | yes | Defaults to `com.penumbra.astro`. |
| `FIRESTORE_PROJECT_ID` | recommended | Without it the registration store and challenge store both fall back to in-memory dicts. Fine for one Cloud Run instance with `--max-instances 1`, broken otherwise. |
| `ATTEST_CHALLENGE_TTL` | optional | Seconds; default 300. |

Take the resulting `https://...run.app` URL and paste it into the
iOS app's Settings sheet (the gear icon in the top-right). It's
stored in the device Keychain; see `ios/Penumbra/Networking/SecretsStore.swift`.

## Notes

- `--allow-unauthenticated` is the simplest setup. If the URL gets
  abused, switch to `--no-allow-unauthenticated` and add a Firebase
  ID-token check in `main.py`, or front it with API Gateway.
- The default `scale_m=1` matches Meta CHM's native resolution. Bumping
  to 5 or 10 m is faster and cheaper if 1 m precision isn't useful.
- Cold starts ~3-5 s while `ee.Initialize` happens. Keeping
  `--min-instances 0` is fine for personal use.
