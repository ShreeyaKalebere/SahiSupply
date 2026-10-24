from app.data.generator import SYNTHETIC_LABEL, dataset_sha256, generate_dataset


def test_counts_match_prd(datasets):
    for m, d in datasets.items():
        assert len(d["warehouses"]) == 5
        assert len(d["outlets"]) == 12
        assert len(d["products"]) == 15
        assert len(d["routes"]) == 60
        assert 120 <= len(d["batches"]) <= 150, len(d["batches"])
        assert len(d["demand_history"]) == 12 * 15 * 180 == 32400
        assert len({o["region"] for o in d["outlets"]}) == 3
        assert len(d["open_orders"]) == (180 if m == "grocery" else 0)


def test_pharmacy_has_5_critical_and_4_cold_products(datasets):
    ps = datasets["pharmacy"]["products"]
    assert sum(p["criticality"] == "critical" for p in ps) == 5
    assert sum(p["storage_class"] == "2-8C" for p in ps) == 4


def test_same_seed_is_byte_identical_and_seed_matters():
    for m in ("pharmacy", "grocery", "food"):
        assert dataset_sha256(generate_dataset(m)) == dataset_sha256(generate_dataset(m))
    assert dataset_sha256(generate_dataset("pharmacy", seed=42)) != dataset_sha256(generate_dataset("pharmacy", seed=7))


def test_references_are_valid(datasets):
    for d in datasets.values():
        wids = {w["warehouse_id"] for w in d["warehouses"]}
        oids = {o["outlet_id"] for o in d["outlets"]}
        pids = {p["product_id"] for p in d["products"]}
        assert all(b["product_id"] in pids and b["warehouse_id"] in wids and b["quantity"] > 0 for b in d["batches"])
        assert all(r["warehouse_id"] in wids and r["outlet_id"] in oids for r in d["routes"])
        assert {(r["warehouse_id"], r["outlet_id"]) for r in d["routes"]} == {(w, o) for w in wids for o in oids}
        assert all(h["qty"] >= 0 for h in d["demand_history"])
        # each product at 3 of 5 warehouses
        for p in pids:
            assert len({b["warehouse_id"] for b in d["batches"] if b["product_id"] == p}) == 3


def test_lead_time_follows_distance_rule(datasets):
    for r in datasets["pharmacy"]["routes"]:
        assert r["lead_time_days"] == 1 + int(r["distance_km"] // 350)


def test_contested_pattern_only_changes_routes():
    on, off = generate_dataset("food", contested_pattern=True), generate_dataset("food", contested_pattern=False)
    for k in ("warehouses", "outlets", "products", "batches", "demand_history", "outlet_inventory"):
        assert on[k] == off[k], k
    assert all(r["open"] for r in off["routes"])
    closed = [r for r in on["routes"] if not r["open"]]
    remote = {o["outlet_id"] for o in on["outlets"] if o["remote"]}
    assert closed and all(r["outlet_id"] in remote and r["warehouse_id"] != "W2" for r in closed)


def test_data_is_labelled_synthetic(datasets):
    for d in datasets.values():
        assert d["meta"]["label"] == SYNTHETIC_LABEL
        assert "SYNTHETIC" in d["meta"]["label"]
