# Canopy backend

Tiny FastAPI service that samples canopy heights from a Google Earth
Engine raster (default: Meta CHM) and returns them as a flat list. The
mobile app calls this whenever the user runs **Calculate horizon** with
the canopy layer enabled.

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

Smoke-test:

```bash
curl -s localhost:8080/canopy/sample \
  -H 'Content-Type: application/json' \
  -d '{"points":[{"lat":40.0,"lng":-105.0},{"lat":0,"lng":0}]}' | jq
```

## Deploy to Cloud Run

```bash
PROJECT_ID=your-proj
REGION=us-central1
SVC_ACC='svc@your-proj.iam.gserviceaccount.com'

# Stash the key in Secret Manager so it doesn't sit on disk.
gcloud secrets create gee-key --data-file=key.json --project=$PROJECT_ID

gcloud run deploy marko-canopy \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars "GEE_SERVICE_ACCOUNT=$SVC_ACC" \
  --set-secrets "GEE_KEY_JSON=gee-key:latest" \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 10 \
  --max-instances 5
```

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
