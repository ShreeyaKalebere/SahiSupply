"""SHA-256 data fingerprints over canonical JSON."""
from __future__ import annotations

import hashlib
import json


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str).encode()


def fingerprint(obj) -> str:
    return hashlib.sha256(canonical(obj)).hexdigest()
