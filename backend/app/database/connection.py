"""MongoDB connection management. The URI always comes from MONGODB_URI; nothing is hardcoded."""
from __future__ import annotations

import logging
import threading

from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import PyMongoError

from app.config import get_settings

log = logging.getLogger("sahisupply.db")

_client: MongoClient | None = None
_lock = threading.Lock()


class DatabaseUnavailable(RuntimeError):
    pass


def get_client() -> MongoClient:
    global _client
    with _lock:
        if _client is None:
            s = get_settings()
            _client = MongoClient(s.mongodb_uri, serverSelectionTimeoutMS=s.mongodb_timeout_ms,
                                  connectTimeoutMS=s.mongodb_timeout_ms, appname="sahisupply", tz_aware=True)
        return _client


def get_db() -> Database:
    return get_client()[get_settings().mongodb_db]


def ping() -> tuple[bool, str]:
    try:
        get_client().admin.command("ping")
        return True, "ok"
    except PyMongoError as exc:
        return False, type(exc).__name__


def require_db() -> Database:
    ok, why = ping()
    if not ok:
        raise DatabaseUnavailable(f"MongoDB unavailable ({why})")
    return get_db()


def reset_client() -> None:
    global _client
    with _lock:
        if _client is not None:
            _client.close()
        _client = None
