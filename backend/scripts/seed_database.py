"""Seed MongoDB with the deterministic synthetic datasets (seed 42).

Usage (from backend/):  python -m scripts.seed_database [--seed 42] [--module pharmacy]
Re-running replaces each module's documents, so it never creates duplicates.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.data.generator import dataset_sha256, generate_dataset  # noqa: E402
from app.database.connection import require_db  # noqa: E402
from app.database.indexes import ensure_schema  # noqa: E402
from app.database.repositories.dataset_repo import seed_module  # noqa: E402
from app.modules.config_loader import load_all_configs  # noqa: E402


def seed(seed_value: int, modules: list[str] | None = None) -> dict:
    db = require_db()
    ensure_schema(db)
    configs = load_all_configs()
    results = {}
    for module, cfg in configs.items():
        if modules and module not in modules:
            continue
        t0 = time.perf_counter()
        contested = generate_dataset(module, seed=seed_value, contested_pattern=True)
        uncontested = generate_dataset(module, seed=seed_value, contested_pattern=False)
        sha = dataset_sha256(contested)
        contested.pop("future_expected", None)
        config_doc = {**cfg.model_dump(mode="json"), "source_file": f"configs/{module}.yaml"}
        counts = seed_module(db, module, contested, uncontested["routes"], config_doc, sha)
        results[module] = {"counts": counts, "sha256": sha, "seconds": round(time.perf_counter() - t0, 2)}
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=get_settings().data_seed)
    ap.add_argument("--module", action="append", help="limit to one or more modules")
    args = ap.parse_args()
    s = get_settings()
    print(f"Seeding database '{s.mongodb_db}' (seed={args.seed}) ...")
    try:
        res = seed(args.seed, args.module)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    for m, r in res.items():
        print(f"  {m:9s} sha256={r['sha256'][:16]}  {r['counts']}  ({r['seconds']}s)")
    print("Done. All data is SYNTHETIC.")


if __name__ == "__main__":
    main()
