/* JalDrishti — masking transparency page. Shows real ICMR data + the calc. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const LBL = { not_required: "Masking not required", suggested: "Masking suggested", strongly_advised: "Masking strongly advised" };
  const SIG = { not_required: "baseline", suggested: "watch", strongly_advised: "alert" };

  fetch("/api/jd/icmr").then((r) => r.json()).then(render).catch((e) => {
    $("#loading").textContent = "Could not load ICMR data (" + e + ")";
  });

  function render(d) {
    const m = d.masking;
    const sig = SIG[m.level] || "baseline";

    // result card with the live equation + gauge
    const maxR = 2.5, pct = Math.min(m.ratio || 0, maxR) / maxR * 100;
    $("#result").innerHTML = `
      <div class="res__head">
        <span class="pill pill--${sig}" style="font-size:14px"><span class="dot"></span>${LBL[m.level]}</span>
        <span class="muted small">Source: ICMR · week ${esc(m.source_week || d.week || "—")}</span>
      </div>
      <div class="equation">
        <div class="eq"><div class="eq__n">${m.current_total}</div><div class="eq__l">current (X)<br/>latest week</div></div>
        <div class="eq__op">÷</div>
        <div class="eq"><div class="eq__n">${m.baseline}</div><div class="eq__l">baseline (Y)<br/>median of ${m.baseline_window_weeks} wks</div></div>
        <div class="eq__op">=</div>
        <div class="eq"><div class="eq__n eq__ratio">${m.ratio}×</div><div class="eq__l">ratio</div></div>
      </div>
      <div class="gauge">
        <div class="gauge__bar">
          <span class="z z--low"></span><span class="z z--watch"></span><span class="z z--alert"></span>
          <span class="gauge__tick" style="left:${(1.1 / maxR) * 100}%"></span>
          <span class="gauge__tick" style="left:${(1.5 / maxR) * 100}%"></span>
          <span class="gauge__ptr" style="left:${pct}%" title="ratio ${m.ratio}"></span>
        </div>
        <div class="gauge__scale"><span>0</span><span>1.1</span><span>1.5</span><span>${maxR}×</span></div>
      </div>
      <p class="res__why">${esc(m.rationale || "")}</p>
      <div class="drivers"><span class="muted small">Top contributors this week:</span>
        ${(m.drivers || []).map((x) => `<span class="chip"><span class="dot" style="background:${x.color || "#0E6BA8"}"></span>${esc(x.name)} · ${x.value}</span>`).join("")}</div>`;

    // weekly totals chart
    $("#chartSrc").textContent = `${d.labels.length} weeks · updated ${d.updated || "—"}`;
    const chart = echarts.init($("#calcChart"), null, { renderer: "svg" });
    chart.setOption({
      grid: { left: 38, right: 14, top: 16, bottom: 30 },
      tooltip: { trigger: "axis", backgroundColor: "#0E1B2E", borderWidth: 0, textStyle: { color: "#fff", fontSize: 12 } },
      xAxis: { type: "category", data: d.labels, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: "#E5EBF1" } }, axisLabel: { color: "#6B7C92", fontSize: 10, hideOverlap: true } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: "#EEF2F7" } }, axisLabel: { color: "#6B7C92", fontSize: 10 } },
      series: [{
        type: "line", data: d.weekly_totals, smooth: false,
        lineStyle: { color: "#0E6BA8", width: 2 }, areaStyle: { color: "#0E6BA8", opacity: 0.08 },
        symbol: "circle", symbolSize: (v, p) => (p.dataIndex === d.weekly_totals.length - 1 ? 9 : 0),
        itemStyle: { color: "#D7263D" },
        markLine: { silent: true, symbol: "none", label: { formatter: "12-wk baseline", color: "#7a5a00", fontSize: 10, position: "insideStartTop" },
          lineStyle: { color: "#E0A100", type: "dashed" }, data: [{ yAxis: m.baseline }] },
      }],
    });
    window.addEventListener("resize", () => chart.resize());

    // pathogen table
    $("#tableSrc").textContent = `latest = week ${d.week || "—"}`;
    const rows = d.pathogens.slice().sort((a, b) => b.latest - a.latest).map((p) => `
      <tr><td><span class="dot" style="background:${p.color || "#0E6BA8"}"></span> ${esc(p.name)}</td>
      <td class="num">${p.latest}</td><td>${spark(p.values.slice(-16), p.color)}</td></tr>`).join("");
    $("#pathTable").innerHTML = `<thead><tr><th>Pathogen</th><th class="num">Latest</th><th>Recent (16 wks)</th></tr></thead><tbody>${rows}</tbody>`;

    $("#loading").classList.add("hide");
  }

  function spark(data, color) {
    if (!data || !data.length) return "";
    const w = 130, h = 26, min = Math.min(...data), max = Math.max(...data), sp = max - min || 1, st = w / (data.length - 1);
    const dd = data.map((v, i) => `${i ? "L" : "M"}${(i * st).toFixed(1)} ${(h - 3 - ((v - min) / sp) * (h - 6)).toFixed(1)}`).join(" ");
    return `<svg width="${w}" height="${h}"><path d="${dd}" fill="none" stroke="${color || "#0E6BA8"}" stroke-width="1.6"/></svg>`;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
})();
