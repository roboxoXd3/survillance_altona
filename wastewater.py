"""WastewaterSCAN-style SAMPLE data for Chandigarh STPs.

WastewaterSCAN has no public API, and per the brief these are DUMMY numbers used
only to demonstrate the STP-point map + forecast — the values are realistic in
shape (the markers WastewaterSCAN tracks, weekly cadence, seasonal behaviour) and
are clearly labelled illustrative in the UI. Swap `series_for()` to read a live
wwscan/CDC feed later; nothing else changes.

Values are a normalized "relative concentration" index (0–100), which is how
wastewater levels are most honestly compared across sites/markers.
"""
from __future__ import annotations

import datetime as _dt
import math
from functools import lru_cache
from typing import Any, Dict, List

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

# Markers WastewaterSCAN tracks (representative subset).
MARKERS: List[Dict[str, Any]] = [
    {"id": "sars2", "name": "SARS-CoV-2", "color": "#0E6BA8", "shape": "falling"},
    {"id": "fluA", "name": "Influenza A", "color": "#D7263D", "shape": "seasonal"},
    {"id": "rsv", "name": "RSV", "color": "#1B9C6B", "shape": "seasonal2"},
    {"id": "noro", "name": "Norovirus", "color": "#7A5AF8", "shape": "spike"},
    {"id": "hepA", "name": "Hepatitis A", "color": "#E0A100", "shape": "rising"},
]
UNIT = "relative concentration (0–100, PMMoV-normalized)"
THRESHOLDS = {"watch": 50, "alert": 75}

# per-STP intensity so the map shows a realistic mix of baseline/watch/alert
INTENSITY = {"3brd": 0.86, "diggian": 0.98, "raipur": 0.7, "dhanas": 1.3, "maloya": 0.82}


def _seed(*parts) -> int:
    """Stable cross-process seed (Python's hash() is salted per run)."""
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


def _shape_value(shape: str, t: float, r) -> float:
    n = (r() - 0.5) * 14  # noise
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


@lru_cache(maxsize=256)
def series_for(stp_id: str, marker_id: str) -> List[float]:
    marker = next((m for m in MARKERS if m["id"] == marker_id), None)
    if not marker:
        return []
    # per-site intensity so STPs differ but stay plausible
    mult = INTENSITY.get(stp_id, 0.9)
    r = _rng(_seed(stp_id, marker_id))
    vals = []
    for i in range(WEEKS):
        t = i / (WEEKS - 1)
        v = _shape_value(marker["shape"], t, r) * mult
        vals.append(round(max(0.0, min(100.0, v)), 1))
    return vals


def status_for(value: float) -> str:
    if value >= THRESHOLDS["alert"]:
        return "alert"
    if value >= THRESHOLDS["watch"]:
        return "watch"
    return "baseline"


def stp_marker_summaries(stp_id: str) -> List[Dict[str, Any]]:
    out = []
    for m in MARKERS:
        s = series_for(stp_id, m["id"])
        cur = s[-1] if s else 0.0
        out.append({
            "id": m["id"], "name": m["name"], "color": m["color"], "unit": UNIT,
            "current": cur, "status": status_for(cur), "spark": s[-12:],
        })
    return out


def stp_signal(stp_id: str) -> str:
    order = {"baseline": 0, "watch": 1, "alert": 2}
    worst = "baseline"
    for m in MARKERS:
        st = status_for(series_for(stp_id, m["id"])[-1])
        if order[st] > order[worst]:
            worst = st
    return worst


def stp_list() -> List[Dict[str, Any]]:
    out = []
    for s in STPS:
        ms = stp_marker_summaries(s["id"])
        top = max(ms, key=lambda x: x["current"])
        out.append({**{k: s[k] for k in ("id", "name", "area", "lat", "lng", "population")},
                    "signal": stp_signal(s["id"]),
                    "top_marker": top["name"], "top_value": top["current"]})
    return out
