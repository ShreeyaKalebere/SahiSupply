"""Write versioned, gzipped JSON snapshots of the synthetic datasets (plus SHA-256 manifest).

Usage (from backend/):  python -m scripts.export_snapshot [--seed 42]
The API's database-down fallback regenerates the same data in memory from the seed; these files are
for offline inspection and to prove byte-identical reproduction (compare the manifest hashes).
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import REPO_ROOT  # noqa: E402
from app.data.generator import canonical_json, dataset_sha256, generate_dataset  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    out_dir = REPO_ROOT / "data" / "snapshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for module in ("pharmacy", "grocery", "food"):
        for pattern in (True, False):
            ds = generate_dataset(module, seed=args.seed, contested_pattern=pattern)
            name = f"{module}_seed{args.seed}_{'contested' if pattern else 'uncontested'}_v1.json.gz"
            with gzip.GzipFile(out_dir / name, "wb", mtime=0) as f:
                f.write(canonical_json(ds))
            manifest[name] = dataset_sha256(ds)
            print(f"{name}  sha256={manifest[name]}")
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
