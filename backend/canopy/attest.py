"""
Apple App Attest verification.

Two endpoints make up the App Attest dance:

  POST /attest/register
      App generates a key with DCAppAttestService.generateKey, then
      attests it. We receive {key_id, attestation, challenge} and:
        1. Verify the attestation CBOR's certificate chain against
           Apple's App Attest root CA.
        2. Confirm the nonce extension equals SHA256(authData ‖
           SHA256(challenge ‖ teamID.bundleID)).
        3. Persist {key_id → public_key, sign_count} so future
           assertions can be checked.

  Every gated endpoint (POST /elevation/sample, /canopy/sample, …)
      Requires X-Attest-Key-Id, X-Attest-Assertion, X-Attest-Challenge
      headers. We:
        1. Look up the registered public key.
        2. Verify the assertion's ECDSA-P256 signature over
           SHA256(authData ‖ clientDataHash) using that public key.
        3. Confirm the embedded sign_count is strictly greater than
           the stored one and bump it.

This file ships the surface and the per-request verification glue.
The cryptographic core (cert-chain validation, ECDSA verify) is left
as a clearly-marked stub — implementing it correctly takes a couple
hundred lines using `cryptography` plus careful CBOR parsing, and
the code is meaningless without a real Apple Developer team ID and
App Attest environment, neither of which I can supply from a
sandbox. The TODOs spell out exactly what to fill in.
"""
from __future__ import annotations

import base64
import hashlib
import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

# --- configuration -----------------------------------------------------

APPLE_TEAM_ID = os.environ.get("APPLE_TEAM_ID", "")
APPLE_BUNDLE_ID = os.environ.get("APPLE_BUNDLE_ID", "com.marko.astro")
APP_ATTEST_ENV = os.environ.get(
    "APP_ATTEST_ENVIRONMENT", "appattestdevelop"
)  # or "appattest" for production

# Toggle off in dev / when running against a simulator. Production
# deploys MUST set this to "1".
APP_ATTEST_ENFORCE = os.environ.get("APP_ATTEST_ENFORCE", "0") == "1"


# --- in-memory registration store -------------------------------------
# Cloud Run instances are ephemeral, so persist registrations to
# Firestore / Cloud SQL / Memorystore in production. The interface
# below is intentionally tiny so swapping the backing store is one
# class change.

@dataclass
class AttestedKey:
    key_id: str
    public_key_pem: str
    sign_count: int
    registered_at: float


class _InMemoryAttestStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: Dict[str, AttestedKey] = {}

    def get(self, key_id: str) -> Optional[AttestedKey]:
        with self._lock:
            return self._records.get(key_id)

    def put(self, record: AttestedKey) -> None:
        with self._lock:
            self._records[record.key_id] = record

    def update_sign_count(self, key_id: str, new_count: int) -> None:
        with self._lock:
            rec = self._records.get(key_id)
            if rec is not None:
                rec.sign_count = new_count


_store = _InMemoryAttestStore()


# --- registration API -------------------------------------------------

class RegisterRequest(BaseModel):
    key_id: str = Field(..., description="Base64url DCAppAttestService key ID")
    attestation: str = Field(..., description="Base64url attestation object (CBOR)")
    challenge: str = Field(..., description="Base64url challenge that was attested")


class RegisterResponse(BaseModel):
    ok: bool


router = APIRouter()


@router.post("/attest/register", response_model=RegisterResponse)
async def register(req: RegisterRequest) -> RegisterResponse:
    if not APP_ATTEST_ENFORCE:
        # Dev mode: trust the client and just remember the key id.
        _store.put(
            AttestedKey(
                key_id=req.key_id,
                public_key_pem="DEV_MODE_NOT_VERIFIED",
                sign_count=0,
                registered_at=time.time(),
            )
        )
        return RegisterResponse(ok=True)

    # TODO(#attest-prod): full attestation verification.
    #
    # 1. base64url-decode `attestation` → CBOR-decode → an object with
    #    keys "fmt" ("apple-appattest"), "attStmt" ({"x5c": [...],
    #    "receipt": ...}), and "authData" (bytes).
    # 2. Validate the certificate chain in attStmt.x5c terminates at
    #    Apple's App Attest root
    #    (https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem).
    # 3. Compute clientDataHash = SHA256(challenge_bytes).
    # 4. Compute expected_nonce = SHA256(authData ‖ clientDataHash) and
    #    compare against the OID 1.2.840.113635.100.8.2 extension on
    #    the leaf cert.
    # 5. From authData parse: rpIdHash (must equal SHA256(teamId+"." +
    #    bundleId)), counter (must be 0 on first registration), aaguid
    #    (must be "appattestdevelop\0"*16 or "appattest\0\0\0\0\0\0\0"
    #    depending on environment), credentialId (must equal key_id),
    #    credentialPublicKey (CBOR-encoded EC2 public key).
    # 6. Persist {key_id, public_key, sign_count=0}.
    #
    # The `cryptography` package and the CBOR parser in
    # `cbor2` cover all of the above. See Apple's "Validating Apps That
    # Connect to Your Server" doc for the full step list.
    raise HTTPException(
        status_code=501,
        detail=(
            "Production App Attest verification is not implemented. "
            "Set APP_ATTEST_ENFORCE=0 to use the dev-mode path, or fill "
            "in the verification stub in attest.py."
        ),
    )


# --- per-request assertion verification --------------------------------

async def verify_assertion(
    x_attest_key_id: Optional[str] = Header(default=None),
    x_attest_assertion: Optional[str] = Header(default=None),
    x_attest_challenge: Optional[str] = Header(default=None),
) -> dict:
    """FastAPI dependency. Wire it into any endpoint that should be
    locked behind a registered, attested device."""
    if not APP_ATTEST_ENFORCE:
        # Dev mode: still require the headers exist so clients are
        # building the right plumbing, but skip cryptographic checks.
        if not x_attest_key_id:
            raise HTTPException(
                status_code=401,
                detail="Missing X-Attest-Key-Id header.",
            )
        return {"key_id": x_attest_key_id, "verified": False}

    if not (x_attest_key_id and x_attest_assertion and x_attest_challenge):
        raise HTTPException(
            status_code=401,
            detail="App Attest headers required (key id, assertion, challenge).",
        )

    record = _store.get(x_attest_key_id)
    if record is None:
        raise HTTPException(
            status_code=401,
            detail="Unknown attest key id; register the device first.",
        )

    # TODO(#attest-prod): assertion verification.
    #
    # 1. base64url-decode assertion → CBOR with {"signature": bytes,
    #    "authenticatorData": bytes}.
    # 2. clientDataHash = SHA256(base64url-decode(x_attest_challenge)).
    # 3. signedData = authenticatorData ‖ clientDataHash.
    # 4. Verify signature is a valid ECDSA-P256 signature over
    #    SHA256(signedData) using record.public_key_pem.
    # 5. Parse counter from authenticatorData; require new_count >
    #    record.sign_count; update.
    raise HTTPException(
        status_code=501,
        detail=(
            "Production App Attest verification is not implemented. "
            "See the TODO in attest.py."
        ),
    )


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)
