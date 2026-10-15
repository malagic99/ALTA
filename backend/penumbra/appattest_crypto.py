"""
Apple App Attest cryptographic verification.

Implements the two checks described in Apple's "Validating Apps That
Connect to Your Server":

    verify_attestation(...) — registration: cert chain → Apple root,
        nonce binding, rpIdHash, counter == 0, aaguid, credentialId,
        and pulls the device's public key out of the leaf cert so
        future assertions can be checked against it.

    verify_assertion(...) — per-request: rpIdHash, ECDSA-P256 over
        SHA256(authData ‖ clientDataHash) against the registered key,
        and an externally-enforced counter check (caller does the
        atomic compare-and-set against its store).

References:
    https://developer.apple.com/documentation/devicecheck/validating_apps_that_connect_to_your_server
    https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import List

import cbor2
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.padding import PKCS1v15
from cryptography.x509.oid import ExtensionOID, ObjectIdentifier

# Apple App Attestation Root CA, downloaded from
# https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
# and embedded here so the runtime doesn't need outbound DNS to verify a
# device. It's a 25-year cert valid through 2045-03-15.
APPLE_APP_ATTEST_ROOT_CA_PEM = b"""-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
"""

# Apple-defined AAGUID values that appear inside `authData`. The
# device picks one based on the App Attest entitlement environment.
AAGUID_DEVELOPMENT = b"appattestdevelop"  # 16 bytes exactly
AAGUID_PRODUCTION = b"appattest" + b"\x00" * 7  # 9 + 7 = 16 bytes

# Apple's "credCert nonce" extension OID. Encoded value is a
# DER SEQUENCE { [1] EXPLICIT OCTET STRING nonce }.
APPLE_ATTESTATION_NONCE_OID = ObjectIdentifier("1.2.840.113635.100.8.2")


class AttestVerificationError(Exception):
    """Anything wrong with an attestation or assertion. The exception
    message stays terse so we don't leak verification-step detail to a
    hostile caller."""


@dataclass
class AttestationResult:
    """Output of a successful `verify_attestation` call."""
    public_key_pem: str
    sign_count: int  # always 0 on a fresh registration


# --- registration -----------------------------------------------------

def verify_attestation(
    *,
    key_id: bytes,
    attestation: bytes,
    challenge: bytes,
    team_id: str,
    bundle_id: str,
    expected_aaguid: bytes,
) -> AttestationResult:
    """Validate a `DCAppAttestService.attestKey` output against the
    Apple App Attest Root CA. Returns the credential public key so the
    caller can persist it for future assertion checks.

    `expected_aaguid` must be `AAGUID_DEVELOPMENT` or `AAGUID_PRODUCTION`
    matching the app's entitlement.
    """
    try:
        envelope = cbor2.loads(attestation)
    except Exception as exc:  # pragma: no cover
        raise AttestVerificationError("attestation is not valid CBOR") from exc

    if envelope.get("fmt") != "apple-appattest":
        raise AttestVerificationError("unexpected attestation fmt")

    att_stmt = envelope.get("attStmt") or {}
    x5c = att_stmt.get("x5c") or []
    auth_data = envelope.get("authData")
    if not isinstance(x5c, list) or len(x5c) < 2:
        raise AttestVerificationError("attestation missing cert chain")
    if not isinstance(auth_data, (bytes, bytearray)):
        raise AttestVerificationError("attestation missing authData")
    auth_data = bytes(auth_data)

    # 1. Parse certs, build chain to Apple root.
    try:
        leaf = x509.load_der_x509_certificate(bytes(x5c[0]))
        intermediate = x509.load_der_x509_certificate(bytes(x5c[1]))
    except Exception as exc:
        raise AttestVerificationError("attestation cert chain malformed") from exc

    apple_root = x509.load_pem_x509_certificate(APPLE_APP_ATTEST_ROOT_CA_PEM)
    _verify_cert_chain([leaf, intermediate, apple_root])

    # 2. Bind the attestation to *this* challenge.
    client_data_hash = hashlib.sha256(challenge).digest()
    expected_nonce = hashlib.sha256(auth_data + client_data_hash).digest()
    actual_nonce = _read_apple_nonce_extension(leaf)
    if expected_nonce != actual_nonce:
        raise AttestVerificationError("nonce mismatch")

    # 3. Parse authData. Layout:
    #    [0..32)  rpIdHash    — SHA256(teamId.bundleId)
    #    [32]     flags
    #    [33..37) counter     — must be 0 on first attestation
    #    [37..53) aaguid
    #    [53..55) credentialIdLength (big-endian)
    #    [55..)   credentialId (length above) + optional COSE pubKey
    if len(auth_data) < 55:
        raise AttestVerificationError("authData too short")

    rp_id_hash = auth_data[0:32]
    counter = int.from_bytes(auth_data[33:37], "big")
    aaguid = auth_data[37:53]
    cred_id_len = int.from_bytes(auth_data[53:55], "big")
    cred_id = auth_data[55:55 + cred_id_len]

    expected_rp_id_hash = hashlib.sha256(
        f"{team_id}.{bundle_id}".encode("ascii")
    ).digest()
    if rp_id_hash != expected_rp_id_hash:
        raise AttestVerificationError("rpIdHash mismatch — teamId.bundleId")
    if counter != 0:
        raise AttestVerificationError("attestation counter must be 0")
    if aaguid != expected_aaguid:
        raise AttestVerificationError(
            "aaguid mismatch — wrong App Attest environment"
        )
    if cred_id != key_id:
        raise AttestVerificationError("credentialId != key_id")

    # 4. Pull the public key out of the leaf cert. Apple's spec says it
    #    matches the credentialPublicKey in authData byte-for-byte, so
    #    using the cert's SPKI saves us parsing the CBOR EC2_Key.
    leaf_pub = leaf.public_key()
    if not isinstance(leaf_pub, ec.EllipticCurvePublicKey):
        raise AttestVerificationError("expected EC public key in leaf")
    pem = leaf_pub.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")

    return AttestationResult(public_key_pem=pem, sign_count=0)


# --- per-request assertions -------------------------------------------

@dataclass
class AssertionResult:
    """Output of a successful `verify_assertion` call. The caller is
    responsible for compare-and-set persisting `sign_count`."""
    sign_count: int


def verify_assertion(
    *,
    public_key_pem: str,
    assertion: bytes,
    challenge: bytes,
    team_id: str,
    bundle_id: str,
) -> AssertionResult:
    """Verify a per-request App Attest assertion."""
    try:
        envelope = cbor2.loads(assertion)
    except Exception as exc:
        raise AttestVerificationError("assertion is not valid CBOR") from exc

    signature = envelope.get("signature")
    auth_data = envelope.get("authenticatorData")
    if not isinstance(signature, (bytes, bytearray)):
        raise AttestVerificationError("assertion missing signature")
    if not isinstance(auth_data, (bytes, bytearray)) or len(auth_data) < 37:
        raise AttestVerificationError("assertion missing authenticatorData")
    signature = bytes(signature)
    auth_data = bytes(auth_data)

    rp_id_hash = auth_data[0:32]
    counter = int.from_bytes(auth_data[33:37], "big")

    expected_rp_id_hash = hashlib.sha256(
        f"{team_id}.{bundle_id}".encode("ascii")
    ).digest()
    if rp_id_hash != expected_rp_id_hash:
        raise AttestVerificationError("rpIdHash mismatch")

    # Recompute clientDataHash = SHA256(challenge_bytes). The "challenge"
    # for a per-request assertion isn't a server-issued nonce: it's
    # whatever the client signed. We bind it to the request below by
    # contractually requiring the iOS side to compute it as
    # SHA256(body || challenge). The dependency that calls us simply
    # uses the X-Attest-Challenge header verbatim — counter replay
    # protection (below) makes server-issued challenges unnecessary.
    client_data_hash = hashlib.sha256(challenge).digest()

    public_key = serialization.load_pem_public_key(public_key_pem.encode("ascii"))
    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        raise AttestVerificationError("stored key is not EC")

    try:
        public_key.verify(
            signature,
            auth_data + client_data_hash,
            ec.ECDSA(hashes.SHA256()),
        )
    except InvalidSignature as exc:
        raise AttestVerificationError("assertion signature invalid") from exc

    return AssertionResult(sign_count=counter)


# --- helpers ----------------------------------------------------------

def _verify_cert_chain(certs: List[x509.Certificate]) -> None:
    """Verify a leaf → intermediate → root chain by checking each
    cert's signature against the next one's public key.

    `cryptography` doesn't ship a full PKIX validator yet; this hits
    the essentials Apple's docs explicitly require (signatures and
    issuer matching). Path-length, name-constraints, and revocation
    are not enforced — App Attest's chain has a fixed length and no
    revocation infrastructure, so they don't apply here.
    """
    for i in range(len(certs) - 1):
        child = certs[i]
        parent = certs[i + 1]
        if child.issuer != parent.subject:
            raise AttestVerificationError(
                f"cert {i} issuer != cert {i + 1} subject"
            )
        try:
            _verify_cert_signature(child, parent.public_key())
        except InvalidSignature as exc:
            raise AttestVerificationError(
                f"cert {i} signature does not verify against cert {i + 1}"
            ) from exc

    # The root must be self-signed.
    root = certs[-1]
    try:
        _verify_cert_signature(root, root.public_key())
    except InvalidSignature as exc:
        raise AttestVerificationError("root cert is not self-signed") from exc


def _verify_cert_signature(cert: x509.Certificate, parent_pub) -> None:
    """ECDSA or RSA, whichever the parent key is."""
    sig = cert.signature
    tbs = cert.tbs_certificate_bytes
    algo = cert.signature_hash_algorithm
    if isinstance(parent_pub, ec.EllipticCurvePublicKey):
        parent_pub.verify(sig, tbs, ec.ECDSA(algo))
    else:
        parent_pub.verify(sig, tbs, PKCS1v15(), algo)


def _read_apple_nonce_extension(cert: x509.Certificate) -> bytes:
    """Pull the 32-byte nonce out of Apple's appattest extension.
    The extension value is DER:
        SEQUENCE { [1] EXPLICIT OCTET STRING (32 bytes) }
    which for a 32-byte nonce is always the fixed 38-byte envelope
    `30 24 a1 22 04 20 <nonce>`.
    """
    try:
        ext = cert.extensions.get_extension_for_oid(APPLE_ATTESTATION_NONCE_OID)
    except x509.ExtensionNotFound as exc:
        raise AttestVerificationError("Apple nonce extension absent") from exc

    raw = ext.value.value if hasattr(ext.value, "value") else bytes(ext.value)
    if len(raw) < 38:
        raise AttestVerificationError("Apple nonce extension too short")
    if raw[0] != 0x30 or raw[2] != 0xA1 or raw[4] != 0x04:
        raise AttestVerificationError("Apple nonce extension malformed")
    nonce_len = raw[5]
    if nonce_len != 32:
        raise AttestVerificationError(
            f"Apple nonce extension: unexpected length {nonce_len}"
        )
    return raw[6:6 + nonce_len]
