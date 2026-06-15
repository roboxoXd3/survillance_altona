/* =========================================================================
   JalDrishti — app logic (vanilla JS, no dependencies)
   Charts, animated sector map, scroll reveals, counters, nav, i18n, form.
   Everything degrades gracefully if JS fails: content is in the HTML.
   ========================================================================= */
(function () {
  "use strict";
  const D = window.DATA, S = window.STRINGS;
  const SVGNS = "http://www.w3.org/2000/svg";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const el = (n, attrs) => {
    const e = document.createElementNS(SVGNS, n);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  const STATUS_FILL = { low: "var(--status-low)", watch: "var(--status-watch)", alert: "var(--status-alert)" };

  /* ---------------------------------------------------------------- i18n -- */
  let lang = "en";
  function applyLang(l) {
    lang = S[l] ? l : "en";
    const dict = S[lang];
    document.documentElement.setAttribute("lang", lang);
    $$("[data-i18n]").forEach(node => {
      const key = node.getAttribute("data-i18n");
      if (dict[key] != null) node.innerHTML = dict[key];
    });
    $$(".lang-toggle button").forEach(b => b.classList.toggle("active", b.dataset.lang === lang));
    // re-render data-driven sections whose copy depends on language
    renderMonitor();
    const slider = $("#mapSlider");
    if (window._jdSetWeek && slider) window._jdSetWeek(+slider.value);
    if (window._jdDemoRelabel) window._jdDemoRelabel();
    if (window._jdDashRelabel) window._jdDashRelabel();
    try { localStorage.setItem("jd-lang", lang); } catch (e) {}
  }
  $$(".lang-toggle button").forEach(b =>
    b.addEventListener("click", () => applyLang(b.dataset.lang)));

  /* ------------------------------------------------------- sparkline util -- */
  function sparkPath(series, w, h, pad) {
    pad = pad || 4;
    const min = Math.min.apply(null, series), max = Math.max.apply(null, series);
    const span = (max - min) || 1;
    const stepX = (w - pad * 2) / (series.length - 1);
    return series.map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");
  }

  /* draw an animated sparkline + threshold + gradient fill into an <svg> */
  function drawSpark(svg, series, color, threshold, unitMax) {
    const w = 280, h = 64, pad = 5;
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.innerHTML = "";
    const min = Math.min.apply(null, series), max = Math.max.apply(null, series);
    const span = (max - min) || 1;
    const gid = "g" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs");
    const grad = el("linearGradient", { id: gid, x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(el("stop", { offset: "0", "stop-color": color, "stop-opacity": "0.22" }));
    grad.appendChild(el("stop", { offset: "1", "stop-color": color, "stop-opacity": "0" }));
    defs.appendChild(grad); svg.appendChild(defs);

    // threshold line (alert level) if provided & within range
    if (threshold != null && threshold >= min && threshold <= max) {
      const ty = h - pad - ((threshold - min) / span) * (h - pad * 2);
      svg.appendChild(el("line", { x1: pad, y1: ty, x2: w - pad, y2: ty, class: "thresh" }));
    }
    const d = sparkPath(series, w, h, pad);
    const area = el("path", { d: d + " L" + (w - pad) + " " + (h - pad) + " L" + pad + " " + (h - pad) + " Z", fill: "url(#" + gid + ")" });
    svg.appendChild(area);
    const line = el("path", { d: d, fill: "none", stroke: color, "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" });
    svg.appendChild(line);
    // last-point dot
    const lastX = w - pad, lastY = h - pad - ((series[series.length - 1] - min) / span) * (h - pad * 2);
    svg.appendChild(el("circle", { cx: lastX, cy: lastY, r: "3", fill: color }));

    if (!reduce) {
      const len = line.getTotalLength();
      line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
      area.style.opacity = 0;
      requestAnimationFrame(() => {
        line.style.transition = "stroke-dashoffset 1s var(--ease-out)";
        area.style.transition = "opacity .8s var(--ease-out) .2s";
        line.style.strokeDashoffset = 0; area.style.opacity = 1;
      });
    }
  }

  /* multi-line chart for the pillars (≤3 series) */
  function drawMultiline(svg, sets) {
    const w = 520, h = 160, padL = 8, padR = 8, padT = 12, padB = 18;
    svg.innerHTML = "";
    let gmin = Infinity, gmax = -Infinity;
    sets.forEach(s => s.series.forEach(v => { gmin = Math.min(gmin, v); gmax = Math.max(gmax, v); }));
    const span = (gmax - gmin) || 1;
    // faint baseline grid (1 line)
    const midY = padT + (h - padT - padB) / 2;
    svg.appendChild(el("line", { x1: padL, y1: midY, x2: w - padR, y2: midY, stroke: "var(--line)", "stroke-width": "1" }));
    sets.forEach((s, idx) => {
      const stepX = (w - padL - padR) / (s.series.length - 1);
      const d = s.series.map((v, i) => {
        const x = padL + i * stepX;
        const y = h - padB - ((v - gmin) / span) * (h - padT - padB);
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join(" ");
      const line = el("path", { d: d, fill: "none", stroke: s.color, "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" });
      svg.appendChild(line);
      if (!reduce) {
        const len = line.getTotalLength();
        line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
        requestAnimationFrame(() => {
          line.style.transition = "stroke-dashoffset 1.1s var(--ease-out) " + (idx * 0.12) + "s";
          line.style.strokeDashoffset = 0;
        });
      }
    });
    // legend
    let lx = padL;
    sets.forEach(s => {
      const g = el("g");
      g.appendChild(el("rect", { x: lx, y: h - 12, width: 12, height: 3, rx: 1.5, fill: s.color }));
      const t = el("text", { x: lx + 17, y: h - 9, "font-size": "11", fill: "var(--ink-faint)", "font-family": "Inter, sans-serif" });
      t.textContent = s.label; g.appendChild(t);
      svg.appendChild(g);
      lx += 17 + s.label.length * 6.5 + 18;
    });
  }

  /* ---------------------------------------------------- monitor explainer -- */
  function renderMonitor() {
    const grid = $("#monitorGrid");
    if (!grid) return;
    grid.innerHTML = "";
    const items = D.pathogens.concat(D.ncd);
    const trendLabel = {
      en: { up: "Rising", down: "Falling", flat: "Stable" },
      hi: { up: "बढ़ता", down: "घटता", flat: "स्थिर" }
    }[lang];
    const statusLabel = {
      en: { low: "Baseline", watch: "Watch", alert: "Alert" },
      hi: { low: "आधार", watch: "निगरानी", alert: "चेतावनी" }
    }[lang];

    items.forEach((it, i) => {
      const card = document.createElement("article");
      card.className = "card mcard reveal";
      card.dataset.delay = (i % 3);

      const trendDir = /ris|up|rising/i.test(it.trend) ? "up"
        : /fall|down|improv/i.test(it.trend) ? "down" : "flat";
      const color = it.pillar === "ncd" || D.ncd.indexOf(it) > -1 ? "var(--green)"
        : "var(--teal)";
      const arrow = trendDir === "up" ? "▲" : trendDir === "down" ? "▼" : "▬";

      card.innerHTML =
        '<div class="mcard__head">' +
          '<div><div class="mcard__name">' + it.common + '</div>' +
          '<div class="mcard__common">' + it.name + '</div></div>' +
          '<span class="pill pill--' + it.status + '"><span class="dot"></span>' + statusLabel[it.status] + '</span>' +
        '</div>' +
        '<p class="mcard__desc">' + it.desc[lang] + '</p>' +
        '<div class="mcard__chart"><svg class="spark" aria-hidden="true"></svg></div>' +
        '<div class="mcard__foot">' +
          '<span class="trend trend--' + trendDir + '">' + arrow + ' ' + trendLabel[trendDir] + '</span>' +
          '<span class="illus-note">' + (lang === "hi" ? "180-दिन · उदाहरणात्मक" : "180-day · illustrative") + '</span>' +
        '</div>';
      grid.appendChild(card);
      // draw spark once revealed (observer handles reveal; draw now is fine)
      drawSpark($(".spark", card), it.series, color, it.threshold);
    });
    observeReveals(grid);
  }

  /* ----------------------------------------------------------- pillars ---- */
  function renderPillars() {
    const viral = $("#pillarViralChart"), ncd = $("#pillarNcdChart");
    if (viral) drawMultiline(viral, [
      { label: "Typhoid", color: "var(--status-alert)", series: byId(D.pathogens, "typhoid").series },
      { label: "Dengue", color: "var(--teal)", series: byId(D.pathogens, "dengue").series },
      { label: "COVID", color: "var(--primary)", series: byId(D.pathogens, "covid").series }
    ]);
    if (ncd) drawMultiline(ncd, [
      { label: "Alcohol", color: "var(--green)", series: byId(D.ncd, "alcohol").series },
      { label: "Tobacco", color: "var(--status-watch)", series: byId(D.ncd, "tobacco").series },
      { label: "Cardio", color: "var(--primary)", series: byId(D.ncd, "pharma").series }
    ]);
  }
  function byId(arr, id) { return arr.filter(x => x.id === id)[0]; }

  /* ------------------------------------------------------- hero mini map -- */
  function renderHeroMap() {
    const svg = $("#heroMap");
    if (!svg) return;
    const cols = 7, rows = 6, gap = 6, size = 38;
    const W = cols * (size + gap), H = rows * (size + gap);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const cells = [];
    // build a simplified frame set from the real map (sample 7x6 from data grid)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const rect = el("rect", { x: c * (size + gap), y: r * (size + gap), width: size, height: size, rx: 7, fill: STATUS_FILL.low, opacity: "0.85" });
      svg.appendChild(rect); cells.push(rect);
    }
    // A self-contained breathing cluster — visibly active from the very first
    // frame (no slow ramp-up), so the preview reads as "live" while the hero
    // is still on screen. The cluster pulses watch<->alert and its halo spreads.
    const focus = [29, 30, 36, 37, 35, 31];
    let p = 6; // start mid-pulse so colour is present immediately
    function frame() {
      const pulse = 0.5 + 0.5 * Math.sin(p * 0.5);          // 0..1, the cluster "breathing"
      const spread = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(p * 0.5 - 0.6)); // halo lags the core
      cells.forEach((rect, i) => {
        const fc = i % cols, fr = Math.floor(i / cols);
        let v;
        if (focus.indexOf(i) !== -1) {
          v = 0.5 + pulse * 0.45;                            // always watch..alert
        } else {
          const near = focus.some(f => Math.abs((f % cols) - fc) <= 1 && Math.abs(Math.floor(f / cols) - fr) <= 1);
          if (near) v = 0.22 + spread * 0.42;                // low..watch, lagging halo
          else v = 0.1 + (0.5 + 0.5 * Math.sin(i * 1.7 + p * 0.4)) * 0.16; // faint shimmer elsewhere
        }
        const st = v >= 0.66 ? "alert" : v >= 0.34 ? "watch" : "low";
        rect.setAttribute("fill", STATUS_FILL[st]);
      });
      p++;
    }
    frame();
    if (!reduce) setInterval(frame, 560);
  }

  /* ----------------------------------------------------- sector map (big) - */
  function renderSectorMap() {
    const svg = $("#sectorGrid");
    if (!svg) return;
    const cols = D.meta.cols, rows = D.meta.rows;
    const gap = 8, pad = 6;
    const cw = (640 - pad * 2 - gap * (cols - 1)) / cols;
    const ch = (480 - pad * 2 - gap * (rows - 1)) / rows;
    const rects = [];
    for (let i = 0; i < cols * rows; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const rect = el("rect", {
        x: pad + c * (cw + gap), y: pad + r * (ch + gap),
        width: cw, height: ch, rx: 10, class: "cell fill-low",
        fill: STATUS_FILL.low, "data-i": i
      });
      attachTip(rect, i);
      svg.appendChild(rect); rects.push(rect);
    }

    const slider = $("#mapSlider"), weekLbl = $("#mapWeek"), alertEl = $("#mapAlertCount");
    const playBtn = $("#mapPlay"), playIcon = $("#playIcon");
    slider.max = D.sectorsByWeek.length - 1;

    function setWeek(w) {
      const frame = D.sectorsByWeek[w];
      let alerts = 0;
      frame.forEach((cell, i) => {
        rects[i].setAttribute("fill", STATUS_FILL[cell.status]);
        rects[i]._cell = cell;
        if (cell.status === "alert") alerts++;
      });
      weekLbl.textContent = (lang === "hi" ? "सप्ताह " : "Week ") + (w + 1) + " · " + D.weekLabels[w];
      alertEl.textContent = alerts;
      slider.value = w;
    }

    let playing = false, timer = null;
    function play() {
      playing = true;
      playIcon.innerHTML = '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>';
      playBtn.setAttribute("aria-label", "Pause timeline");
      timer = setInterval(() => {
        let w = (+slider.value + 1);
        if (w > +slider.max) w = 0;
        setWeek(w);
      }, 650);
    }
    function pause() {
      playing = false;
      playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
      playBtn.setAttribute("aria-label", "Play timeline");
      clearInterval(timer);
    }
    playBtn.addEventListener("click", () => playing ? pause() : play());
    slider.addEventListener("input", () => { pause(); setWeek(+slider.value); });

    setWeek(0);
    // autoplay once the map scrolls into view (respect reduced motion)
    if (!reduce) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting && !playing) { play(); io.disconnect(); } });
      }, { threshold: 0.4 });
      io.observe(svg);
    }
    window._jdSetWeek = setWeek; // for language re-label
  }

  /* tooltip handling shared by map cells */
  function attachTip(rect, i) {
    const tip = $("#tip");
    rect.addEventListener("mousemove", (ev) => {
      const cell = rect._cell; if (!cell) return;
      const lbls = { low: lang === "hi" ? "आधार" : "Baseline", watch: lang === "hi" ? "निगरानी" : "Watch", alert: lang === "hi" ? "चेतावनी" : "Alert" };
      tip.innerHTML = "<b>" + cell.sector + "</b><br>" + lbls[cell.status] + " · " + Math.round(cell.value * 100) + "%";
      tip.style.left = (ev.clientX + 14) + "px";
      tip.style.top = (ev.clientY + 14) + "px";
      tip.classList.add("show");
    });
    rect.addEventListener("mouseleave", () => $("#tip").classList.remove("show"));
  }

  /* ------------------------------------------------- dashboard preview viz - */
  function renderDashPreview() {
    const cellG = $("#dashCells"), trend = $("#dashTrend");
    if (cellG) {
      const cols = 7, rows = 6, size = 36, gap = 4, ox = 206, oy = 188;
      const frame = D.sectorsByWeek[Math.floor(D.sectorsByWeek.length * 0.74)]; // near outbreak peak
      for (let i = 0; i < cols * rows; i++) {
        const c = i % cols, r = Math.floor(i / cols);
        const idx = Math.min(frame.length - 1, i);
        const rect = el("rect", {
          x: ox + c * (size + gap), y: oy + r * (size + gap),
          width: size, height: size, rx: 6, fill: STATUS_FILL[frame[idx].status], opacity: "0.92"
        });
        cellG.appendChild(rect);
      }
    }
    if (trend) {
      const s = byId(D.pathogens, "typhoid").series;
      const x0 = 518, x1 = 684, y0 = 392, y1 = 200;
      const min = Math.min.apply(null, s), max = Math.max.apply(null, s), span = (max - min) || 1;
      const pts = s.map((v, i) => {
        const x = x0 + (i / (s.length - 1)) * (x1 - x0);
        const y = y0 - ((v - min) / span) * (y0 - y1);
        return x.toFixed(1) + "," + y.toFixed(1);
      }).join(" ");
      trend.setAttribute("points", pts);
    }
  }

  /* --------------------------------------------------------- counters ----- */
  function animateCounters() {
    $$("[data-count]").forEach(node => {
      const target = parseFloat(node.dataset.count);
      const suffix = node.dataset.suffix || "";
      const decimals = (node.dataset.count.split(".")[1] || "").length;
      if (reduce) { node.textContent = target.toFixed(decimals) + suffix; return; }
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          obs.disconnect();
          const dur = 1200; let start = null;
          function step(ts) {
            if (!start) start = ts;
            const p = Math.min(1, (ts - start) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            node.textContent = (target * eased).toFixed(decimals) + suffix;
            if (p < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        });
      }, { threshold: 0.6 });
      io.observe(node);
    });
  }

  /* --------------------------------------------------------- reveals ------ */
  let revealIO;
  function observeReveals(root) {
    if (reduce) { $$(".reveal", root).forEach(n => n.classList.add("in")); return; }
    if (!revealIO) {
      revealIO = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); revealIO.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    }
    $$(".reveal", root).forEach(n => { if (!n.classList.contains("in")) revealIO.observe(n); });
  }

  /* Sequential timeline: each step box appears, then a connector segment draws to
     the next box, then that box appears — a building timeline, not one rail through
     all of them. Once built, hand off to the demo's sync-highlighting (demo-synced). */
  function setupTimeline() {
    const flow = $("#flow");
    if (!flow) return;
    const steps = Array.from(flow.querySelectorAll(".flowstep"));
    if (!steps.length) return;
    flow.classList.add("js-build");

    // build one segment between each consecutive pair of steps
    const segs = [];
    for (let i = 0; i < steps.length - 1; i++) {
      const s = document.createElement("div");
      s.className = "flowseg";
      flow.appendChild(s);
      segs.push(s);
    }

    function positionSegs() {
      if (window.innerWidth <= 860) return; // segments hidden via CSS on mobile
      const ics = flow.querySelectorAll(".flowstep__ic");
      const fr = flow.getBoundingClientRect();
      for (let i = 0; i < segs.length; i++) {
        const a = ics[i].getBoundingClientRect();
        const b = ics[i + 1].getBoundingClientRect();
        const x1 = a.left + a.width / 2 - fr.left;
        const x2 = b.left + b.width / 2 - fr.left;
        segs[i].style.left = x1 + "px";
        segs[i].style.width = (x2 - x1) + "px";
        segs[i].style.top = (a.top + a.height / 2 - fr.top) + "px";
      }
    }
    positionSegs();
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(positionSegs, 120); }, { passive: true });

    const enableSync = () => flow.classList.add("demo-synced");

    function runEntrance() {
      if (reduce) {
        steps.forEach(s => s.classList.add("lit"));
        segs.forEach(s => s.classList.add("lit"));
        enableSync();
        return;
      }
      // interleave: step0, seg0, step1, seg1, ... stepN
      const seq = [];
      steps.forEach((s, i) => { seq.push(() => s.classList.add("lit")); if (segs[i]) seq.push(() => segs[i].classList.add("lit")); });
      let k = 0;
      (function tick() {
        if (k >= seq.length) { setTimeout(enableSync, 220); return; }
        seq[k++]();
        setTimeout(tick, 180);
      })();
    }

    if (reduce) { runEntrance(); return; }

    // Robust trigger: poll until the flow is in view, then build once. Polling
    // (rather than only scroll/IntersectionObserver events) guarantees the boxes
    // can never get stuck hidden, regardless of how the page is scrolled.
    let ran = false;
    function inView() {
      const r = flow.getBoundingClientRect();
      return r.top < window.innerHeight * 0.85 && r.bottom > 0;
    }
    function maybeRun() {
      if (ran || !inView()) return;
      ran = true;
      clearInterval(poll);
      window.removeEventListener("scroll", maybeRun);
      runEntrance();
    }
    const poll = setInterval(maybeRun, 300);
    window.addEventListener("scroll", maybeRun, { passive: true });
    maybeRun(); // in case it's already in view at load
  }

  /* ------------------------------------------------------------- nav ------ */
  function setupNav() {
    const nav = $("#nav"), burger = $("#burger"), links = $("#navLinks");
    window.addEventListener("scroll", () => nav.classList.toggle("scrolled", window.scrollY > 8), { passive: true });
    burger.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      burger.setAttribute("aria-expanded", open);
    });
    $$("#navLinks a").forEach(a => a.addEventListener("click", () => {
      links.classList.remove("open"); burger.setAttribute("aria-expanded", false);
    }));
    // active-section highlight
    const ids = ["how", "monitor", "map", "privacy", "proof"];
    const map = {};
    $$("#navLinks a").forEach(a => { const h = a.getAttribute("href"); if (h && h[0] === "#") map[h.slice(1)] = a; });
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && map[e.target.id]) {
          Object.values(map).forEach(a => a.classList.remove("active"));
          map[e.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ids.forEach(id => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  /* ------------------------------------------------- animated demo ------- */
  function drawDemoChart() {
    const line = $("#demoChartLine");
    if (!line) return;
    if (!line.getAttribute("points")) {
      const pts = [[533,138],[551,136],[569,138],[587,131],[605,118],[623,100],[641,90],[653,93]];
      line.setAttribute("points", pts.map(p => p.join(",")).join(" "));
    }
    if (reduce) return;
    const len = line.getTotalLength ? line.getTotalLength() : 240;
    line.style.transition = "none";
    line.style.strokeDasharray = len;
    line.style.strokeDashoffset = len;
    line.getBoundingClientRect(); // force reflow so the transition restarts each visit
    requestAnimationFrame(() => {
      line.style.transition = "stroke-dashoffset 1.3s var(--ease-out)";
      line.style.strokeDashoffset = 0;
    });
  }

  function setupDemo() {
    const scene = $("#demoScene");
    if (!scene) return;
    const nodes = [0, 1, 2, 3].map(i => $("#dnode" + i));
    const steps = $$("#flow .flowstep");
    const token = $("#demoToken");
    const glyph = $("#demoGlyph");
    const caption = $("#demoCaption");
    const dotsWrap = $("#demoDots");
    const toggle = $("#demoToggle");
    const NODE_X = [143, 368, 593, 818];
    const GLYPH = ["💧", "🧪", "📈", "🔔"];
    let stage = 0, playing = false, timer = null;

    const dots = NODE_X.map((_, i) => {
      const b = document.createElement("button");
      b.className = "ddot"; b.type = "button"; b.tabIndex = -1;
      b.addEventListener("click", () => { pause(); go(i); });
      dotsWrap.appendChild(b); return b;
    });

    function caps() { return (S[lang].demo_caps) || []; }
    function go(s) {
      stage = ((s % 4) + 4) % 4;
      scene.setAttribute("data-stage", stage);
      nodes.forEach((n, i) => n.classList.toggle("on", i === stage));
      steps.forEach((n, i) => n.classList.toggle("active", i === stage));
      dots.forEach((d, i) => d.classList.toggle("on", i === stage));
      token.style.transform = "translateX(" + (NODE_X[stage] - NODE_X[0]) + "px)";
      if (glyph) glyph.textContent = GLYPH[stage];
      caption.textContent = caps()[stage] || "";
      if (stage === 2) drawDemoChart();
    }
    function setBtn() {
      toggle.textContent = playing ? "❚❚ " + (S[lang].demo_pause || "Pause") : "▶ " + (S[lang].demo_play || "Play");
      toggle.setAttribute("aria-label", playing ? (S[lang].demo_pause || "Pause") : (S[lang].demo_play || "Play"));
    }
    function play() { if (playing) return; playing = true; setBtn(); timer = setInterval(() => go(stage + 1), 2600); }
    function pause() { playing = false; setBtn(); clearInterval(timer); }

    toggle.addEventListener("click", () => playing ? pause() : play());
    steps.forEach((st, i) => {
      st.setAttribute("role", "button"); st.setAttribute("tabindex", "0");
      st.addEventListener("click", () => { pause(); go(i); });
      st.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pause(); go(i); }
      });
    });

    go(0); setBtn();
    if (!reduce) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting && !playing) { play(); io.disconnect(); } });
      }, { threshold: 0.4 });
      io.observe(scene);
    }
    window._jdDemoRelabel = () => { caption.textContent = caps()[stage] || ""; setBtn(); };
  }

  /* --------------------------------------------------- live dashboard ---- */
  const DASH = {
    en: { title:"Operational dashboard", sub:"Illustrative live view · Chandigarh UT", illus:"Illustrative data",
      map:"Sector signal map", alerts:"Active alerts", trend:"Marker trend", table:"All markers",
      low:"Baseline", watch:"Watch", alert:"Alert", none:"No sectors at alert this week.",
      kAlerts:"Active alerts", kSectors:"Sectors monitored", kMarkers:"Markers tracked", kWeeks:"Weeks of data",
      cMarker:"Marker", cStatus:"Status", cTrend:"Trend", c180:"180-day signal",
      viral:"Viral & pathogen", ncd:"NCD & lifestyle", week:"Week", up:"Rising", down:"Falling", flat:"Stable",
      threshold:"alert level" },
    hi: { title:"परिचालन डैशबोर्ड", sub:"उदाहरणात्मक लाइव दृश्य · चंडीगढ़ यूटी", illus:"उदाहरणात्मक डेटा",
      map:"सेक्टर संकेत नक्शा", alerts:"सक्रिय चेतावनियाँ", trend:"मार्कर रुझान", table:"सभी मार्कर",
      low:"आधार", watch:"निगरानी", alert:"चेतावनी", none:"इस सप्ताह कोई सेक्टर चेतावनी पर नहीं।",
      kAlerts:"सक्रिय चेतावनियाँ", kSectors:"निगरानी में सेक्टर", kMarkers:"मापे गए मार्कर", kWeeks:"सप्ताह डेटा",
      cMarker:"मार्कर", cStatus:"स्थिति", cTrend:"रुझान", c180:"180-दिन संकेत",
      viral:"वायरल व रोगाणु", ncd:"एनसीडी व जीवनशैली", week:"सप्ताह", up:"बढ़ता", down:"घटता", flat:"स्थिर",
      threshold:"चेतावनी स्तर" }
  };
  const isNcd = (it) => D.ncd.indexOf(it) > -1;
  const trendDir = (t) => /ris|up/i.test(t) ? "up" : /fall|down|improv/i.test(t) ? "down" : "flat";

  function setupDashboard() {
    const modal = $("#dashModal");
    if (!modal) return;
    const cols = D.meta.cols, rows = D.meta.rows;
    const allMarkers = D.pathogens.concat(D.ncd);

    /* ---- build the sector grid ---- */
    const mapSvg = $("#dashMap");
    const gap = 8, pad = 6;
    const cw = (640 - pad * 2 - gap * (cols - 1)) / cols;
    const ch = (360 - pad * 2 - gap * (rows - 1)) / rows;
    const rects = [];
    for (let i = 0; i < cols * rows; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const rect = el("rect", { x: pad + c * (cw + gap), y: pad + r * (ch + gap), width: cw, height: ch, rx: 8, class: "cell", fill: STATUS_FILL.low });
      attachTip(rect, i);
      mapSvg.appendChild(rect); rects.push(rect);
    }

    const slider = $("#dashSlider"), weekLbl = $("#dashWeek"), alertList = $("#dashAlertList");
    const playBtn = $("#dashPlay"), playIcon = $("#dashPlayIcon"), kpis = $("#dashKpis");
    const marker = $("#dashMarker"), trendSvg = $("#dashTrend"), trendMeta = $("#dashTrendMeta"), table = $("#dashTable");
    slider.max = D.sectorsByWeek.length - 1;

    function dk() { return DASH[lang] || DASH.en; }

    function setWeek(w) {
      const frame = D.sectorsByWeek[w];
      let alerts = 0;
      frame.forEach((cell, i) => { rects[i].setAttribute("fill", STATUS_FILL[cell.status]); rects[i]._cell = cell; if (cell.status === "alert") alerts++; });
      weekLbl.textContent = dk().week + " " + (w + 1) + " · " + D.weekLabels[w];
      slider.value = w;
      // KPI active-alerts number
      const kn = $("#dashKpiAlerts"); if (kn) kn.textContent = alerts;
      // alerts list (non-baseline, worst first)
      const items = frame.filter(c => c.status !== "low").sort((a, b) => b.value - a.value);
      if (!items.length) { alertList.innerHTML = '<li class="dash__alert dash__alert--none">' + dk().none + "</li>"; return; }
      alertList.innerHTML = items.map(c =>
        '<li class="dash__alert"><span class="pill pill--' + c.status + '"><span class="dot"></span>' + dk()[c.status] + "</span>" +
        '<span class="dash__alert-name">' + c.sector + '</span><span class="dash__alert-val">' + Math.round(c.value * 100) + "%</span></li>"
      ).join("");
    }

    /* ---- KPIs ---- */
    function buildKpis() {
      const data = [
        { id: "dashKpiAlerts", n: 0, l: dk().kAlerts, cls: "dash__kpi--alert" },
        { n: cols * rows, l: dk().kSectors },
        { n: allMarkers.length, l: dk().kMarkers },
        { n: D.sectorsByWeek.length, l: dk().kWeeks }
      ];
      kpis.innerHTML = data.map(k =>
        '<div class="dash__kpi ' + (k.cls || "") + '"><div class="n"' + (k.id ? ' id="' + k.id + '"' : "") + ">" + k.n + '</div><div class="l">' + k.l + "</div></div>"
      ).join("");
    }

    /* ---- big trend chart ---- */
    function drawTrend(item) {
      const w = 520, h = 200, padL = 12, padR = 12, padT = 18, padB = 28;
      trendSvg.innerHTML = "";
      const s = item.series, color = isNcd(item) ? "var(--green)" : "var(--teal)";
      const min = Math.min.apply(null, s), max = Math.max.apply(null, s), span = (max - min) || 1;
      const Y = v => h - padB - ((v - min) / span) * (h - padT - padB);
      const X = i => padL + (i / (s.length - 1)) * (w - padL - padR);
      const gid = "dg" + Math.random().toString(36).slice(2, 7);
      const defs = el("defs"), grad = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(el("stop", { offset: 0, "stop-color": color, "stop-opacity": ".22" }));
      grad.appendChild(el("stop", { offset: 1, "stop-color": color, "stop-opacity": "0" }));
      defs.appendChild(grad); trendSvg.appendChild(defs);
      // threshold
      if (item.threshold != null && item.threshold >= min && item.threshold <= max) {
        const ty = Y(item.threshold);
        trendSvg.appendChild(el("line", { x1: padL, y1: ty, x2: w - padR, y2: ty, stroke: "var(--status-alert)", "stroke-width": 1, "stroke-dasharray": "4 4", opacity: ".6" }));
        const t = el("text", { x: w - padR, y: ty - 5, "text-anchor": "end", "font-size": 11, fill: "var(--status-alert)", "font-family": "Inter, sans-serif" });
        t.textContent = dk().threshold; trendSvg.appendChild(t);
      }
      const d = s.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
      trendSvg.appendChild(el("path", { d: d + " L" + X(s.length - 1) + " " + (h - padB) + " L" + padL + " " + (h - padB) + " Z", fill: "url(#" + gid + ")" }));
      const line = el("path", { d: d, fill: "none", stroke: color, "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" });
      trendSvg.appendChild(line);
      trendSvg.appendChild(el("circle", { cx: X(s.length - 1), cy: Y(s[s.length - 1]), r: 3.5, fill: color }));
      // x labels (first & last week)
      [[padL, D.weekLabels[0], "start"], [w - padR, D.weekLabels[s.length - 1], "end"]].forEach(([x, lab, anc]) => {
        const t = el("text", { x: x, y: h - 8, "text-anchor": anc, "font-size": 11, fill: "var(--ink-faint)", "font-family": "Inter, sans-serif" });
        t.textContent = lab; trendSvg.appendChild(t);
      });
      if (!reduce) {
        const len = line.getTotalLength();
        line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
        requestAnimationFrame(() => { line.style.transition = "stroke-dashoffset 1s var(--ease-out)"; line.style.strokeDashoffset = 0; });
      }
      const dir = trendDir(item.trend), arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
      trendMeta.innerHTML =
        '<span class="pill pill--' + item.status + '"><span class="dot"></span>' + dk()[item.status] + "</span>" +
        '<span class="trend trend--' + dir + '">' + arrow + " " + dk()[dir] + "</span>" +
        "<span>" + item.unit + "</span><span class=\"illus-note\">" + (lang === "hi" ? "उदाहरणात्मक" : "illustrative") + "</span>";
    }

    function buildMarkerSelect() {
      const groups = [{ label: dk().viral, items: D.pathogens }, { label: dk().ncd, items: D.ncd }];
      marker.innerHTML = groups.map(g =>
        '<optgroup label="' + g.label + '">' + g.items.map(it => '<option value="' + it.id + '">' + it.common + "</option>").join("") + "</optgroup>"
      ).join("");
    }
    function markerById(id) { return allMarkers.filter(x => x.id === id)[0]; }

    /* ---- markers table ---- */
    function buildTable() {
      let html = "<thead><tr><th>" + dk().cMarker + "</th><th>" + dk().cStatus + "</th><th>" + dk().cTrend + "</th><th>" + dk().c180 + "</th></tr></thead><tbody>";
      allMarkers.forEach((it, idx) => {
        const dir = trendDir(it.trend), arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "▬";
        html += "<tr><td><b>" + it.common + "</b><span class=\"dash__msub\">" + it.name + "</span></td>" +
          '<td><span class="pill pill--' + it.status + '"><span class="dot"></span>' + dk()[it.status] + "</span></td>" +
          '<td><span class="trend trend--' + dir + '">' + arrow + " " + dk()[dir] + "</span></td>" +
          '<td><svg class="spark" data-idx="' + idx + '"></svg></td></tr>';
      });
      html += "</tbody>"; table.innerHTML = html;
      allMarkers.forEach((it, idx) => { drawSpark(table.querySelector('.spark[data-idx="' + idx + '"]'), it.series, isNcd(it) ? "var(--green)" : "var(--teal)", it.threshold); });
    }

    /* ---- play/pause ---- */
    let playing = false, timer = null;
    function play() { playing = true; playIcon.innerHTML = '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>'; timer = setInterval(() => { let w = (+slider.value + 1); if (w > +slider.max) w = 0; setWeek(w); }, 650); }
    function pause() { playing = false; playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>'; clearInterval(timer); }
    playBtn.addEventListener("click", () => playing ? pause() : play());
    slider.addEventListener("input", () => { pause(); setWeek(+slider.value); });
    marker.addEventListener("change", () => drawTrend(markerById(marker.value)));

    function renderAll() {
      buildKpis(); buildMarkerSelect(); buildTable();
      setWeek(+slider.value || 0);
      drawTrend(markerById(marker.value) || allMarkers[0]);
      // static labels
      $$("[data-dk]", modal).forEach(n => { const k = n.getAttribute("data-dk"); if (dk()[k] != null) n.textContent = dk()[k]; });
    }

    /* ---- open / close ---- */
    let lastFocus = null;
    function open() {
      lastFocus = document.activeElement;
      modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      renderAll();
      if (!reduce) { setWeek(0); play(); }
      $(".dash__close", modal).focus();
    }
    function close() {
      pause();
      modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (lastFocus) lastFocus.focus();
    }
    $$("[data-open-dash]").forEach(b => b.addEventListener("click", (e) => { e.preventDefault(); open(); }));
    $$("[data-dash-close]").forEach(b => b.addEventListener("click", close));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("open")) close(); });

    renderAll(); // pre-build so first open is instant
    window._jdDashRelabel = () => { if (modal.classList.contains("open") || true) renderAll(); };
  }

  /* ------------------------------------------------------------ form ------ */
  function setupForm() {
    const form = $("#pilotForm"), msg = $("#formMsg");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#f-name").value.trim();
      const org = $("#f-org").value.trim();
      const email = $("#f-email").value.trim();
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!name || !org || !validEmail) {
        msg.textContent = S[lang].form_err; msg.className = "form__msg err"; return;
      }
      msg.textContent = S[lang].form_ok; msg.className = "form__msg ok";
      form.reset();
    });
  }

  /* ------------------------------------------------------------ init ------ */
  function init() {
    $("#year").textContent = "2025";
    try { const saved = localStorage.getItem("jd-lang"); if (saved) lang = saved; } catch (e) {}
    applyLang(lang);          // also renders monitor
    renderPillars();
    renderHeroMap();
    renderSectorMap();
    renderDashPreview();
    setupDemo();
    animateCounters();
    observeReveals(document);
    setupTimeline();
    setupNav();
    setupForm();
    setupDashboard();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
