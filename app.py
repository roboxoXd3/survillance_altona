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
import kerala as kl

# region registry — each module exposes the same interface (STPS, MARKERS,
# series_for, stp_signal, stp_marker_summaries, stp_list, META, …).
REGION_MODULES = {"chandigarh": ww, "kerala": kl}
REGIONS = [{"id": "chandigarh", "title": "Chandigarh"}, {"id": "kerala", "title": "Kerala"}]


def _mod(region: str):
    return REGION_MODULES.get(region, ww)


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

# 4-level traffic light (Tarun's framework) — used for the national bar + per-STP circles
MASK_LEVELS = {
    "green":  {"color": "#2E9E5B", "label": "Routine — masking optional"},
    "yellow": {"color": "#E0A100", "label": "Targeted masking"},
    "orange": {"color": "#F97316", "label": "Broad masking advised"},
    "red":    {"color": "#D7263D", "label": "Masking strongly advised"},
}
# domains not yet wired into the composite (shown as "pending feed")
PENDING_FEEDS = ["Hospital PCR (e.g. PGI Chandigarh)", "Clinical ILI/SARI", "Public-health alerts", "Operational pressure"]

# Preventive actions by masking colour (viral, adapted from the masking-policy framework)
# and illustrative NCD outreach. Advisory only.
PREVENTIVE = {
    "viral": {
        "green":  ["Masking optional in general areas", "Symptomatic individuals mask (source control)", "Promote hand hygiene & respiratory etiquette"],
        "yellow": ["Targeted masking in crowded / poorly-ventilated indoor settings", "Masks for staff in patient-facing roles", "Symptomatic individuals must mask; encourage testing"],
        "orange": ["Masking advised in all indoor public spaces", "Vulnerable groups avoid crowded settings", "Improve ventilation; widen testing in affected areas"],
        "red":    ["Masking strongly advised in all indoor settings", "N95/FFP2 for high-risk settings & aerosol-generating procedures", "Limit large indoor gatherings; isolate symptomatic cases"],
    },
    "ncd": [
        "Community awareness drives where alcohol/tobacco load is rising",
        "Target screening camps (diabetes/cardio) to high-load catchments",
        "Nutrition & diet outreach via local health workers",
        "Coordinate with the State NCD cell on lifestyle programmes",
    ],
    "note": "Advisory only — suggested preventive measures, not enforcement. NCD actions are illustrative.",
}


def _traffic_from_ratio(ratio: float) -> str:
    if ratio >= 2.1:
        return "red"
    if ratio >= 1.5:
        return "orange"
    if ratio >= 1.1:
        return "yellow"
    return "green"


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
        "traffic": {"level": _traffic_from_ratio(ratio), **MASK_LEVELS[_traffic_from_ratio(ratio)]},
        "drivers": [{"name": p["name"], "value": p["latest"], "color": p["color"]} for p in drivers],
        "rationale": f"Current respiratory positivity is {round(ratio, 2)}× the recent {len(window)}-week "
                     f"baseline (driven by {', '.join(p['name'] for p in drivers[:2])}).",
    }


# ── Per-site masking (simplified composite from data we have) ─────────────────
def _stp_masking(mod, stp_id: str) -> Dict[str, Any]:
    """Per-site traffic-light masking. For Chandigarh STPs: blend the wastewater
    signal with national ICMR (other composite domains PENDING). For Kerala
    districts (modules that expose `site_level`): the illustrative district
    outbreak level, annotated with national ICMR as context. Phase 2 wires the
    full weighted composite / real local feeds."""
    nat = _masking_from_icmr()
    ratio = nat.get("ratio", 0) or 0
    sig = mod.stp_signal(stp_id)  # baseline | watch | alert

    if hasattr(mod, "site_level"):  # district-level region (Kerala)
        level = mod.site_level(stp_id)
        score = getattr(mod, "LEVEL_SCORE", {}).get(level)
        return {
            "level": level, **MASK_LEVELS[level], "score": score,
            "drivers": [
                {"label": "District outbreak signal (IDSP-style, illustrative)", "value": sig},
                {"label": "ICMR national positivity", "value": f"{ratio}× baseline"},
            ],
            "pending": ["District wastewater (STP) feed", "Hospital PCR", "Lab-confirmed line lists"],
            "note": "Illustrative district outbreak signal, annotated with real national ICMR. "
                    "Local wastewater/lab feeds pending.",
        }

    vscore = {"baseline": 0.3, "watch": 1.6, "alert": 2.6}.get(sig, 0.3)   # 0–3
    nscore = 0.5 if ratio < 1.1 else 1.5 if ratio < 1.5 else 2.5            # 0–3
    score = round(0.65 * vscore + 0.35 * nscore, 2)
    level = "green" if score < 0.9 else "yellow" if score < 1.7 else "orange" if score < 2.3 else "red"
    return {
        "level": level, **MASK_LEVELS[level], "score": score,
        "drivers": [
            {"label": "STP wastewater signal", "value": sig},
            {"label": "ICMR national positivity", "value": f"{ratio}× baseline"},
        ],
        "pending": PENDING_FEEDS,
        "note": "Simplified composite (wastewater + ICMR). Hospital/clinical feeds pending.",
    }


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="JalDrishti", version="3.0.0")


@app.middleware("http")
async def _no_cache(request, call_next):
    """Force browsers to revalidate so a deploy is always picked up (no stale UI).
    ETag still yields 304s, so unchanged assets aren't re-downloaded."""
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


@app.get("/api/jd/meta")
def meta(region: str = "chandigarh"):
    mod = _mod(region)
    M = mod.META
    return {
        "program": "JalDrishti", "region": region, "regions": REGIONS,
        "title": M["title"], "location": M["location"], "site_label": M.get("site_label", "STP"),
        "illustrative": mod.ILLUSTRATIVE,
        "map_center": M["map_center"], "map_zoom": M["map_zoom"], "map_mode": M["map_mode"],
        "boundary_asset": M.get("boundary_asset"), "sectors_asset": M.get("sectors_asset"),
        "districts_asset": M.get("districts_asset"),
        "stp_count": len(mod.STPS),
        "pillars": mod.PILLARS,
        "markers": [{"id": m["id"], "name": m["name"], "color": m["color"],
                     "pillar": m["pillar"], "unit": m["unit"]} for m in mod.MARKERS],
        "unit": mod.VIRAL_UNIT, "thresholds": mod.VIRAL_THRESHOLDS, "ranges": list(RANGE_WEEKS.keys()),
        "signal_colors": SIGNAL_COLORS,
        "week_labels": mod.week_labels(),
        "masking": _masking_from_icmr(),
        "data_note": M.get("data_note", ""),
        "icmr_updated": _icmr().get("last_updated"),
    }


@app.get("/api/jd/stps")
def stps(region: str = "chandigarh"):
    mod = _mod(region)
    rows = mod.stp_list()
    for r in rows:
        r["masking"] = _stp_masking(mod, r["id"])
    return {"stps": rows, "thresholds": mod.VIRAL_THRESHOLDS, "mask_levels": MASK_LEVELS}


@app.get("/api/jd/stp/{stp_id}")
def stp(stp_id: str, region: str = "chandigarh"):
    mod = _mod(region)
    s = next((x for x in mod.STPS if x["id"] == stp_id), None)
    if not s:
        return {"error": "not found"}
    catchment = mod.catchment_km(s["population"]) if hasattr(mod, "catchment_km") and region == "chandigarh" else s.get("catchment_km")
    return {
        "id": s["id"], "name": s["name"], "area": s.get("area") or (s["name"] + " district"),
        "lat": s["lat"], "lng": s["lng"], "population": s["population"],
        "signal": mod.stp_signal(stp_id),
        "masking": _stp_masking(mod, stp_id),
        "catchment_km": catchment,
        "population_estimated": True,
        "level": s.get("level"), "geo": s.get("geo"),
        "markers": mod.stp_marker_summaries(stp_id),
        "unit": mod.VIRAL_UNIT,
    }


@app.get("/api/jd/series/{stp_id}/{marker_id}")
def series(stp_id: str, marker_id: str, range: str = "180", region: str = "chandigarh"):
    mod = _mod(region)
    vals = mod.series_for(stp_id, marker_id)
    labels = mod.week_labels()
    n = RANGE_WEEKS.get(range, 26)
    m = mod.marker(marker_id) or {}
    return {"stp": stp_id, "marker": marker_id, "name": m.get("name"), "color": m.get("color"),
            "pillar": m.get("pillar"), "illustrative": m.get("pillar") == "ncd",
            "unit": m.get("unit", mod.VIRAL_UNIT), "labels": labels[-n:], "values": vals[-n:]}


@app.get("/api/jd/predict/{stp_id}/{marker_id}")
def predict_series(stp_id: str, marker_id: str, range: str = "180", horizon: int = 8, region: str = "chandigarh"):
    mod = _mod(region)
    vals = mod.series_for(stp_id, marker_id)
    labels = mod.week_labels()
    n = RANGE_WEEKS.get(range, 26)
    m = mod.marker(marker_id) or {}
    fc = predict.forecast(vals, labels, horizon=horizon)
    fc["history"] = {"labels": labels[-n:], "values": [round(float(v), 1) for v in vals[-n:]]}
    fc["name"] = m.get("name")
    fc["color"] = m.get("color")
    fc["unit"] = m.get("unit", mod.VIRAL_UNIT)
    fc["pillar"] = m.get("pillar")
    if region == "kerala" or m.get("pillar") == "ncd":
        fc["illustrative"] = True
    if m.get("pillar") == "ncd":
        fc["note"] = (fc.get("note", "") + " — illustrative NCD sample data (no mass-spec feed yet).").strip()
    return fc


@app.get("/api/jd/chart-details/{stp_id}/{marker_id}")
def chart_details(stp_id: str, marker_id: str, region: str = "chandigarh"):
    mod = _mod(region)
    vals = mod.series_for(stp_id, marker_id)
    m = mod.marker(marker_id) or {}
    text = predict.chart_details(m.get("name", marker_id), vals)
    if region == "kerala":
        text += " (Illustrative district outbreak demo.)"
    elif m.get("pillar") == "ncd":
        text += " These NCD figures are illustrative sample data."
    return {"text": text}


@app.get("/api/jd/masking")
def masking():
    return _masking_from_icmr()


@app.get("/api/jd/preventive")
def preventive():
    return PREVENTIVE


@app.get("/api/jd/icmr")
def icmr():
    """Raw-ish ICMR recent data + the masking calculation, for the transparency page."""
    return {**_icmr_recent(), "masking": _masking_from_icmr(), "unit": "lab-confirmed positivity (count)"}


# SPA last so /api/* wins.
app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
