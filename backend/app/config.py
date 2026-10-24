"""Environment-based application settings."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    """Minimal .env loader (no extra dependency). Existing env vars win."""
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    app_env: str = "development"
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "sahisupply"
    mongodb_timeout_ms: int = 2000
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    solver_time_limit_s: float = 10.0
    data_seed: int = 42
    configs_dir: Path = REPO_ROOT / "configs"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    _load_dotenv()
    env = os.getenv("APP_ENV", "development")
    default_db = "sahisupply_test" if env == "test" else "sahisupply"
    return Settings(
        app_env=env,
        mongodb_uri=os.getenv("MONGODB_URI", "mongodb://localhost:27017"),
        mongodb_db=os.getenv("MONGODB_DB", default_db),
        mongodb_timeout_ms=int(os.getenv("MONGODB_TIMEOUT_MS", "2000")),
        cors_origins=[o.strip() for o in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
        solver_time_limit_s=float(os.getenv("SOLVER_TIME_LIMIT_S", "10")),
        data_seed=int(os.getenv("DATA_SEED", "42")),
        configs_dir=Path(os.getenv("CONFIGS_DIR", str(REPO_ROOT / "configs"))),
    )
