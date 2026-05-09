"""
Canopy-height proxy service.

Exposes a minimal HTTP API that samples per-point canopy heights from a
Google Earth Engine raster (Meta Canopy Height Map by default) and
returns them to the mobile app. Doing this server-side lets the app
avoid embedding a GEE service-account key on-device.

Deploy target: Google Cloud Run. See ./README.md for the deploy steps.
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import List

import ee
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from attest import router as attest_router, verify_assertion
from elevation import router as elevation_router

# --- configuration -----------------------------------------------------

DEFAULT_ASSET = os.environ.get(
    "CHM_ASSET",
    "projects/sat-io/open-datasets/facebook/meta-canopy-height",
)
DEFAULT_BAND = os.environ.get("CHM_BAND", "b1")
DEFAULT_SCALE_M = int(os.environ.get("CHM_SCALE_M", "1"))
MAX_POINTS_PER_REQUEST = int(os.environ.get("MAX_POINTS_PER_REQUEST", "1024"))

GEE_SERVICE_ACCOUNT = os.environ.get("GEE_SERVICE_ACCOUNT", "")
GEE_KEY_FILE = os.environ.get("GEE_KEY_FILE", "")  # path to JSON
GEE_KEY_JSON = os.environ.get("GEE_KEY_JSON", "")  # raw JSON string


# --- Earth Engine init -------------------------------------------------

@lru_cache(maxsize=1)
def initialize_ee() -> None:
    """Authenticate to Earth Engine using a service-account key.

    Cached so a warm Cloud Run instance only initializes once.
    """
    if not GEE_SERVICE_ACCOUNT:
        raise RuntimeError("GEE_SERVICE_ACCOUNT env var must be set")

    if GEE_KEY_JSON:
        # Inline JSON works well with Secret Manager mounted as env var.
        creds = ee.ServiceAccountCredentials(
            email=GEE_SERVICE_ACCOUNT,
            key_data=GEE_KEY_JSON,
        )
    elif GEE_KEY_FILE and os.path.exists(GEE_KEY_FILE):
        creds = ee.ServiceAccountCredentials(
            email=GEE_SERVICE_ACCOUNT,
            key_file=GEE_KEY_FILE,
        )
    else:
        raise RuntimeError(
            "Provide either GEE_KEY_JSON or GEE_KEY_FILE for service-account auth"
        )
    ee.Initialize(credentials=creds)


# --- API ---------------------------------------------------------------

class Point(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class SampleRequest(BaseModel):
    points: List[Point]
    asset: str | None = None
    band: str | None = None
    scale_m: int | None = None


class SampleResponse(BaseModel):
    heights_m: List[float]
    asset: str
    band: str
    scale_m: int


app = FastAPI(title="Marko Backend", version="0.2.0")
app.include_router(attest_router)
app.include_router(elevation_router)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "default_asset": DEFAULT_ASSET}


@app.post("/canopy/sample", response_model=SampleResponse)
def sample(
    req: SampleRequest,
    _attest: dict = Depends(verify_assertion),
) -> SampleResponse:
    if not req.points:
        return SampleResponse(
            heights_m=[],
            asset=req.asset or DEFAULT_ASSET,
            band=req.band or DEFAULT_BAND,
            scale_m=req.scale_m or DEFAULT_SCALE_M,
        )
    if len(req.points) > MAX_POINTS_PER_REQUEST:
        raise HTTPException(
            status_code=413,
            detail=f"Too many points: {len(req.points)} > {MAX_POINTS_PER_REQUEST}",
        )

    initialize_ee()

    asset = req.asset or DEFAULT_ASSET
    band = req.band or DEFAULT_BAND
    scale_m = req.scale_m or DEFAULT_SCALE_M

    img = ee.Image(asset).select(band)

    # Build a FeatureCollection with stable ordering.
    features = [
        ee.Feature(
            ee.Geometry.Point([p.lng, p.lat]),
            {"_i": i},
        )
        for i, p in enumerate(req.points)
    ]
    fc = ee.FeatureCollection(features)

    sampled = img.sampleRegions(
        collection=fc,
        scale=scale_m,
        geometries=False,
    )

    try:
        info = sampled.getInfo()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"Earth Engine error: {exc}") from exc

    # Collect into the original input order. Missing samples (over water,
    # outside coverage) come back as None → 0 m canopy.
    heights = [0.0] * len(req.points)
    for feat in info.get("features", []):
        props = feat.get("properties", {})
        idx = int(props.get("_i", -1))
        val = props.get(band)
        if 0 <= idx < len(heights) and val is not None:
            heights[idx] = float(val)

    return SampleResponse(
        heights_m=heights,
        asset=asset,
        band=band,
        scale_m=scale_m,
    )


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
