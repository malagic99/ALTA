"""
Apple App Attest router.

Three surfaces:

  POST /attest/challenge
        Server-issued single-use nonce for registration. Lives for
        ATTEST_CHALLENGE_TTL seconds (default 300). Persisted in the
        challenge store (Firestore in production, in-memory in dev).

  POST /attest/register
        Receives {key_id, attestation, challenge}. When
        APP_ATTEST_ENFORCE=1 it:
          1. Consumes the challenge (single-use within TTL).
          2. Runs the real Apple cert-chain + nonce + rpIdHash +
             counter + aaguid + credentialId checks via
             `appattest_crypto.verify_attestation`.
          3. Persists the device's public key in the key store.
        When ENFORCE=0 it just remembers the key id, so the rest of
        the plumbing can be exercised against a simulator.

  Dependency `verify_assertion` (used by /elevation/sample and
  /canopy/sample). When ENFORCE=1 it:
          1. Loads the device's public key.
          2. Runs `appattest_crypto.verify_assertion` (ECDSA-P256
             over SHA256(authData || clientDataHash) + rpIdHash check).
          3. Atomically bumps the counter via the store's
             compare-and-set, rejecting replays.
"""
from __future__ import annotations

import base64
import os
import time
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from appattest_crypto import (
    AAGUID_DEVELOPMENT,
    AAGUID_PRODUCTION,
    AttestVerificationError,
    verify_assertion as crypto_verify_assertion,
    verify_attestation as crypto_verify_attestation,
)
from attest_store import (
    AttestedKey,
    make_challenge_store,
    make_key_store,
)

# --- configuration ----------------------------------------------------

APPLE_TEAM_ID = os.environ.get("APPLE_TEAM_ID", "")
APPLE_BUNDLE_ID = os.environ.get("APPLE_BUNDLE_ID", "com.penumbra.astro")
APP_ATTEST_ENVIRONMENT = os.environ.get(
    "APP_ATTEST_ENVIRONMENT", "appattestdevelop"
)
APP_ATTEST_ENFORCE = os.environ.get("APP_ATTEST_ENFORCE", "0") == "1"

_KEY_STORE = make_key_store()
_CHALLENGE_STORE = make_challenge_store()


def _expected_aaguid() -> bytes:
    return (
        AAGUID_PRODUCTION
        if APP_ATTEST_ENVIRONMENT == "appattest"
        else AAGUID_DEVELOPMENT
    )


# --- HTTP models ------------------------------------------------------

class ChallengeResponse(BaseModel):
    challenge: str = Field(..., description="Base64url challenge to attest.")
    expires_at: float = Field(..., description="Unix seconds when the challenge stops being valid.")


class RegisterRequest(BaseModel):
    key_id: str = Field(..., description="Base64url DCAppAttestService key ID")
    attestation: str = Field(..., description="Base64url attestation object (CBOR)")
    challenge: str = Field(..., description="Base64url challenge from /attest/challenge")


class RegisterResponse(BaseModel):
    ok: bool


router = APIRouter()


# --- challenge --------------------------------------------------------

@router.post("/attest/challenge", response_model=ChallengeResponse)
async def issue_challenge() -> ChallengeResponse:
    """Mint a single-use challenge for the next registration call."""
    challenge, expires_at = _CHALLENGE_STORE.issue()
    return ChallengeResponse(
        challenge=_b64url_encode(challenge),
        expires_at=expires_at,
    )


# --- registration -----------------------------------------------------

@router.post("/attest/register", response_model=RegisterResponse)
async def register(req: RegisterRequest) -> RegisterResponse:
    if not APP_ATTEST_ENFORCE:
        # Dev path: trust the client and just remember the key id so
        # subsequent assertion requests can find it.
        _KEY_STORE.put(AttestedKey(
            key_id=req.key_id,
            public_key_pem="DEV_MODE_NOT_VERIFIED",
            sign_count=0,
            registered_at=time.time(),
        ))
        return RegisterResponse(ok=True)

    if not APPLE_TEAM_ID:
        raise HTTPException(500, "Server is missing APPLE_TEAM_ID.")

    try:
        challenge_bytes = _b64url_decode(req.challenge)
        key_id_bytes = _b64url_decode(req.key_id)
        attestation_bytes = _b64url_decode(req.attestation)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(400, "Malformed base64url input.") from exc

    # 1. Burn the server-issued challenge before doing any expensive
    #    crypto, so a hostile caller can't loop on attestations.
    if not _CHALLENGE_STORE.consume(challenge_bytes):
        raise HTTPException(401, "Challenge invalid, expired, or already used.")

    # 2. Real Apple verification.
    try:
        result = crypto_verify_attestation(
            key_id=key_id_bytes,
            attestation=attestation_bytes,
            challenge=challenge_bytes,
            team_id=APPLE_TEAM_ID,
            bundle_id=APPLE_BUNDLE_ID,
            expected_aaguid=_expected_aaguid(),
        )
    except AttestVerificationError as exc:
        raise HTTPException(401, f"Attestation rejected: {exc}") from exc

    # 3. Persist.
    _KEY_STORE.put(AttestedKey(
        key_id=req.key_id,
        public_key_pem=result.public_key_pem,
        sign_count=result.sign_count,
        registered_at=time.time(),
    ))
    return RegisterResponse(ok=True)


# --- per-request assertion verification --------------------------------

async def verify_assertion(
    x_attest_key_id: Optional[str] = Header(default=None),
    x_attest_assertion: Optional[str] = Header(default=None),
    x_attest_challenge: Optional[str] = Header(default=None),
) -> dict:
    """FastAPI dependency. Locked behind a registered, attested device
    when APP_ATTEST_ENFORCE=1; relaxed enough to be testable from a
    simulator when ENFORCE=0."""
    if not APP_ATTEST_ENFORCE:
        if not x_attest_key_id:
            raise HTTPException(401, "Missing X-Attest-Key-Id header.")
        return {"key_id": x_attest_key_id, "verified": False}

    if not (x_attest_key_id and x_attest_assertion and x_attest_challenge):
        raise HTTPException(
            401, "App Attest headers required (key id, assertion, challenge)."
        )

    record = _KEY_STORE.get(x_attest_key_id)
    if record is None:
        raise HTTPException(401, "Unknown attest key id; register the device first.")

    try:
        assertion_bytes = _b64url_decode(x_attest_assertion)
        challenge_bytes = _b64url_decode(x_attest_challenge)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(400, "Malformed base64url input.") from exc

    try:
        result = crypto_verify_assertion(
            public_key_pem=record.public_key_pem,
            assertion=assertion_bytes,
            challenge=challenge_bytes,
            team_id=APPLE_TEAM_ID,
            bundle_id=APPLE_BUNDLE_ID,
        )
    except AttestVerificationError as exc:
        raise HTTPException(401, f"Assertion rejected: {exc}") from exc

    # 4. Replay protection: only commit when the new counter strictly
    #    exceeds the stored one, atomically (Firestore transaction in
    #    production, lock in memory). The crypto can pass without the
    #    counter being fresh — that's the point of this check.
    if not _KEY_STORE.update_sign_count_if_greater(
        x_attest_key_id, result.sign_count
    ):
        raise HTTPException(401, "Assertion replay detected (counter not strictly greater).")

    return {"key_id": x_attest_key_id, "verified": True}


# --- helpers ----------------------------------------------------------

def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")
