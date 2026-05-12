"""
Persistence for App Attest state.

Two stores live behind a tiny interface:

  AttestKeyStore    — registered devices: keyId → {public_key, counter}.
  ChallengeStore    — short-lived random challenges issued by
                       /attest/challenge and consumed by /attest/register,
                       single-use within their TTL.

Each has an in-memory implementation (fine for one Cloud Run instance
during development) and a Firestore implementation (the production
path; instances come and go but state survives).

The Firestore impl uses transactions for both stores so concurrent
requests can't race past each other:

  • update_sign_count_if_greater  — replay protection for assertions.
    Only writes when the new counter strictly exceeds the stored one.
  • consume_challenge             — single-use enforcement. Reads,
    checks `used`, sets `used=True`, all in one transaction.
"""
from __future__ import annotations

import os
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Optional, Protocol

FIRESTORE_PROJECT_ID = os.environ.get("FIRESTORE_PROJECT_ID", "")
CHALLENGE_TTL_SECONDS = int(os.environ.get("ATTEST_CHALLENGE_TTL", "300"))


@dataclass
class AttestedKey:
    key_id: str
    public_key_pem: str
    sign_count: int
    registered_at: float


# --- key store --------------------------------------------------------

class AttestKeyStore(Protocol):
    def get(self, key_id: str) -> Optional[AttestedKey]: ...
    def put(self, record: AttestedKey) -> None: ...
    def update_sign_count_if_greater(self, key_id: str, new_count: int) -> bool:
        """Atomic compare-and-set. Returns True only when `new_count` was
        strictly greater than the stored counter and the update happened."""
        ...


class _InMemoryAttestKeyStore:
    """Single-instance development store. Cloud Run scales to zero and
    cycles instances, so anything that needs to outlive a single replica
    should use the Firestore impl below."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: dict[str, AttestedKey] = {}

    def get(self, key_id: str) -> Optional[AttestedKey]:
        with self._lock:
            return self._records.get(key_id)

    def put(self, record: AttestedKey) -> None:
        with self._lock:
            self._records[record.key_id] = record

    def update_sign_count_if_greater(self, key_id: str, new_count: int) -> bool:
        with self._lock:
            rec = self._records.get(key_id)
            if rec is None or new_count <= rec.sign_count:
                return False
            rec.sign_count = new_count
            return True


class _FirestoreAttestKeyStore:
    COLLECTION = "attestKeys"

    def __init__(self, project_id: str) -> None:
        from google.cloud import firestore  # noqa: F401
        from google.cloud.firestore import Client
        self._client = Client(project=project_id)

    def _doc(self, key_id: str):
        return self._client.collection(self.COLLECTION).document(key_id)

    def get(self, key_id: str) -> Optional[AttestedKey]:
        snap = self._doc(key_id).get()
        if not snap.exists:
            return None
        d = snap.to_dict() or {}
        return AttestedKey(
            key_id=key_id,
            public_key_pem=d.get("public_key_pem", ""),
            sign_count=int(d.get("sign_count", 0)),
            registered_at=float(d.get("registered_at", 0)),
        )

    def put(self, record: AttestedKey) -> None:
        self._doc(record.key_id).set({
            "public_key_pem": record.public_key_pem,
            "sign_count": record.sign_count,
            "registered_at": record.registered_at,
        })

    def update_sign_count_if_greater(self, key_id: str, new_count: int) -> bool:
        from google.cloud import firestore as fs
        doc_ref = self._doc(key_id)
        transaction = self._client.transaction()

        @fs.transactional
        def _tx(tx):
            snap = doc_ref.get(transaction=tx)
            if not snap.exists:
                return False
            current = int((snap.to_dict() or {}).get("sign_count", 0))
            if new_count <= current:
                return False
            tx.update(doc_ref, {"sign_count": new_count})
            return True

        return bool(_tx(transaction))


def make_key_store() -> AttestKeyStore:
    if FIRESTORE_PROJECT_ID:
        return _FirestoreAttestKeyStore(FIRESTORE_PROJECT_ID)
    return _InMemoryAttestKeyStore()


# --- challenge store --------------------------------------------------

class ChallengeStore(Protocol):
    def issue(self) -> tuple[bytes, float]:
        """Mint a fresh random challenge. Returns (challenge_bytes,
        expires_at_unix_seconds)."""
        ...

    def consume(self, challenge: bytes) -> bool:
        """Single-use: returns True only the first time this exact
        challenge is presented within its TTL."""
        ...


class _InMemoryChallengeStore:
    def __init__(self, ttl: int) -> None:
        self._lock = threading.Lock()
        self._records: dict[str, tuple[float, bool]] = {}
        self._ttl = ttl

    def issue(self) -> tuple[bytes, float]:
        challenge = secrets.token_bytes(32)
        expires_at = time.time() + self._ttl
        with self._lock:
            self._records[challenge.hex()] = (expires_at, False)
            self._gc_locked()
        return challenge, expires_at

    def consume(self, challenge: bytes) -> bool:
        key = challenge.hex()
        now = time.time()
        with self._lock:
            entry = self._records.get(key)
            if entry is None:
                return False
            expires_at, used = entry
            if used or expires_at < now:
                return False
            self._records[key] = (expires_at, True)
            return True

    def _gc_locked(self) -> None:
        """Cheap eviction so the dict doesn't grow forever in tests."""
        now = time.time()
        dead = [k for k, (exp, _) in self._records.items() if exp < now - 60]
        for k in dead:
            self._records.pop(k, None)


class _FirestoreChallengeStore:
    COLLECTION = "attestChallenges"

    def __init__(self, project_id: str, ttl: int) -> None:
        from google.cloud import firestore  # noqa: F401
        from google.cloud.firestore import Client
        self._client = Client(project=project_id)
        self._ttl = ttl

    def _doc(self, key: str):
        return self._client.collection(self.COLLECTION).document(key)

    def issue(self) -> tuple[bytes, float]:
        challenge = secrets.token_bytes(32)
        expires_at = time.time() + self._ttl
        # Firestore TTL policy (if enabled on this collection) will GC
        # the document automatically once `expires_at` passes.
        self._doc(challenge.hex()).set({
            "expires_at": expires_at,
            "used": False,
        })
        return challenge, expires_at

    def consume(self, challenge: bytes) -> bool:
        from google.cloud import firestore as fs
        doc_ref = self._doc(challenge.hex())
        transaction = self._client.transaction()
        now = time.time()

        @fs.transactional
        def _tx(tx):
            snap = doc_ref.get(transaction=tx)
            if not snap.exists:
                return False
            d = snap.to_dict() or {}
            if d.get("used"):
                return False
            if float(d.get("expires_at", 0)) < now:
                return False
            tx.update(doc_ref, {"used": True})
            return True

        return bool(_tx(transaction))


def make_challenge_store() -> ChallengeStore:
    if FIRESTORE_PROJECT_ID:
        return _FirestoreChallengeStore(FIRESTORE_PROJECT_ID, CHALLENGE_TTL_SECONDS)
    return _InMemoryChallengeStore(CHALLENGE_TTL_SECONDS)
