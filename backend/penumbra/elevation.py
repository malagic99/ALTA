"""
Google Maps Elevation API proxy.

The iOS app calls this endpoint instead of Google directly so that
Google's API key never has to ship in the app binary. The key lives
in Cloud Run's environment (sourced from Secret Manager); requests
are gated by the App Attest middleware in attest.py.

We mirror the iOS ElevationService's batching logic on this side as
well — Google caps a single GET at 512 locations, so we chunk and
re-stitch to preserve input order. In practice the app already sends
≤505 locations, so this almost always boils down to one upstream
request per call.
"""
from __future__ import annotations

import os
from typing import Iterable, List

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from attest import verify_assertion

GOOGLE_ELEVATION_URL = "https://maps.googleapis.com/maps/api/elevation/json"
MAX_POINTS_PER_UPSTREAM = 512

GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")


class ElevationPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class ElevationRequest(BaseModel):
    points: List[ElevationPoint]


class ElevationResponse(BaseModel):
    elevations_m: List[float]


router = APIRouter()


@router.post("/elevation/sample", response_model=ElevationResponse)
async def sample_elevations(
    req: ElevationRequest,
    _attest: dict = Depends(verify_assertion),
) -> ElevationResponse:
    if not GOOGLE_MAPS_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server is missing GOOGLE_MAPS_API_KEY. Set it via Secret Manager.",
        )
    if not req.points:
        return ElevationResponse(elevations_m=[])

    out: List[float] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for chunk in _chunks(req.points, MAX_POINTS_PER_UPSTREAM):
            elevations = await _fetch_chunk(client, chunk)
            if len(elevations) != len(chunk):
                raise HTTPException(
                    status_code=502,
                    detail=(
                        f"Elevation upstream returned {len(elevations)} of "
                        f"{len(chunk)} requested points."
                    ),
                )
            out.extend(elevations)
    return ElevationResponse(elevations_m=out)


def _chunks(seq: List[ElevationPoint], n: int) -> Iterable[List[ElevationPoint]]:
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


async def _fetch_chunk(
    client: httpx.AsyncClient,
    chunk: List[ElevationPoint],
) -> List[float]:
    locations = "|".join(f"{p.lat},{p.lng}" for p in chunk)
    params = {"locations": locations, "key": GOOGLE_MAPS_API_KEY}

    resp = await client.get(GOOGLE_ELEVATION_URL, params=params)
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Elevation upstream HTTP {resp.status_code}: {resp.text[:512]}",
        )

    data = resp.json()
    status = data.get("status", "UNKNOWN")
    if status != "OK":
        # Google's 200-OK-with-status-field convention. Reflect the
        # upstream's own error string so the iOS UI can surface it.
        msg = data.get("error_message", "")
        raise HTTPException(
            status_code=502,
            detail=f"Elevation upstream status {status}: {msg}",
        )

    return [float(r["elevation"]) for r in data.get("results", [])]
