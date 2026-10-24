from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ["APP_ENV"] = "test"
os.environ["MONGODB_DB"] = os.environ.get("MONGODB_TEST_DB", "sahisupply_test")
os.environ.setdefault("MONGODB_TIMEOUT_MS", "1500")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest  # noqa: E402

from app.data.generator import generate_dataset  # noqa: E402


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: long-running harness (100 seeds, stress test)")
    config.addinivalue_line("markers", "mongo: requires a reachable MongoDB")


@pytest.fixture(scope="session")
def datasets():
    return {m: generate_dataset(m) for m in ("pharmacy", "grocery", "cosmetics")}


@pytest.fixture(scope="session")
def mongo_available():
    from app.database.connection import ping
    ok, _ = ping()
    if not ok:
        pytest.skip("MongoDB not reachable")
    return True


@pytest.fixture(scope="session")
def seeded_db(mongo_available):
    from app.config import get_settings
    from app.database.connection import get_client
    from scripts.seed_database import seed

    assert get_settings().mongodb_db.endswith("_test"), "tests must never touch the main database"
    get_client().drop_database(get_settings().mongodb_db)
    seed(42)
    yield get_client()[get_settings().mongodb_db]


@pytest.fixture(scope="session")
def client(seeded_db):
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        yield c
