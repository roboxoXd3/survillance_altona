"""Kerala — district-level outbreak surveillance (ILLUSTRATIVE).

Mirrors the wastewater.py interface so app.py can treat it as another "region".
Here a *site* is a Kerala DISTRICT (14 of them). Each district carries an
illustrative IDSP-style outbreak `level` (green/yellow/orange/red) — a DEMO
signal, clearly labelled, not a live IDSP feed. Marker series + the per-district
signal are scaled from that level; the national ICMR masking advisory (real) is
the same India-wide snapshot used everywhere.

Swap the static `level`s / wire a real IDSP feed later — the rest stays the same.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# reuse the marker definitions + generators + helpers from the Chandigarh module
from wastewater import (
    MARKERS, PILLARS, VIRAL_UNIT, VIRAL_THRESHOLDS, WEEKS,
    week_labels, marker, status_for, _seed, _rng, _viral_value, _ncd_value,
)

ILLUSTRATIVE = True

META = {
    "title": "Kerala", "location": "Kerala, India", "site_label": "District",
    "map_center": [10.4, 76.3], "map_zoom": 7, "map_mode": "districts",
    "districts_asset": "assets/kerala-districts.geojson",
    "data_note": "District outbreak levels are ILLUSTRATIVE (demo of an IDSP-style "
                 "outbreak signal), not a live IDSP feed. The national masking advisory "
                 "is derived from real ICMR influenza data.",
}

# 14 districts. `geo` must match the 'name' property in kerala-districts.geojson.
# `level` = illustrative IDSP-style outbreak signal — a monsoon-onset viral-fever
# cluster across the northern districts (demo scenario; clearly labelled in the UI).
DISTRICTS: List[Dict[str, Any]] = [
    {"id": "tvm", "name": "Thiruvananthapuram", "geo": "Thiruvananthapuram", "lat": 8.6062, "lng": 77.0047, "population": 3300000, "level": "green"},
    {"id": "klm", "name": "Kollam",            "geo": "Kollam",            "lat": 8.9541, "lng": 76.8677, "population": 2630000, "level": "green"},
    {"id": "pta", "name": "Pathanamthitta",    "geo": "Pattanamtitta",     "lat": 9.2761, "lng": 76.9134, "population": 1200000, "level": "green"},
    {"id": "alp", "name": "Alappuzha",         "geo": "Alappuzha",         "lat": 9.4088, "lng": 76.4470, "population": 2120000, "level": "yellow"},
    {"id": "ktm", "name": "Kottayam",          "geo": "Kottayam",          "lat": 9.6285, "lng": 76.6490, "population": 1970000, "level": "yellow"},
    {"id": "idk", "name": "Idukki",            "geo": "Idukki",            "lat": 9.8738, "lng": 77.0132, "population": 1110000, "level": "green"},
    {"id": "ekm", "name": "Ernakulam",         "geo": "Ernakulam",         "lat": 10.0588, "lng": 76.4794, "population": 3280000, "level": "orange"},
    {"id": "tsr", "name": "Thrissur",          "geo": "Thrissur",          "lat": 10.4656, "lng": 76.3119, "population": 3120000, "level": "orange"},
    {"id": "pkd", "name": "Palakkad",          "geo": "Palakkad",          "lat": 10.7872, "lng": 76.5483, "population": 2810000, "level": "yellow"},
    {"id": "mpm", "name": "Malappuram",        "geo": "Malappuram",        "lat": 11.1293, "lng": 76.1516, "population": 4110000, "level": "red"},
    {"id": "kkd", "name": "Kozhikode",         "geo": "Kozhikode",         "lat": 11.4808, "lng": 75.8315, "population": 3090000, "level": "red"},
    {"id": "wyd", "name": "Wayanad",           "geo": "Wayanad",           "lat": 11.7049, "lng": 76.0916, "population": 820000,  "level": "orange"},
    {"id": "knr", "name": "Kannur",            "geo": "Kannur",            "lat": 11.9924, "lng": 75.5362, "population": 2520000, "level": "yellow"},
    {"id": "ksd", "name": "Kasaragod",         "geo": "Kasaragod",         "lat": 12.4611, "lng": 75.1525, "population": 1310000, "level": "green"},
]

# generic alias so app.py's region-agnostic code (mod.STPS) works unchanged
STPS = DISTRICTS

LEVEL_SIGNAL = {"green": "baseline", "yellow": "watch", "orange": "alert", "red": "alert"}
# how strongly to scale the viral marker series so the charts match the outbreak level
LEVEL_MULT = {"green": 0.55, "yellow": 0.9, "orange": 1.25, "red": 1.55}
LEVEL_SCORE = {"green": 0.6, "yellow": 1.4, "orange": 2.1, "red": 2.7}


def _by_id(site_id: str) -> Optional[Dict[str, Any]]:
    return next((d for d in DISTRICTS if d["id"] == site_id), None)


def site_level(site_id: str) -> str:
    d = _by_id(site_id)
    return d["level"] if d else "green"


def series_for(site_id: str, marker_id: str) -> List[float]:
    m = marker(marker_id)
    if not m:
        return []
    d = _by_id(site_id)
    if m["pillar"] == "ncd":
        r = _rng(_seed("kl-ncd", site_id, marker_id))
        return [_ncd_value(m, i / (WEEKS - 1), r, 0.95) for i in range(WEEKS)]
    mult = LEVEL_MULT.get(d["level"], 0.9) if d else 0.9
    r = _rng(_seed("kl", site_id, marker_id))
    out = []
    for i in range(WEEKS):
        t = i / (WEEKS - 1)
        out.append(round(max(0.0, min(100.0, _viral_value(m["shape"], t, r) * mult)), 1))
    return out


def stp_signal(site_id: str) -> str:
    """District signal driven by the (illustrative) outbreak level."""
    d = _by_id(site_id)
    return LEVEL_SIGNAL.get(d["level"], "baseline") if d else "baseline"


def stp_marker_summaries(site_id: str, pillar: Optional[str] = None) -> List[Dict[str, Any]]:
    out = []
    for m in MARKERS:
        if pillar and m["pillar"] != pillar:
            continue
        s = series_for(site_id, m["id"])
        cur = s[-1] if s else 0.0
        out.append({
            "id": m["id"], "name": m["name"], "pillar": m["pillar"], "color": m["color"],
            "unit": m["unit"], "current": cur, "status": status_for(cur, m), "spark": s[-12:],
            "illustrative": True,  # Kerala layer is wholly illustrative
        })
    return out


def stp_list() -> List[Dict[str, Any]]:
    out = []
    for d in DISTRICTS:
        viral = stp_marker_summaries(d["id"], pillar="viral")
        top = max(viral, key=lambda x: x["current"]) if viral else {"name": "—", "current": 0}
        out.append({
            "id": d["id"], "name": d["name"], "area": d["name"] + " district",
            "lat": d["lat"], "lng": d["lng"], "population": d["population"],
            "signal": stp_signal(d["id"]), "level": d["level"], "geo": d["geo"],
            "catchment_km": None, "population_estimated": True,
            "top_marker": top["name"], "top_value": top["current"],
        })
    return out
