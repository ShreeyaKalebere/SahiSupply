"""Live rainfall forecast (real data) from Open-Meteo for every warehouse and store location.

Roads touching a site whose forecast daily rainfall reaches the threshold are proposed for closure.
Default threshold 64.5 mm/day = IMD's "heavy rainfall" category. Only the weather is live; stock and
demand remain the synthetic dataset. If the service is unreachable we raise - nothing is invented.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
IMD_HEAVY_RAIN_MM = 64.5
FORECAST_DAYS = 7
CACHE_SECONDS = 1800
TIMEOUT_S = 10

_cache: dict[tuple, tuple[float, list[dict]]] = {}
_lock = threading.Lock()


class LiveDataUnavailable(RuntimeError):
    pass


def _fetch(points: list[tuple[float, float]]) -> list[dict]:
    query = urllib.parse.urlencode({
        "latitude": ",".join(f"{lat:.4f}" for lat, _ in points),
        "longitude": ",".join(f"{lon:.4f}" for _, lon in points),
        "daily": "precipitation_sum",
        "timezone": "Asia/Kolkata",
        "forecast_days": FORECAST_DAYS,
    })
    try:
        with urllib.request.urlopen(f"{OPEN_METEO_URL}?{query}", timeout=TIMEOUT_S) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - network, HTTP and JSON errors all mean "no live data"
        raise LiveDataUnavailable(f"Live weather service unreachable ({type(exc).__name__})") from exc
    if isinstance(data, dict):
        data = [data]
    if len(data) != len(points):
        raise LiveDataUnavailable("Live weather service returned an unexpected response")
    return data


def rainfall_forecast(sites: list[dict]) -> tuple[list[dict], str]:
    """sites: [{id, kind, name, city, lat, lon}] -> same list with daily forecast and max_mm, plus fetch time."""
    key = tuple((s["id"], round(s["lat"], 3), round(s["lon"], 3)) for s in sites)
    now = time.time()
    with _lock:
        hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_SECONDS:
        raw, fetched = hit[1], hit[0]
    else:
        raw = _fetch([(s["lat"], s["lon"]) for s in sites])
        fetched = now
        with _lock:
            _cache[key] = (fetched, raw)
    out = []
    for s, r in zip(sites, raw, strict=True):
        days = r.get("daily", {}).get("time", [])
        mm = [float(x or 0.0) for x in r.get("daily", {}).get("precipitation_sum", [])]
        out.append({**s, "daily": [{"date": d, "mm": v} for d, v in zip(days, mm, strict=False)],
                    "max_mm": max(mm) if mm else 0.0})
    return out, datetime.fromtimestamp(fetched, tz=timezone.utc).isoformat()


def weather_closures(dataset: dict, threshold_mm: float = IMD_HEAVY_RAIN_MM) -> dict:
    sites = [{"id": w["warehouse_id"], "kind": "warehouse", "name": w["name"], "city": w["city"],
              "lat": w["lat"], "lon": w["lon"]} for w in dataset["warehouses"]]
    sites += [{"id": o["outlet_id"], "kind": "store", "name": o["name"], "city": o["city"],
               "lat": o["lat"], "lon": o["lon"]} for o in dataset["outlets"]]
    forecast, fetched_at = rainfall_forecast(sites)
    heavy = {s["id"] for s in forecast if s["max_mm"] >= threshold_mm}
    for s in forecast:
        s["heavy"] = s["id"] in heavy
    roads = sorted(r["route_id"] for r in dataset["routes"]
                   if r["open"] and (r["warehouse_id"] in heavy or r["outlet_id"] in heavy))
    return {
        "source": "Open-Meteo forecast API (live)", "source_url": "https://open-meteo.com/",
        "fetched_at": fetched_at, "forecast_days": FORECAST_DAYS, "threshold_mm": threshold_mm,
        "imd_heavy_rain_mm": IMD_HEAVY_RAIN_MM, "sites": forecast, "heavy_sites": sorted(heavy),
        "roads_to_close": roads,
        "note": "Only the weather is live. Stock, demand and roads are the sample dataset; a road is closed "
                "when either end has a forecast day at or above the threshold.",
    }
