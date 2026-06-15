# JalDrishti — Wastewater Surveillance (Chandigarh)

A clean, **map-first** wastewater-surveillance demo for Chandigarh:

- **Map** = the city's **STP (water-collection) points**, each coloured by its wastewater signal
  (baseline / watch / alert). Wastewater values are **illustrative WastewaterSCAN-style sample data**
  (dummy numbers placed on the real STPs to demonstrate the flow — clearly labelled in the UI).
- **Click an STP** → its markers (SARS-CoV-2, Influenza A, RSV, Norovirus, Hepatitis A), a trend
  chart with **30 / 60 / 180-day** ranges and a **past↔future forecast** (shaded band, marked
  *Predicted*), "View Chart Details", and CSV download.
- **Masking advisory** = derived from **real ICMR** influenza positivity (national), shown as a
  top banner and explained ("current positivity vs recent baseline").

Self-contained: own FastAPI server, the SPA, a pure-Python forecaster, and a bundled ICMR snapshot.
No DB, no auth, no scraping. **Independent of the EpiCommand project.**

## Run locally
```bash
pip install -r requirements.txt
uvicorn app:app --port 8080      # open http://localhost:8080/
```

## Deploy
`Procfile` runs `uvicorn app:app --host 0.0.0.0 --port $PORT`. Push to Railway/any host — no extra config.

## Layout
```
app.py            FastAPI: serves the SPA + public /api/jd/* (STP data + ICMR masking)
wastewater.py     Chandigarh STP definitions + WastewaterSCAN-style sample series (dummy)
predict.py        pure-Python forecaster + plain-language chart summary
data/icmr_influenza/latest.json   real ICMR snapshot (drives the masking advisory)
web/              SPA: Leaflet map (vendored) + ECharts charts (vendored)
_old-showcase/    the previous static showcase site (kept for reference)
```

## Swapping in live data
- **Wastewater:** replace `wastewater.series_for()` with a real WastewaterSCAN / CDC NWSS feed.
- **Masking:** `app.py::_masking_from_icmr()` already reads ICMR; point it at a live ICMR export to
  keep it current.

## Notes / TODO
- STP coordinates are approximate; map basemap tiles load from CARTO (internet needed).
- Map currently shows the latest snapshot; animating across past weeks needs a historical feed.
- Bilingual EN/हिं and Chandigarh sector overlays are future additions.

*Wastewater numbers are illustrative sample data; masking reflects real ICMR data and is advisory only.*
