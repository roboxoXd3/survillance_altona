"""WastewaterSCAN-style SAMPLE data for Chandigarh STPs.

Two marker pillars:
  • viral  — respiratory/enteric pathogens, on a 0–100 relative-concentration index
             (drives the STP map signal). UNCHANGED from before.
  • ncd    — NCD & lifestyle markers in their REAL units (mg/day/1000, µg/L, index).
             Illustrative only (no real mass-spec feed yet); does NOT affect the map.

WastewaterSCAN has no public API, so these are DUMMY numbers used to demonstrate the
flow — clearly labelled illustrative in the UI. Swap `series_for()` for a live feed later.
"""
from __future__ import annotations

import datetime as _dt
import math
from functools import lru_cache
from typing import Any, Dict, List, Optional

WEEKS = 26
ILLUSTRATIVE = True

# 5 Chandigarh STP sites (approx. coordinates — dummy placement for the demo).
STPS: List[Dict[str, Any]] = [
    {"id": "3brd", "name": "3BRD STP", "area": "Industrial Area / Ph-1", "lat": 30.7050, "lng": 76.8060, "population": 250000},
    {"id": "diggian", "name": "Diggian STP", "area": "Dhanas / Diggian", "lat": 30.7625, "lng": 76.7600, "population": 300000},
    {"id": "raipur", "name": "Raipur Kalan STP", "area": "Raipur Kalan", "lat": 30.7450, "lng": 76.8600, "population": 120000},
    {"id": "dhanas", "name": "Dhanas STP", "area": "Dhanas", "lat": 30.7600, "lng": 76.7450, "population": 90000},
    {"id": "maloya", "name": "Maloya STP", "area": "Maloya", "lat": 30.7000, "lng": 76.7300, "population": 70000},
]

VIRAL_UNIT = "relative concentration (0–100, PMMoV-normalized)"
VIRAL_THRESHOLDS = {"watch": 50, "alert": 75}

# ── Markers ──────────────────────────────────────────────────────────────────
# Viral (unchanged 0–100 index). ncd markers carry real units + their own ranges.
MARKERS: List[Dict[str, Any]] = [
    # —— Pillar 1 · viral (drives the map) ——
    {"id": "sars2", "name": "SARS-CoV-2", "pillar": "viral", "color": "#0E6BA8", "unit": VIRAL_UNIT, "shape": "falling"},
    {"id": "fluA", "name": "Influenza A", "pillar": "viral", "color": "#D7263D", "unit": VIRAL_UNIT, "shape": "seasonal"},
    {"id": "rsv", "name": "RSV", "pillar": "viral", "color": "#1B9C6B", "unit": VIRAL_UNIT, "shape": "seasonal2"},
    {"id": "noro", "name": "Norovirus", "pillar": "viral", "color": "#7A5AF8", "unit": VIRAL_UNIT, "shape": "spike"},
    {"id": "hepA", "name": "Hepatitis A", "pillar": "viral", "color": "#E0A100", "unit": VIRAL_UNIT, "shape": "rising"},
    # —— Pillar 2 · NCD & lifestyle (illustrative, real units, does NOT affect map) ——
    {"id": "etg", "name": "Alcohol (EtG/EtS)", "pillar": "ncd", "color": "#1B9C6B", "unit": "mg/day/1000 ppl",
     "base": 42, "amp": 14, "trend": 0.6, "phase": 0.0, "dp": 0, "watch": 45, "alert": 62},
    {"id": "cotinine", "name": "Tobacco (cotinine)", "pillar": "ncd", "color": "#15803D", "unit": "mg/day/1000 ppl",
     "base": 50, "amp": 14, "trend": 0.5, "phase": 0.8, "dp": 0, "watch": 48, "alert": 66},
    {"id": "diet", "name": "Diet quality (flavonoids/fibre)", "pillar": "ncd", "color": "#65A30D", "unit": "index (0–100)",
     "base": 60, "amp": 12, "trend": 0.4, "phase": 1.4, "dp": 0, "watch": 999, "alert": 9999},  # higher = better → stays baseline
    {"id": "sweetener", "name": "Artificial sweeteners (sucralose)", "pillar": "ncd", "color": "#84CC16", "unit": "µg/L",
     "base": 2.6, "amp": 1.2, "trend": 0.3, "phase": 0.3, "dp": 1, "watch": 8, "alert": 14},
    {"id": "metformin", "name": "Diabetes load (metformin)", "pillar": "ncd", "color": "#0D9488", "unit": "µg/L",
     "base": 6.0, "amp": 3.0, "trend": 0.7, "phase": 0.6, "dp": 1, "watch": 6, "alert": 12},
    {"id": "statin", "name": "Cardiovascular load (statins)", "pillar": "ncd", "color": "#4D7C0F", "unit": "µg/L",
     "base": 1.3, "amp": 0.8, "trend": 0.4, "phase": 1.0, "dp": 1, "watch": 5, "alert": 9},
]

PILLARS = [{"id": "viral", "label": "Viral & Pathogen"}, {"id": "ncd", "label": "NCD & Lifestyle"}]

# per-STP intensity (viral only) so the map shows a realistic mix of baseline/watch/alert
INTENSITY = {"3brd": 0.86, "diggian": 0.98, "raipur": 0.7, "dhanas": 1.3, "maloya": 0.82}

# region/map config (consumed by app.meta). map_mode "voronoi" = nearest-STP blocks
# clipped to the city boundary + sector grid.
META = {
    "title": "Chandigarh", "location": "Chandigarh, India", "site_label": "STP",
    "map_center": [30.7333, 76.7794], "map_zoom": 12, "map_mode": "voronoi",
    "boundary_asset": "assets/chandigarh-boundary.geojson",
    "sectors_asset": "assets/chandigarh-sectors.geojson",
    "data_note": "Wastewater values are illustrative WastewaterSCAN-style sample data placed on "
                 "Chandigarh STPs. Masking is derived from real ICMR influenza data.",
}


def marker(mid: str) -> Optional[Dict[str, Any]]:
    return next((m for m in MARKERS if m["id"] == mid), None)


def catchment_km(population: int) -> float:
    """Approximate catchment RADIUS (km) sized by population. Estimated — not a
    real sewershed boundary (labelled 'estimated' in the UI)."""
    return round(0.8 + math.sqrt(max(population, 1) / 40000), 1)


def _seed(*parts) -> int:
    s = 0
    for p in parts:
        for ch in str(p):
            s = (s * 131 + ord(ch)) & 0x7FFFFFFF
    return s or 1


def _rng(seed: int):
    def r():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        return seed / 0x7FFFFFFF
    return r


@lru_cache(maxsize=1)
def week_labels() -> List[str]:
    today = _dt.date.today()
    monday = today - _dt.timedelta(days=today.weekday())
    out = []
    for i in range(WEEKS):
        d = monday - _dt.timedelta(weeks=(WEEKS - 1 - i))
        iso = d.isocalendar()
        out.append(f"Wk {iso[1]} · {iso[0]}")
    return out


# ── Viral generation (0–100 index) — UNCHANGED ───────────────────────────────
def _viral_value(shape: str, t: float, r) -> float:
    n = (r() - 0.5) * 14
    if shape == "falling":
        base = 70 - 45 * t
    elif shape == "rising":
        base = 18 + 42 * t
    elif shape == "seasonal":
        base = 45 + 35 * math.sin(t * math.pi * 2 - 1.1)
    elif shape == "seasonal2":
        base = 40 + 30 * math.sin(t * math.pi * 2 + 0.6)
    elif shape == "spike":
        base = 22 + 70 * math.exp(-((t - 0.82) / 0.12) ** 2)
    else:
        base = 40
    return max(0.0, min(100.0, round(base + n, 1)))


# ── NCD generation (real units, slow-moving) ─────────────────────────────────
def _ncd_value(m: Dict[str, Any], t: float, r, site: float) -> float:
    amp = m["amp"]
    wave = m["base"] + amp * (m.get("trend", 0.3) * t + 0.22 * math.sin(t * math.pi * 1.6 + m.get("phase", 0)))
    noise = (r() - 0.5) * amp * 0.12
    v = max(0.0, (wave + noise) * site)
    return round(v, m.get("dp", 1))


@lru_cache(maxsize=512)
def series_for(stp_id: str, marker_id: str) -> List[float]:
    m = marker(marker_id)
    if not m:
        return []
    if m["pillar"] == "ncd":
        idx = next((i for i, s in enumerate(STPS) if s["id"] == stp_id), 2)
        site = 0.9 + 0.05 * (idx - 2)  # mild per-site variation, doesn't flip thresholds
        r = _rng(_seed("ncd", stp_id, marker_id))
        return [_ncd_value(m, i / (WEEKS - 1), r, site) for i in range(WEEKS)]
    # viral — unchanged
    mult = INTENSITY.get(stp_id, 0.9)
    r = _rng(_seed(stp_id, marker_id))
    out = []
    for i in range(WEEKS):
        t = i / (WEEKS - 1)
        out.append(round(max(0.0, min(100.0, _viral_value(m["shape"], t, r) * mult)), 1))
    return out


def status_for(value: float, m: Dict[str, Any]) -> str:
    watch = m.get("watch", VIRAL_THRESHOLDS["watch"])
    alert = m.get("alert", VIRAL_THRESHOLDS["alert"])
    if value >= alert:
        return "alert"
    if value >= watch:
        return "watch"
    return "baseline"


def stp_marker_summaries(stp_id: str, pillar: Optional[str] = None) -> List[Dict[str, Any]]:
    out = []
    for m in MARKERS:
        if pillar and m["pillar"] != pillar:
            continue
        s = series_for(stp_id, m["id"])
        cur = s[-1] if s else 0.0
        out.append({
            "id": m["id"], "name": m["name"], "pillar": m["pillar"], "color": m["color"],
            "unit": m["unit"], "current": cur, "status": status_for(cur, m), "spark": s[-12:],
            "illustrative": m["pillar"] == "ncd",
        })
    return out


def stp_signal(stp_id: str) -> str:
    """Map signal = VIRAL markers only (NCD never recolours the map)."""
    order = {"baseline": 0, "watch": 1, "alert": 2}
    worst = "baseline"
    for m in MARKERS:
        if m["pillar"] != "viral":
            continue
        st = status_for(series_for(stp_id, m["id"])[-1], m)
        if order[st] > order[worst]:
            worst = st
    return worst


def stp_list() -> List[Dict[str, Any]]:
    out = []
    for s in STPS:
        viral = stp_marker_summaries(s["id"], pillar="viral")
        top = max(viral, key=lambda x: x["current"]) if viral else {"name": "—", "current": 0}
        out.append({**{k: s[k] for k in ("id", "name", "area", "lat", "lng", "population")},
                    "signal": stp_signal(s["id"]),
                    "catchment_km": catchment_km(s["population"]), "population_estimated": True,
                    "top_marker": top["name"], "top_value": top["current"]})
    return out
