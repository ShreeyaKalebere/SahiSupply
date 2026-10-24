"""Dataset access with an explicit, labelled fallback.

Primary source: MongoDB. If MongoDB is unreachable, the API serves the read-only,
versioned synthetic snapshot regenerated deterministically from the seed; every
response then carries data_source="snapshot" and runs are flagged persisted=False.
"""
from __future__ import annotations

import logging
import threading

from pymongo.errors import PyMongoError

from app.config import get_settings
from app.data.generator import generate_dataset
from app.database.connection import get_db, ping
from app.database.repositories import dataset_repo

log = logging.getLogger("sahisupply.data")

_cache: dict[tuple, dict] = {}
_lock = threading.Lock()


class DatasetNotSeeded(RuntimeError):
    pass


def get_dataset(module: str, contested_pattern: bool = True) -> tuple[dict, str]:
    """Returns (dataset, source) where source is 'mongodb' or 'snapshot'."""
    ok, _ = ping()
    if ok:
        try:
            db = get_db()
            meta = db.dataset_meta.find_one({"module": module}, {"dataset_sha256": 1, "seeded_at": 1})
            if meta is None:
                raise DatasetNotSeeded(f"module {module!r} has no data in MongoDB; run backend/scripts/seed_database.py")
            key = ("mongodb", module, contested_pattern, meta.get("dataset_sha256"), str(meta.get("seeded_at")))
            with _lock:
                if key in _cache:
                    return _cache[key], "mongodb"
            ds = dataset_repo.load_dataset(db, module, contested_pattern)
            with _lock:
                for k in [k for k in _cache if k[:3] == key[:3]]:
                    del _cache[k]
                _cache[key] = ds
            return ds, "mongodb"
        except PyMongoError as exc:
            log.warning("MongoDB read failed, using snapshot: %s", exc)
    key = ("snapshot", module, contested_pattern, get_settings().data_seed)
    with _lock:
        if key not in _cache:
            ds = generate_dataset(module, seed=get_settings().data_seed, contested_pattern=contested_pattern)
            ds.pop("future_expected", None)
            _cache[key] = ds
        return _cache[key], "snapshot"


def clear_cache() -> None:
    with _lock:
        _cache.clear()
