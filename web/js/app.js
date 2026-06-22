/* JalDrishti — wwscan-style two-view app (Map + Charts), Leaflet + ECharts.
   Map = STP catchment circles coloured by masking. Charts = per-marker forecasts.
   Wastewater = illustrative sample; masking = real ICMR. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const SLABEL = { baseline: "Low", watch: "Watch", alert: "High", none: "—" };
  const SCOL = { baseline: "#2E9E5B", watch: "#E0A100", alert: "#D7263D", none: "#C7D0DA" };
  const MASK_EMOJI = { green: "🙂", yellow: "😷", orange: "😷", red: "😷" };
  const api = (p) => {
    const sep = p.includes("?") ? "&" : "?";
    return fetch("/api/jd" + p + sep + "region=" + state.region).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  };

  const state = {
    region: "chandigarh",
    meta: null, stps: [], stp: null, pillar: "viral", range: "180", horizon: 8,
    view: "map", map: null, layers: {}, preventive: null, charts: {}, chartEls: [],
  };

  async function init() {
    try {
      wireControls();
      window.addEventListener("popstate", () => { const r = regionFromUrl(); if (r !== state.region) loadRegion(r, false).catch((e) => console.error(e)); });
      await loadRegion(regionFromUrl(), false);
      $("#loading").classList.add("hide");
    } catch (e) { $("#loading").textContent = "Could not load data (" + e + ")"; console.error(e); }
  }

  /* region from the URL: /kerala or /chandigarh path, or ?region=… query */
  function regionFromUrl() {
    const path = location.pathname.replace(/\/+$/, "").toLowerCase();
    if (path.endsWith("/kerala")) return "kerala";
    if (path.endsWith("/chandigarh")) return "chandigarh";
    return new URLSearchParams(location.search).get("region") === "kerala" ? "kerala" : "chandigarh";
  }

  /* load (or switch to) a region: Chandigarh STPs or Kerala districts.
     pushUrl=true updates the address bar so the link is shareable. */
  async function loadRegion(region, pushUrl = true) {
    if (pushUrl) { const u = region === "chandigarh" ? "/" : "/" + region; if (location.pathname !== u) history.pushState({ region }, "", u); }
    $("#loading").classList.remove("hide"); $("#loading").textContent = "Loading " + region + " data…";
    state.region = region;
    // tear down region-scoped state
    state.stp = null; state.layers = {};
    if (state.map) { try { state.map.remove(); } catch (e) {} state.map = null; }
    state.chartEls.forEach((c) => { try { c.dispose(); } catch (e) {} }); state.chartEls = []; state.charts = {};
    $("#stpInfo").hidden = true; $("#markerCards").innerHTML = ""; $("#cardPrevent").innerHTML = ""; $("#cardMasking").innerHTML = "";

    const [meta, stpData, preventive] = await Promise.all([api("/meta"), api("/stps"), api("/preventive")]);
    state.meta = meta; state.stps = stpData.stps; state.preventive = preventive;

    const rl = $("#regionLabel"); if (rl) rl.textContent = "📍 " + (meta.title || meta.location);
    document.title = "JalDrishti — " + (meta.title || meta.location) + " · Wastewater Surveillance";
    $("#ovTitle").textContent = meta.title || meta.location;
    $("#freshness").textContent = "ICMR: " + (meta.masking.source_week || "—");
    renderMaskCard(meta.masking);
    updateLegend(meta);
    await renderMap();

    const order = { alert: 3, watch: 2, baseline: 1, none: 0 };
    const def = state.stps.slice().sort((a, b) => (order[b.signal] || 0) - (order[a.signal] || 0) || (b.top_value || 0) - (a.top_value || 0))[0];
    if (def) await selectStp(def.id, false);
    showView(state.view);
    $("#loading").classList.add("hide");
  }

  /* legend text depends on the region's map mode */
  function updateLegend(meta) {
    const el = document.querySelector(".map__legend .masknote");
    if (!el) return;
    el.innerHTML = meta.map_mode === "districts"
      ? "Blocks = Kerala districts · colour = area risk → 🏥 recommended <b>hospital</b> masking (illustrative outbreak + real national ICMR) · click a district to drill in"
      : "Blocks = STP catchment regions (estimated, nearest-STP) · colour = area risk → 🏥 recommended <b>hospital</b> masking · grey lines = Chandigarh sectors · click a block to drill in";
  }

  /* ---- national masking card ---- */
  function renderMaskCard(m) {
    const t = m.traffic || { level: "green", label: m.label };
    const lvl = (t.label || "").replace(/^Hospitals\s*[—-]\s*/i, ""); // strip prefix; header already says "Hospital"
    $("#maskcard").className = "maskcard maskcard--" + t.level;
    $("#maskcard").innerHTML =
      `<div class="maskcard__top"><span class="ic">🏥</span> Hospital masking advisory: ${esc(lvl)}</div>
       <p class="maskcard__scope">For hospitals &amp; healthcare facilities — not a public / region-wide mandate.</p>
       <p class="maskcard__why">${esc(m.rationale || m.note || "")}</p>
       <a class="maskcard__more" href="masking.html">How is this calculated? →</a>`;
  }

  /* ---- map (animated STP catchment circles) ---- */
  async function renderMap() {
    const mode = state.meta.map_mode;
    const z = mode === "districts" ? { minZoom: 6, maxZoom: 11 } : { minZoom: 11, maxZoom: 15 };
    const map = L.map("map", { zoomControl: true, scrollWheelZoom: true, zoomSnap: 0.25, ...z }).setView(state.meta.map_center, state.meta.map_zoom);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 19 }).addTo(map);
    state.map = map;
    if (mode === "districts") return renderDistrictMap(map);
    return renderVoronoiMap(map);
  }

  /* Kerala: real district polygons coloured by (illustrative) masking level */
  async function renderDistrictMap(map) {
    let gj = null;
    try { gj = await fetch(state.meta.districts_asset).then((r) => r.json()); } catch (e) { console.warn("districts load failed", e); }
    const byGeo = {}; state.stps.forEach((s) => { byGeo[s.geo || s.name] = s; });

    const layer = L.geoJSON(gj, {
      style: (f) => { const s = byGeo[f.properties.name]; const col = (s && s.masking && s.masking.color) || "#C7D0DA"; return { color: "#ffffff", weight: 1.2, fillColor: col, fillOpacity: 0.5, lineJoin: "round" }; },
      onEachFeature: (f, lyr) => {
        const s = byGeo[f.properties.name]; if (!s) return;
        const tip = `<b>${esc(s.name)}</b> · ${(s.masking ? s.masking.label : SLABEL[s.signal])}<br/>~${Number(s.population).toLocaleString("en-IN")} people (est.)`;
        lyr.bindTooltip(tip, { sticky: true }).on("click", () => selectStp(s.id));
        state.layers[s.id] = { poly: lyr, color: (s.masking && s.masking.color) };
      },
    }).addTo(map);

    // district centre pins (pulse on elevated)
    state.stps.forEach((s) => {
      const col = (s.masking && s.masking.color) || SCOL[s.signal];
      const lvl = (s.masking && s.masking.level) || "green";
      const pulseCls = (lvl === "orange" || lvl === "red") ? " stp-pulse stp-pulse--" + lvl : "";
      const dot = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: "stp-pinwrap", html: `<div class="stp-pin${pulseCls}" style="background:${col};color:${col}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
        zIndexOffset: 1000,
      }).addTo(map);
      dot.bindTooltip(`<b>${esc(s.name)}</b> · ${(s.masking ? s.masking.label : SLABEL[s.signal])}`, { direction: "top" }).on("click", () => selectStp(s.id));
      (state.layers[s.id] = state.layers[s.id] || {}).dot = dot;
    });

    const b = layer.getBounds && layer.getBounds();
    setTimeout(() => { if (b && b.isValid()) { map.fitBounds(b.pad(0.04)); map.setMaxBounds(b.pad(0.4)); } map.invalidateSize(); }, 180);
  }

  /* Chandigarh: nearest-STP Voronoi blocks clipped to the city + sector grid */
  async function renderVoronoiMap(map) {
    // real Chandigarh administrative boundary (OSM) — clip blocks to the city shape
    let boundary = null; // Polygon coords [[ring]] in [lng,lat]
    try {
      const gj = await fetch("assets/chandigarh-boundary.geojson").then((r) => r.json());
      boundary = gj.geometry.type === "MultiPolygon" ? gj.geometry.coordinates[0] : gj.geometry.coordinates;
    } catch (e) { console.warn("boundary load failed", e); }

    // nearest-STP regions (Voronoi) clipped to a padded bbox, then to the city boundary
    const pts = state.stps.map((s) => [s.lng, s.lat]);
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1]), pad = 0.04;
    const bbox = [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
    let voronoi = null;
    try { voronoi = (window.d3 && d3.Delaunay) ? d3.Delaunay.from(pts).voronoi(bbox) : null; } catch (e) { console.warn("voronoi failed", e); }

    const toLL = ([lng, lat]) => [lat, lng];
    let fitBounds = boundary ? L.latLngBounds(boundary[0].map(toLL)) : L.latLngBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);

    state.stps.forEach((s, i) => {
      const col = (s.masking && s.masking.color) || SCOL[s.signal];
      const lvl = (s.masking && s.masking.level) || "green";
      const tip = `<b>${esc(s.name)}</b> · ${(s.masking ? s.masking.label : SLABEL[s.signal])}<br/>~${Number(s.population).toLocaleString("en-IN")} people (est.) · ${s.catchment_km} km catchment`;

      // region block coloured by masking, clipped to the city boundary
      let poly = null, latlngs = null;
      const cell = voronoi ? voronoi.cellPolygon(i) : null; // closed ring [[lng,lat],...]
      if (cell && boundary && window.polygonClipping) {
        try {
          const clipped = polygonClipping.intersection([cell], boundary); // MultiPolygon
          if (clipped && clipped.length) latlngs = clipped.map((pg) => pg.map((ring) => ring.map(toLL)));
        } catch (e) { console.warn("clip failed", s.id, e); }
      }
      if (!latlngs && cell) latlngs = cell.map(toLL); // unclipped Voronoi fallback
      if (latlngs) {
        poly = L.polygon(latlngs, { color: "#ffffff", weight: 1.3, fillColor: col, fillOpacity: 0.34, lineJoin: "round", className: "stp-region" }).addTo(map);
      } else {
        poly = L.circle([s.lat, s.lng], { radius: (s.catchment_km || 2) * 1000, color: col, weight: 1.5, fillColor: col, fillOpacity: 0.18 }).addTo(map); // last-resort
      }
      poly.bindTooltip(tip, { sticky: true }).on("click", () => selectStp(s.id));

      // polished STP marker (white ring + soft shadow; pulse when elevated)
      const pulseCls = (lvl === "orange" || lvl === "red") ? " stp-pulse stp-pulse--" + lvl : "";
      const dot = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: "stp-pinwrap", html: `<div class="stp-pin${pulseCls}" style="background:${col};color:${col}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
        zIndexOffset: 1000,
      }).addTo(map);
      dot.bindTooltip(tip, { direction: "top" }).on("click", () => selectStp(s.id));

      state.layers[s.id] = { poly, dot, color: col };
    });

    // faint Chandigarh sector grid for context (non-interactive, clicks pass through to regions)
    try {
      const sectors = await fetch("assets/chandigarh-sectors.geojson").then((r) => r.json());
      L.geoJSON(sectors, { style: { color: "#334155", weight: 1, opacity: 0.6, fill: false }, interactive: false }).addTo(map);
    } catch (e) { console.warn("sectors load failed", e); }

    // subtle city outline on top
    if (boundary) L.polygon(boundary.map((ring) => ring.map(toLL)), { color: "#0E6BA8", weight: 1.5, opacity: 0.5, fill: false, interactive: false, dashArray: "1 0" }).addTo(map);

    setTimeout(() => { map.fitBounds(fitBounds.pad(0.04)); map.setMaxBounds(fitBounds.pad(0.5)); map.invalidateSize(); }, 180);
  }

  /* highlight the selected region block */
  function highlightStp(id) {
    Object.entries(state.layers).forEach(([k, l]) => {
      if (l.poly && l.poly.setStyle) {
        l.poly.setStyle({ fillOpacity: k === id ? 0.52 : 0.22, weight: k === id ? 3 : 2 });
        if (k === id && l.poly.bringToFront) l.poly.bringToFront();
      }
    });
  }

  function fitAll() { if (state.map) state.map.flyToBounds(L.latLngBounds(state.stps.map((s) => [s.lat, s.lng])).pad(0.5)); }

  /* ---- select an STP ---- */
  async function selectStp(id, fly = true) {
    const meta = state.stps.find((x) => x.id === id);
    const flyZoom = state.meta && state.meta.map_mode === "districts" ? 8.5 : 13;
    if (fly && state.map && meta) state.map.flyTo([meta.lat, meta.lng], flyZoom, { duration: 0.6 });
    const s = await api("/stp/" + id);
    state.stp = s;
    $("#ovTitle").textContent = s.name;
    $("#backAll").hidden = false;
    highlightStp(id);
    renderStpInfo(s);
    renderMarkerCards();
    renderPrevent();
    renderMaskingDetails();
    if (state.view === "charts") renderCharts();
  }

  function renderStpInfo(s) {
    const m = s.masking || {};
    const box = $("#stpInfo"); box.hidden = false;
    const isDistrict = state.meta.map_mode === "districts";
    const cell2 = isDistrict
      ? `<div><div class="l">District</div><div class="v">${esc(s.area || s.name)}</div></div>`
      : `<div><div class="l">Catchment</div><div class="v">~${s.catchment_km} km <span class="est">(est.)</span></div></div>`;
    box.innerHTML = `
      <h3>${esc(s.name)} <span class="pill pill--${level2sig(m.level)}"><span class="dot"></span>${esc(m.label || "—")}</span></h3>
      <div class="grid">
        <div><div class="l">Population</div><div class="v">${Number(s.population).toLocaleString("en-IN")} <span class="est">(est.)</span></div></div>
        ${cell2}
        <div><div class="l">Latitude</div><div class="v">${s.lat.toFixed(4)}</div></div>
        <div><div class="l">Longitude</div><div class="v">${s.lng.toFixed(4)}</div></div>
      </div>
      <div class="pending est">Masking details &amp; preventive actions below the map ↓</div>`;
  }

  /* ---- marker cards (wwscan-style) ---- */
  function renderMarkerCards() {
    const s = state.stp; if (!s) return;
    $("#ncdNote").hidden = state.pillar !== "ncd";
    const ms = s.markers.filter((m) => (m.pillar || "viral") === state.pillar);
    const wrap = $("#markerCards"); wrap.innerHTML = "";
    let lastCat = null;
    ms.forEach((m) => {
      const cat = m.category || "Other";
      if (state.pillar === "viral" && cat !== lastCat) {
        lastCat = cat;
        const h = document.createElement("div"); h.className = "cat-head"; h.textContent = cat;
        wrap.appendChild(h);
      }
      const tag = m.panel ? `<span class="panel-tag">${esc(m.panel)}</span>` : "";
      const prio = m.priority ? `<span class="prio-tag">PRIORITY</span>` : "";
      const c = document.createElement("div");
      c.className = "mkcard" + (m.priority ? " mkcard--priority" : ""); c.dataset.id = m.id;
      c.innerHTML = `
        <div class="mkcard__top"><span class="mkcard__name">${tag}${esc(m.name)}${prio}</span>
          <span class="pill pill--${m.status}"><span class="dot"></span>${SLABEL[m.status]}</span></div>
        <div class="mkcard__row"><span class="mkcard__val">${m.current} <small>${esc(m.unit)}</small></span>${spark(m.spark, m.color)}</div>`;
      c.addEventListener("click", () => { showView("charts"); setTimeout(() => { const el = document.getElementById("ch-" + m.id); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60); });
      wrap.appendChild(c);
    });
  }

  /* ---- bottom card 1: preventive actions ---- */
  function renderPrevent() {
    const pv = state.preventive; if (!pv || !state.stp) return;
    const lvl = (state.stp.masking && state.stp.masking.level) || "green";
    const viral = pv.viral[lvl] || pv.viral.green;
    $("#cardPrevent").innerHTML = `
      <h3>🛡️ Preventive measures <span class="pill pill--${level2sig(lvl)}" style="margin-left:auto"><span class="dot"></span>${lvl}</span></h3>
      <div class="sub">🏥 Hospital masking &amp; infection control</div>
      <ul>${viral.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <div class="sub">🧪 NCD &amp; Lifestyle (illustrative)</div>
      <ul>${pv.ncd.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="note">${esc(pv.note)}</p>`;
  }

  /* ---- bottom card 2: masking details (per-STP composite) ---- */
  function renderMaskingDetails() {
    const s = state.stp; if (!s) return;
    const m = s.masking || {};
    const formula = state.meta.map_mode === "districts"
      ? `This district's level is an <b>illustrative IDSP-style outbreak signal</b>, annotated with <b>real national ICMR</b> positivity. Demo only — local wastewater/lab feeds pending.`
      : `This STP's masking value is a <b>concatenation of wastewater testing + ICMR</b>. Illustrative for now — wastewater values are sample data; ICMR positivity is real.`;
    $("#cardMasking").innerHTML = `
      <h3>🧮 Masking details <span class="pill pill--${level2sig(m.level)}" style="margin-left:auto"><span class="dot"></span>${esc(m.label || m.level)}</span></h3>
      <div class="mask-scope">🏥 Guides masking posture for <b>hospitals</b> in this area — not a public / region-wide mandate.</div>
      <div class="formula">${formula}</div>
      <div class="sub">Inputs used</div>
      ${(m.drivers || []).map((d) => `<div class="mrow"><span class="l">${esc(d.label)}</span><span class="v">${esc(d.value)}</span></div>`).join("")}
      <div class="mrow"><span class="l">Composite level</span><span class="v">${esc(m.level)}${m.score != null ? " · score " + m.score : ""}</span></div>
      <div class="sub" style="margin-top:10px">Pending feeds (Phase 2)</div>
      <p class="note">${(m.pending || []).join(" · ")}</p>
      <a class="maskcard__more" href="masking.html" style="color:var(--primary);text-decoration:underline">Full national masking method →</a>`;
  }

  /* ---- charts view ---- */
  async function renderCharts() {
    const s = state.stp; if (!s) return;
    $("#chartsTitle").textContent = s.name + " — marker trends";
    $("#chartsSub").textContent = (state.pillar === "ncd" ? "NCD & Lifestyle · illustrative" : "Viral & Pathogen") + " · forecast band marked Predicted";
    const ms = s.markers.filter((m) => (m.pillar || "viral") === state.pillar);
    // dispose old charts
    state.chartEls.forEach((c) => { try { c.dispose(); } catch (e) {} });
    state.chartEls = [];
    const grid = $("#chartsGrid"); grid.innerHTML = "";
    // fetch predicts in parallel
    const data = await Promise.all(ms.map((m) => api(`/predict/${s.id}/${m.id}?range=${state.range}&horizon=12`).then((d) => ({ m, d })).catch(() => null)));
    let lastCat = null;
    data.filter(Boolean).forEach(({ m, d }) => {
      const cat = m.category || "Other";
      if (state.pillar === "viral" && cat !== lastCat) {
        lastCat = cat;
        const h = document.createElement("div"); h.className = "cat-head cat-head--charts"; h.textContent = cat;
        grid.appendChild(h);
      }
      const card = document.createElement("div");
      card.className = "chcard" + (m.priority ? " chcard--priority" : ""); card.id = "ch-" + m.id;
      card.innerHTML = `<div class="chcard__head"><span class="chcard__name">${m.panel ? `<span class="panel-tag">${esc(m.panel)}</span>` : ""}${esc(m.name)}${m.priority ? `<span class="prio-tag">PRIORITY</span>` : ""}</span><span class="chcard__unit">${esc(d.unit)}</span></div>
        <div class="chcard__chart" id="cc-${m.id}"></div>
        <div class="chcard__note" id="cn-${m.id}"></div>
        <button class="btn btn--sm" data-det="${m.id}" type="button" style="margin-top:8px">View Chart Details</button>
        <div class="chcard__details" id="cd-${m.id}" hidden></div>`;
      grid.appendChild(card);
      const chart = echarts.init(card.querySelector(".chcard__chart"), null, { renderer: "svg" });
      state.chartEls.push(chart); state.charts[m.id] = d;
      drawMarkerChart(chart, d, state.horizon, $("#cn-" + m.id));
      card.querySelector("[data-det]").addEventListener("click", async (e) => {
        const box = $("#cd-" + m.id);
        if (box.hidden) { box.hidden = false; e.target.textContent = "Hide Chart Details"; box.textContent = "…"; try { box.textContent = (await api(`/chart-details/${s.id}/${m.id}`)).text; } catch { box.textContent = "Details unavailable."; } }
        else { box.hidden = true; e.target.textContent = "View Chart Details"; }
      });
    });
  }

  function redrawCharts() {
    // horizon change → redraw each chart from its cached predict (no refetch)
    state.chartEls.forEach((chart) => {
      const id = chart.getDom().id.replace("cc-", "");
      const d = state.charts[id];
      if (d) drawMarkerChart(chart, d, state.horizon, $("#cn-" + id));
    });
  }

  function drawMarkerChart(chart, d, N, noteEl) {
    const color = d.color || "#0E6BA8";
    const hV = d.history.values, hL = d.history.labels, H = hV.length;
    const fV = d.forecast.values.slice(0, N), fL = d.forecast.labels.slice(0, N);
    const fLo = d.forecast.lower.slice(0, N), fHi = d.forecast.upper.slice(0, N);
    const x = hL.concat(fL);
    const histLine = hV.concat(Array(N).fill(null));
    const fcLine = Array(Math.max(0, H - 1)).fill(null).concat(H ? [hV[H - 1]] : [], fV);
    const lowBase = Array(Math.max(0, H - 1)).fill(null).concat(H ? [hV[H - 1]] : [], fLo);
    const band = Array(Math.max(0, H - 1)).fill(null).concat(H ? [0] : [], fHi.map((v, i) => v - fLo[i]));
    chart.setOption({
      grid: { left: 34, right: 10, top: 10, bottom: 22 },
      tooltip: { trigger: "axis", backgroundColor: "#0E1B2E", borderWidth: 0, textStyle: { color: "#fff", fontSize: 11 } },
      xAxis: { type: "category", data: x, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: "#E5EBF1" } }, axisLabel: { color: "#6B7C92", fontSize: 9, hideOverlap: true } },
      yAxis: { type: "value", min: 0, splitLine: { lineStyle: { color: "#EEF2F7" } }, axisLabel: { color: "#6B7C92", fontSize: 9 } },
      series: [
        { type: "line", data: lowBase, stack: "b", lineStyle: { opacity: 0 }, symbol: "none", silent: true, areaStyle: { color: "transparent" } },
        { type: "line", data: band, stack: "b", lineStyle: { opacity: 0 }, symbol: "none", silent: true, areaStyle: { color, opacity: 0.13 } },
        { name: d.name, type: "line", data: histLine, symbol: "none", lineStyle: { color, width: 2 }, areaStyle: { color, opacity: 0.06 },
          markLine: H ? { silent: true, symbol: "none", label: { formatter: "now", color: "#6B7C92", fontSize: 9 }, lineStyle: { color: "#9AA8BC", type: "dashed" }, data: [{ xAxis: hL[H - 1] }] } : undefined },
        { name: "Predicted", type: "line", data: fcLine, symbol: "none", lineStyle: { color, width: 2, type: "dashed" } },
      ],
    }, true);
    if (noteEl) noteEl.innerHTML = N > 0 ? `<span class="tag">PREDICTED</span> next ${N} wk` : `<span class="muted">slide right to forecast</span>`;
  }

  /* ---- views + controls ---- */
  function showView(v) {
    state.view = v;
    $("#viewMap").classList.toggle("active", v === "map");
    $("#viewCharts").classList.toggle("active", v === "charts");
    $("#paneMap").hidden = v !== "map";
    $("#paneCharts").hidden = v !== "charts";
    if (v === "map" && state.map) setTimeout(() => state.map.invalidateSize(), 50);
    if (v === "charts") renderCharts();
  }

  function wireControls() {
    $("#viewMap").addEventListener("click", () => showView("map"));
    $("#viewCharts").addEventListener("click", () => showView("charts"));
    $("#backAll").addEventListener("click", fitAll);
    $("#pillarTabs").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        state.pillar = b.dataset.pillar;
        $("#pillarTabs").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        renderMarkerCards();
        if (state.view === "charts") renderCharts();
      }));
    $("#rangeChips").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        state.range = b.dataset.r;
        $("#rangeChips").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        if (state.view === "charts") renderCharts();
      }));
    $("#horizon").addEventListener("input", (e) => { state.horizon = +e.target.value; redrawCharts(); });
    window.addEventListener("resize", () => { state.map && state.map.invalidateSize(); state.chartEls.forEach((c) => c.resize()); });
  }

  /* ---- utils ---- */
  function level2sig(lvl) { return lvl === "red" ? "alert" : lvl === "orange" || lvl === "yellow" ? "watch" : "baseline"; }
  function spark(data, color) {
    if (!data || !data.length) return "";
    const w = 80, h = 24, min = Math.min(...data), max = Math.max(...data), sp = max - min || 1, st = w / (data.length - 1);
    const dd = data.map((v, i) => `${i ? "L" : "M"}${(i * st).toFixed(1)} ${(h - 3 - ((v - min) / sp) * (h - 6)).toFixed(1)}`).join(" ");
    return `<svg width="${w}" height="${h}"><path d="${dd}" fill="none" stroke="${color || "#0E6BA8"}" stroke-width="1.6"/></svg>`;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  window.jalDrishti = { selectStp, showView };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
