"""JalDrishti — STP-point wastewater surveillance (Chandigarh) + ICMR masking.

Self-contained FastAPI app:
- MAP: Chandigarh STP (water-collection) points, coloured by their wastewater
  signal. Wastewater values are illustrative WastewaterSCAN-style SAMPLE data
  (see wastewater.py) — dummy numbers placed on the real STPs to demo the flow.
- MASKING: a national advisory derived from REAL ICMR influenza positivity.
- FORECAST: past↔future prediction on each STP/marker series (predict.py).

No DB, no auth, no scraping. ICMR is a bundled snapshot under ./data/.
"""
from __future__ import annotations

import json
import statistics
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

import predict
import wastewater as ww

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
WEB_DIR = ROOT / "web"

RANGE_WEEKS = {"30": 5, "60": 9, "180": 26}
SIGNAL_COLORS = {"baseline": "#2E9E5B", "watch": "#E0A100", "alert": "#D7263D", "none": "#C7D0DA"}
MASKING = {
    "not_required": {"level": "not_required", "label": "Masking not required", "signal": "baseline"},
    "suggested": {"level": "suggested", "label": "Masking suggested", "signal": "watch"},
    "strongly_advised": {"level": "strongly_advised", "label": "Masking strongly advised", "signal": "alert"},
}
MASKING_NOTE = "Advisory only — a suggested preventive measure, not enforcement."
# ICMR combined-positivity ratio (current vs recent baseline) → masking level
MASK_RATIO = {"strongly_advised": 1.5, "suggested": 1.1}


@lru_cache(maxsize=2)
def _icmr() -> Dict[str, Any]:
    try:
        return json.loads((DATA_DIR / "icmr_influenza" / "latest.json").read_text())
    except Exception:
        return {}


# ── ICMR data (recent window) ─────────────────────────────────────────────────
def _icmr_recent() -> Dict[str, Any]:
    chart = (_icmr().get("data") or {})
    labels = chart.get("labels") or []
    datasets = chart.get("datasets") or []
    pathogens = []
    for d in datasets:
        vals = [float(v or 0) for v in (d.get("values") or [])]
        pathogens.append({"name": d.get("disease"), "color": d.get("color"),
                          "values": vals, "latest": round(vals[-1], 1) if vals else 0.0})
    n = len(labels)
    totals = [round(sum(p["values"][i] for p in pathogens if i < len(p["values"])), 1) for i in range(n)]
    return {"week": chart.get("latest_week"), "labels": labels, "pathogens": pathogens,
            "weekly_totals": totals, "updated": _icmr().get("last_updated"),
            "total_weeks": chart.get("total_weeks")}


# ── ICMR-driven national masking advisory ─────────────────────────────────────
def _masking_from_icmr() -> Dict[str, Any]:
    rec = _icmr_recent()
    totals = rec["weekly_totals"]
    if not totals:
        return {**MASKING["not_required"], "note": MASKING_NOTE, "available": False,
                "source": "ICMR Influenza", "drivers": [], "source_week": rec.get("week")}
    current = totals[-1]
    window = totals[-13:-1] or totals[:-1] or [current]
    baseline = statistics.median(window) if window else (current or 1)
    baseline = baseline or 1
    ratio = current / baseline
    level = ("strongly_advised" if ratio >= MASK_RATIO["strongly_advised"]
             else "suggested" if ratio >= MASK_RATIO["suggested"] else "not_required")
    drivers = sorted(rec["pathogens"], key=lambda p: p["latest"], reverse=True)[:3]
    return {
        **MASKING[level], "note": MASKING_NOTE, "available": True,
        "source": "ICMR Influenza (national)", "source_week": rec.get("week"),
        "current_total": round(current, 1), "baseline": round(baseline, 1), "ratio": round(ratio, 2),
        "baseline_window_weeks": len(window),
        "thresholds": MASK_RATIO,
        "drivers": [{"name": p["name"], "value": p["latest"], "color": p["color"]} for p in drivers],
        "rationale": f"Current respiratory positivity is {round(ratio, 2)}× the recent {len(window)}-week "
                     f"baseline (driven by {', '.join(p['name'] for p in drivers[:2])}).",
    }


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="JalDrishti", version="2.0.0")


@app.get("/api/jd/meta")
def meta():
    return {
        "program": "JalDrishti", "location": "Chandigarh, India",
        "illustrative": ww.ILLUSTRATIVE,
        "map_center": [30.7333, 76.7794], "map_zoom": 12,
        "stp_count": len(ww.STPS),
        "pillars": ww.PILLARS,
        "markers": [{"id": m["id"], "name": m["name"], "color": m["color"],
                     "pillar": m["pillar"], "unit": m["unit"]} for m in ww.MARKERS],
        "unit": ww.VIRAL_UNIT, "thresholds": ww.VIRAL_THRESHOLDS, "ranges": list(RANGE_WEEKS.keys()),
        "signal_colors": SIGNAL_COLORS,
        "week_labels": ww.week_labels(),
        "masking": _masking_from_icmr(),
        "data_note": "Wastewater values are illustrative WastewaterSCAN-style sample data placed on "
                     "Chandigarh STPs. Masking is derived from real ICMR influenza data.",
        "icmr_updated": _icmr().get("last_updated"),
    }


@app.get("/api/jd/stps")
def stps():
    return {"stps": ww.stp_list(), "thresholds": ww.VIRAL_THRESHOLDS}


@app.get("/api/jd/stp/{stp_id}")
def stp(stp_id: str):
    s = next((x for x in ww.STPS if x["id"] == stp_id), None)
    if not s:
        return {"error": "not found"}
    return {
        **{k: s[k] for k in ("id", "name", "area", "lat", "lng", "population")},
        "signal": ww.stp_signal(stp_id),
        "markers": ww.stp_marker_summaries(stp_id),
        "unit": ww.VIRAL_UNIT,
    }


@app.get("/api/jd/series/{stp_id}/{marker_id}")
def series(stp_id: str, marker_id: str, range: str = "180"):
    vals = ww.series_for(stp_id, marker_id)
    labels = ww.week_labels()
    n = RANGE_WEEKS.get(range, 26)
    m = ww.marker(marker_id) or {}
    return {"stp": stp_id, "marker": marker_id, "name": m.get("name"), "color": m.get("color"),
            "pillar": m.get("pillar"), "illustrative": m.get("pillar") == "ncd",
            "unit": m.get("unit", ww.VIRAL_UNIT), "labels": labels[-n:], "values": vals[-n:]}


@app.get("/api/jd/predict/{stp_id}/{marker_id}")
def predict_series(stp_id: str, marker_id: str, range: str = "180", horizon: int = 8):
    vals = ww.series_for(stp_id, marker_id)
    labels = ww.week_labels()
    n = RANGE_WEEKS.get(range, 26)
    m = ww.marker(marker_id) or {}
    fc = predict.forecast(vals, labels, horizon=horizon)
    fc["history"] = {"labels": labels[-n:], "values": [round(float(v), 1) for v in vals[-n:]]}
    fc["name"] = m.get("name")
    fc["color"] = m.get("color")
    fc["unit"] = m.get("unit", ww.VIRAL_UNIT)
    fc["pillar"] = m.get("pillar")
    if m.get("pillar") == "ncd":
        fc["illustrative"] = True
        fc["note"] = (fc.get("note", "") + " — illustrative NCD sample data (no mass-spec feed yet).").strip()
    return fc


@app.get("/api/jd/chart-details/{stp_id}/{marker_id}")
def chart_details(stp_id: str, marker_id: str):
    vals = ww.series_for(stp_id, marker_id)
    m = ww.marker(marker_id) or {}
    text = predict.chart_details(m.get("name", marker_id), vals)
    if m.get("pillar") == "ncd":
        text += " These NCD figures are illustrative sample data."
    return {"text": text}


@app.get("/api/jd/masking")
def masking():
    return _masking_from_icmr()


@app.get("/api/jd/icmr")
def icmr():
    """Raw-ish ICMR recent data + the masking calculation, for the transparency page."""
    return {**_icmr_recent(), "masking": _masking_from_icmr(), "unit": "lab-confirmed positivity (count)"}


# SPA last so /api/* wins.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
