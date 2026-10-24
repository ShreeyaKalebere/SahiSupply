import pytest
from pydantic import ValidationError

from app.modules.config_loader import ConfigError, ModuleConfig, load_all_configs, load_config_file
from app.modules.rules import resolve_rules


def test_all_three_modules_load_through_one_loader():
    cfgs = load_all_configs()
    assert set(cfgs) == {"grocery", "food", "pharmacy"}
    assert cfgs["grocery"].planning.need_source == "orders"
    assert cfgs["food"].planning.need_source == "forecast"
    assert cfgs["pharmacy"].planning.need_source == "forecast"


def test_p0_rule_thresholds_match_prd():
    c = load_all_configs()
    g = resolve_rules(c["grocery"])
    assert g.min_life_days == 3 and g.fefo
    f = resolve_rules(c["food"])
    assert f.min_life_pct == 40
    p = resolve_rules(c["pharmacy"])
    assert p.min_life_days == 90
    assert p.shortage_weights["critical"] == 10 and p.shortage_weights["standard"] == 1
    assert p.fill_floor_pct is None  # C4 is optional and off by default
    assert resolve_rules(c["pharmacy"], {"C4": True}).fill_floor_pct == 80


def test_rule_toggles_turn_rules_off_and_reject_unknown():
    c = load_all_configs()["pharmacy"]
    r = resolve_rules(c, {"C1": False})
    assert r.min_life_days is None and "C1" in r.disabled_ids
    with pytest.raises(ValueError):
        resolve_rules(c, {"ZZ": True})


def _base():
    return {"industry": "dairy", "display_name": "Dairy", "destination_types": ["shop"],
            "planning": {"review_period_days": 7, "need_source": "forecast"},
            "service_levels": {"critical": 1.28, "standard": 1.28}, "rules": []}


def test_schema_rejects_unknown_template_and_extra_keys():
    bad = _base() | {"rules": [{"id": "X1", "template": "run_python", "params": {"code": "os.system('x')"},
                                "status": "active"}]}
    with pytest.raises(ValidationError):
        ModuleConfig.model_validate(bad)
    extra = _base() | {"rules": [{"id": "X1", "template": "fefo", "params": {"enabled": True, "eval": "1"},
                                  "status": "active"}]}
    with pytest.raises(ValidationError):
        ModuleConfig.model_validate(extra)
    both = _base() | {"rules": [{"id": "X1", "template": "min_life_on_arrival",
                                 "params": {"min_days": 3, "min_pct": 10}, "status": "active"}]}
    with pytest.raises(ValidationError):
        ModuleConfig.model_validate(both)


def test_new_industry_is_a_new_file(tmp_path):
    import yaml
    p = tmp_path / "dairy.yaml"
    p.write_text(yaml.safe_dump(_base() | {"rules": [
        {"id": "D1", "template": "min_life_on_arrival", "params": {"min_days": 2}, "status": "active"}]}))
    cfg = load_config_file(p)
    assert resolve_rules(cfg).min_life_days == 2


def test_invalid_yaml_raises_config_error(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("industry: [unclosed")
    with pytest.raises(ConfigError):
        load_config_file(p)
