"""User-built network: pick which warehouses and stores take part and open/close individual roads.

Applied after the scenario, to the scenario's copy of the data, so the plan, checker and fingerprint
all see exactly the edited network. Removing a warehouse also removes its stock and roads.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.data.catalog import id_sort_key


class NetworkEditError(ValueError):
    pass


@dataclass
class NetworkEdit:
    warehouses: list[str] | None = None            # warehouse ids to keep (None = all)
    outlets: list[str] | None = None               # store ids to keep (None = all)
    route_overrides: dict[str, bool] = field(default_factory=dict)   # route_id -> open?

    def is_empty(self) -> bool:
        return self.warehouses is None and self.outlets is None and not self.route_overrides

    def as_dict(self) -> dict:
        return {"warehouses": self.warehouses, "outlets": self.outlets, "route_overrides": dict(self.route_overrides)}


def apply_network(ds: dict, edit: NetworkEdit) -> dict:
    """Return a summary of what changed. ``ds`` must be a scenario copy (routes/warehouses/outlets copied)."""
    all_w = {w["warehouse_id"] for w in ds["warehouses"]}
    all_d = {o["outlet_id"] for o in ds["outlets"]}
    keep_w = set(edit.warehouses) if edit.warehouses is not None else all_w
    keep_d = set(edit.outlets) if edit.outlets is not None else all_d
    if unknown := (keep_w - all_w) | (keep_d - all_d):
        raise NetworkEditError(f"unknown warehouse or store ids: {sorted(unknown)}")
    if not keep_w:
        raise NetworkEditError("keep at least one warehouse")
    if not keep_d:
        raise NetworkEditError("keep at least one store")
    route_ids = {r["route_id"] for r in ds["routes"]}
    if unknown_r := set(edit.route_overrides) - route_ids:
        raise NetworkEditError(f"unknown road ids: {sorted(unknown_r)}")

    ds["warehouses"] = [w for w in ds["warehouses"] if w["warehouse_id"] in keep_w]
    ds["outlets"] = [o for o in ds["outlets"] if o["outlet_id"] in keep_d]
    ds["batches"] = [b for b in ds["batches"] if b["warehouse_id"] in keep_w]
    ds["routes"] = [r for r in ds["routes"] if r["warehouse_id"] in keep_w and r["outlet_id"] in keep_d]
    ds["outlet_inventory"] = [r for r in ds["outlet_inventory"] if r["outlet_id"] in keep_d]
    ds["open_orders"] = [r for r in ds["open_orders"] if r["outlet_id"] in keep_d]

    closed, opened = [], []
    for r in ds["routes"]:
        want = edit.route_overrides.get(r["route_id"])
        if want is None or want == r["open"]:
            continue
        r["open"] = want
        (opened if want else closed).append(r["route_id"])
    return {
        "warehouses_kept": sorted(keep_w, key=id_sort_key),
        "warehouses_removed": sorted(all_w - keep_w, key=id_sort_key),
        "outlets_kept": sorted(keep_d, key=id_sort_key),
        "outlets_removed": sorted(all_d - keep_d, key=id_sort_key),
        "roads_closed": sorted(closed), "roads_opened": sorted(opened),
    }
