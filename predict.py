"""Lightweight, dependency-free forecaster + plain-language chart summaries.

Deliberately simple and explainable (no Prophet/statsmodels/numpy): a damped
linear trend blended with a seasonal-naive term when enough history exists, plus
a residual-based confidence band that widens with horizon. The future portion is
always clearly marked "Predicted" by the caller — we do not overclaim accuracy.
"""
from __future__ import annotations

import math
import re
from typing import List, Dict, Any


def _slope_intercept(ys: List[float]) -> tuple[float, float]:
    """Least-squares line y = a + b*x over x = 0..n-1."""
    n = len(ys)
    if n < 2:
        return (ys[0] if ys else 0.0), 0.0
    xs = list(range(n))
    mx = sum(xs) / n
    my = sum(ys) / n
    denom = sum((x - mx) ** 2 for x in xs) or 1.0
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
    a = my - b * mx
    return a, b


def _next_labels(labels: List[str], horizon: int) -> List[str]:
    """Generate future ISO-week labels by continuing the last one.

    Handles ICMR formats like 'Wk 3 · 2026' or '18 / 2026'. Falls back to
    'F+1, F+2 …' if no week/year can be parsed.
    """
    out: List[str] = []
    last = labels[-1] if labels else ""
    nums = re.findall(r"\d+", last)
    if len(nums) >= 2:
        wk, yr = int(nums[0]), int(nums[-1])
        sep = "·" if "·" in last else "/"
        for _ in range(horizon):
            wk += 1
            if wk > 52:
                wk = 1
                yr += 1
            out.append(f"Wk {wk} {sep} {yr}" if sep == "·" else f"{wk} / {yr}")
    else:
        out = [f"F+{i+1}" for i in range(horizon)]
    return out


def forecast(values: List[float], labels: List[str], horizon: int = 8) -> Dict[str, Any]:
    """Return history echo + a forecast with a confidence band.

    Output: {history:{labels,values}, forecast:{labels,values,lower,upper},
             method, note}
    """
    vals = [float(v) for v in values if v is not None]
    n = len(vals)
    if n == 0:
        return {"history": {"labels": [], "values": []},
                "forecast": {"labels": [], "values": [], "lower": [], "upper": []},
                "method": "no-data", "note": "No history available."}

    win = min(12, n)
    recent = vals[-win:]
    a, b = _slope_intercept(recent)
    base = a + b * (win - 1)  # fitted value at last point

    # residual std around the recent linear fit → band width
    resid = [recent[i] - (a + b * i) for i in range(win)]
    var = sum(r * r for r in resid) / max(1, win - 1)
    std = math.sqrt(var) if var > 0 else max(1.0, 0.1 * (base or 1.0))

    has_season = n >= 104  # ≥ ~2 years of weekly data
    damp = 0.92
    fvals: List[float] = []
    lower: List[float] = []
    upper: List[float] = []
    for i in range(1, horizon + 1):
        linear = base + b * i * (damp ** (i - 1))
        if has_season and n - 52 + (i - 1) >= 0:
            seasonal = vals[n - 52 + (i - 1)]
            point = 0.6 * linear + 0.4 * seasonal
        else:
            point = linear
        point = max(0.0, point)
        widen = 1.0 + 0.18 * (i - 1)
        margin = 1.5 * std * widen
        fvals.append(round(point, 2))
        lower.append(round(max(0.0, point - margin), 2))
        upper.append(round(point + margin, 2))

    method = "damped linear trend + seasonal-naive" if has_season else "damped linear trend"
    note = ("Predicted from {n} weeks of history using a {m}. Indicative only — "
            "not a clinical forecast.").format(n=n, m=method)
    return {
        "history": {"labels": list(labels), "values": [round(float(v), 2) for v in vals]},
        "forecast": {"labels": _next_labels(labels, horizon), "values": fvals,
                     "lower": lower, "upper": upper},
        "method": method,
        "note": note,
    }


def chart_details(common: str, values: List[float]) -> str:
    """Plain-language overview of a pathogen trend for non-technical readers."""
    vals = [float(v) for v in values if v is not None]
    if len(vals) < 3:
        return f"Not enough recent data to summarise {common}."
    recent = vals[-6:]
    rises = sum(1 for i in range(1, len(recent)) if recent[i] > recent[i - 1])
    cur = vals[-1]
    prev = vals[-2]
    direction = "risen" if cur > prev else "fallen" if cur < prev else "held steady"
    peak = max(vals)
    # weeks since a value as high as current (excluding current)
    higher_ago = None
    for back in range(2, len(vals) + 1):
        if vals[-back] >= cur and cur > 0:
            higher_ago = back - 1
            break
    parts = [
        f"{common} level has {direction} in the latest week "
        f"({prev:.0f} → {cur:.0f}).",
        f"It rose in {rises} of the last {len(recent) - 1} weeks.",
    ]
    if cur >= peak and cur > 0:
        parts.append("The current week is the highest in the available history.")
    elif higher_ago:
        parts.append(f"This is the highest level in about {higher_ago} week(s).")
    return " ".join(parts)
