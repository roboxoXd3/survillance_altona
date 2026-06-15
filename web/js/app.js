/* JalDrishti — STP wastewater map (Leaflet) + marker forecast (ECharts).
   Reads /api/jd/*. Wastewater = illustrative sample; masking = real ICMR. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const COLORS = { baseline: "#2E9E5B", watch: "#E0A100", alert: "#D7263D", none: "#C7D0DA" };
  const SLABEL = { baseline: "Baseline", watch: "Watch", alert: "Alert", none: "No data" };
  const MASK_EMOJI = { not_required: "🙂", suggested: "😷", strongly_advised: "😷" };
  const api = (p) => fetch("/api/jd" + p).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });

  const state = { meta: null, stp: null, marker: null, range: "180", horizon: 8, predict: null, chart: null };

  async function init() {
    try {
      const [meta, stpData] = await Promise.all([api("/meta"), api("/stps")]);
      state.meta = meta;
      renderMaskbar(meta.masking);
      renderFreshness(meta);
      renderMap(stpData.stps, meta);
      wireControls();
      $("#loading").classList.add("hide");
    } catch (e) {
      $("#loading").textContent = "Could not load data (" + e + ")"; console.error(e);
    }
  }

  function renderFreshness(meta) {
    $("#freshness").textContent = "ICMR: " + (meta.masking.source_week || "—");
    $("#mapAsOf").textContent = "Illustrative WastewaterSCAN-style sample data · masking from ICMR";
    $("#dataSrc").innerHTML =
      "<b>Map / wastewater:</b> illustrative sample (WastewaterSCAN-style) on " + meta.stp_count +
      " Chandigarh STPs.<br/><b>Masking:</b> real ICMR influenza positivity (national).";
  }

  function renderMaskbar(m) {
    const bar = $("#maskbar");
    bar.className = "maskbar maskbar--" + (m.level || "not_required");
    bar.innerHTML = `<span class="ic">${MASK_EMOJI[m.level] || "🙂"}</span>
      <b>Masking advisory: ${m.label || "—"}.</b>
      <span>${m.rationale || m.note || ""}</span>
      <a class="maskbar__more" href="masking.html">How is this calculated? →</a>
      <span class="src">Source: ${m.source || "ICMR"}${m.source_week ? " · wk " + m.source_week : ""}</span>`;
  }

  /* ------------------------------------------------------------- map ------ */
  function renderMap(stps, meta) {
    const map = L.map("map", { zoomControl: true, scrollWheelZoom: true })
      .setView(meta.map_center, meta.map_zoom);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap, © CARTO", subdomains: "abcd", maxZoom: 19,
    }).addTo(map);

    stps.forEach((s) => {
      const r = 11 + Math.round((s.top_value || 0) / 12);
      const mk = L.circleMarker([s.lat, s.lng], {
        radius: r, color: "#fff", weight: 2, fillColor: COLORS[s.signal] || COLORS.none, fillOpacity: 0.9,
      }).addTo(map);
      mk.bindTooltip(`<b>${s.name}</b> · ${SLABEL[s.signal]}<br/>top: ${s.top_marker} (${s.top_value})`, { direction: "top" });
      mk.bindTooltip(s.name, { permanent: true, direction: "right", className: "stp-label", offset: [8, 0] });
      mk.on("click", () => openStp(s.id));
    });
    setTimeout(() => map.invalidateSize(), 200);
    state.map = map;
  }

  /* ------------------------------------------------------- STP detail ---- */
  async function openStp(id) {
    const card = $("#stpCard"); card.hidden = false;
    card.innerHTML = "<p class='muted'>Loading…</p>";
    try {
      const s = await api("/stp/" + id);
      state.stp = s;
      card.innerHTML = `
        <div class="stp__head"><h2>${esc(s.name)}</h2>
          <span class="pill pill--${s.signal}"><span class="dot"></span>${SLABEL[s.signal]}</span></div>
        <div class="stp__sub">${esc(s.area)} · ~${Number(s.population).toLocaleString("en-IN")} people served · ${esc(s.unit)}</div>
        <div id="mkList"></div>`;
      const list = card.querySelector("#mkList");
      s.markers.forEach((m) => {
        const row = document.createElement("div");
        row.className = "mk"; row.dataset.id = m.id;
        row.innerHTML = `<span class="dot" style="width:9px;height:9px;border-radius:50%;background:${COLORS[m.status]}"></span>
          <span class="mk__name">${esc(m.name)}</span>${spark(m.spark, m.color)}<span class="mk__val">${m.current}</span>`;
        row.addEventListener("click", () => selectMarker(m.id));
        list.appendChild(row);
      });
      // marker chips in the trend card
      const chips = $("#markerChips"); chips.innerHTML = "";
      s.markers.forEach((m) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = m.name; b.dataset.id = m.id;
        b.addEventListener("click", () => selectMarker(m.id)); chips.appendChild(b);
      });
      $("#trendCard").hidden = false;
      const worst = s.markers.slice().sort((a, b) => b.current - a.current)[0];
      selectMarker((worst || s.markers[0]).id);
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { card.innerHTML = "<p class='muted'>Couldn't load this STP.</p>"; }
  }

  function selectMarker(id) {
    state.marker = id;
    $("#markerChips").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.id === id));
    $("#stpCard").querySelectorAll(".mk").forEach((r) => r.classList.toggle("active", r.dataset.id === id));
    renderTrend();
  }

  /* ----------------------------------------------------------- trend ----- */
  async function renderTrend() {
    if (!state.stp || !state.marker) return;
    state.predict = await api(`/predict/${state.stp.id}/${state.marker}?range=${state.range}&horizon=12`);
    $("#trendTitle").textContent = state.predict.name + " · " + state.stp.name;
    $("#trendSrc").textContent = state.predict.unit;
    drawTrend();
    if (!$("#detailsText").hidden) loadDetails();
  }

  function drawTrend() {
    const d = state.predict; if (!d) return;
    if (!state.chart) state.chart = echarts.init($("#trendChart"), null, { renderer: "svg" });
    const color = d.color || "#0E6BA8", N = state.horizon;
    const hV = d.history.values, hL = d.history.labels, H = hV.length;
    const fV = d.forecast.values.slice(0, N), fL = d.forecast.labels.slice(0, N);
    const fLo = d.forecast.lower.slice(0, N), fHi = d.forecast.upper.slice(0, N);
    const x = hL.concat(fL);
    const histLine = hV.concat(Array(N).fill(null));
    const fcLine = Array(Math.max(0, H - 1)).fill(null).concat(H ? [hV[H - 1]] : [], fV);
    const lowBase = Array(Math.max(0, H - 1)).fill(null).concat(H ? [hV[H - 1]] : [], fLo);
    const band = Array(Math.max(0, H - 1)).fill(null).concat(H ? [0] : [], fHi.map((v, i) => v - fLo[i]));
    state.chart.setOption({
      grid: { left: 36, right: 12, top: 14, bottom: 24 },
      tooltip: { trigger: "axis", backgroundColor: "#0E1B2E", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 } },
      xAxis: { type: "category", data: x, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: "#E5EBF1" } }, axisLabel: { color: "#6B7C92", fontSize: 10, hideOverlap: true } },
      yAxis: { type: "value", max: 100, splitLine: { lineStyle: { color: "#EEF2F7" } }, axisLabel: { color: "#6B7C92", fontSize: 10 } },
      series: [
        { type: "line", data: lowBase, stack: "b", lineStyle: { opacity: 0 }, symbol: "none", silent: true, areaStyle: { color: "transparent" } },
        { type: "line", data: band, stack: "b", lineStyle: { opacity: 0 }, symbol: "none", silent: true, areaStyle: { color, opacity: 0.13 } },
        { name: d.name, type: "line", data: histLine, symbol: "none", lineStyle: { color, width: 2 }, areaStyle: { color, opacity: 0.06 },
          markLine: H ? { silent: true, symbol: "none", label: { formatter: "now", color: "#6B7C92", fontSize: 10 }, lineStyle: { color: "#9AA8BC", type: "dashed" }, data: [{ xAxis: hL[H - 1] }] } : undefined },
        { name: "Predicted", type: "line", data: fcLine, symbol: "none", lineStyle: { color, width: 2, type: "dashed" } },
      ],
    }, true);
    $("#predNote").innerHTML = N > 0
      ? `<span class='tag'>PREDICTED</span> Next ${N} week(s) · ${esc(d.note || "")}`
      : "<span class='muted'>Drag the slider right to show the forecast.</span>";
  }

  function wireControls() {
    $("#rangeChips").querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        state.range = b.dataset.r;
        $("#rangeChips").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        renderTrend();
      }));
    $("#horizon").addEventListener("input", (e) => { state.horizon = +e.target.value; drawTrend(); });
    $("#detailsBtn").addEventListener("click", toggleDetails);
    $("#csvBtn").addEventListener("click", downloadCSV);
    window.addEventListener("resize", () => state.chart && state.chart.resize());
  }

  async function toggleDetails() {
    const box = $("#detailsText");
    if (box.hidden) { box.hidden = false; $("#detailsBtn").textContent = "Hide Chart Details"; await loadDetails(); }
    else { box.hidden = true; $("#detailsBtn").textContent = "View Chart Details"; }
  }
  async function loadDetails() {
    const box = $("#detailsText"); box.textContent = "…";
    try { const d = await api(`/chart-details/${state.stp.id}/${state.marker}`); box.textContent = d.text; }
    catch (e) { box.textContent = "Details unavailable."; }
  }

  function downloadCSV() {
    const d = state.predict; if (!d) return;
    const rows = [["week", "value", "type"]];
    d.history.labels.forEach((l, i) => rows.push([l, d.history.values[i], "actual"]));
    d.forecast.labels.slice(0, state.horizon).forEach((l, i) => rows.push([l, d.forecast.values[i], "predicted"]));
    const csv = "# JalDrishti · " + d.name + " · " + state.stp.name + " (illustrative sample data)\n" +
      rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `jaldrishti_${state.stp.id}_${state.marker}.csv`; a.click();
  }

  /* ----------------------------------------------------------- utils ----- */
  function spark(data, color) {
    if (!data || !data.length) return "<svg class='mk__spark'></svg>";
    const w = 70, h = 22, min = Math.min(...data), max = Math.max(...data), sp = max - min || 1, st = w / (data.length - 1);
    const dd = data.map((v, i) => `${i ? "L" : "M"}${(i * st).toFixed(1)} ${(h - 2 - ((v - min) / sp) * (h - 4)).toFixed(1)}`).join(" ");
    return `<svg class='mk__spark' viewBox='0 0 ${w} ${h}'><path d='${dd}' fill='none' stroke='${color}' stroke-width='1.6'/></svg>`;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  window.jalDrishti = { openStp };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
