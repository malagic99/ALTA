# Marko backend

FastAPI service that the iOS app calls for every operation that
requires a credentialed upstream:

- `POST /canopy/sample` — Meta canopy height samples via Google
  Earth Engine.
- `POST /elevation/sample` — proxies the Google Maps Elevation API
  so the app never has to embed Google's key.
- `POST /attest/register` — App Attest registration.
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

POST /attest/register
{
  "key_id": "<base64url>",
  "attestation": "<base64url CBOR>",
  "challenge": "<base64url>"
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
BUNDLE=com.marko.astro

# Stash credentials in Secret Manager.
gcloud secrets create gee-key             --data-file=key.json    --project=$PROJECT_ID
gcloud secrets create marko-google-maps   --data-file=maps-key.txt --project=$PROJECT_ID

gcloud run deploy marko-backend \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars "GEE_SERVICE_ACCOUNT=$SVC_ACC,APPLE_TEAM_ID=$APPLE_TEAM,APPLE_BUNDLE_ID=$BUNDLE,APP_ATTEST_ENVIRONMENT=appattestdevelop,APP_ATTEST_ENFORCE=0" \
  --set-secrets "GEE_KEY_JSON=gee-key:latest,GOOGLE_MAPS_API_KEY=marko-google-maps:latest" \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 10 \
  --max-instances 5
```

When you finish the App Attest verification stub in `attest.py`,
flip `APP_ATTEST_ENFORCE=1` and `APP_ATTEST_ENVIRONMENT=appattest`
on the production deploy.

Take the resulting `https://...run.app` URL and put it in the app:

```
EXPO_PUBLIC_CANOPY_BACKEND_URL=https://marko-canopy-xxxx-uc.a.run.app
```

## Notes

- `--allow-unauthenticated` is the simplest setup. If the URL gets
  abused, switch to `--no-allow-unauthenticated` and add a Firebase
  ID-token check in `main.py`, or front it with API Gateway.
- The default `scale_m=1` matches Meta CHM's native resolution. Bumping
  to 5 or 10 m is faster and cheaper if 1 m precision isn't useful.
- Cold starts ~3-5 s while `ee.Initialize` happens. Keeping
  `--min-instances 0` is fine for personal use.
