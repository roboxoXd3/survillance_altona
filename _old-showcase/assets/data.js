/* =========================================================================
   JalDrishti — illustrative data model
   -------------------------------------------------------------------------
   ALL figures live here so the program can be edited without touching markup.
   Everything below is ILLUSTRATIVE (plausible shapes, not measured values)
   until the program wires in real laboratory data — flip meta.illustrative
   to false once real series replace these.
   ========================================================================= */

(function () {
  "use strict";

  /* ---- tiny deterministic RNG so the "random" shapes are stable on reload --- */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const WEEKS = 26; // ~6 months of weekly points

  /* Build a plausible weekly series of one of three "shapes". */
  function makeSeries(shape, seed, opts) {
    opts = opts || {};
    const rnd = mulberry32(seed);
    const base = opts.base != null ? opts.base : 30;
    const amp = opts.amp != null ? opts.amp : 18;
    const noise = opts.noise != null ? opts.noise : 4;
    const out = [];
    for (let i = 0; i < WEEKS; i++) {
      const t = i / (WEEKS - 1);
      let v = base;
      if (shape === "seasonal") {
        v = base + amp * Math.sin(t * Math.PI * 2 + (opts.phase || 0));
      } else if (shape === "rising") {
        v = base + amp * t * (opts.slope || 1.4);
      } else if (shape === "falling") {
        v = base + amp * (1 - t) * 0.9;
      } else if (shape === "spike") {
        // outbreak: quiet, sharp rise, decay
        const peak = opts.peak != null ? opts.peak : 0.62;
        const width = opts.width != null ? opts.width : 0.13;
        v = base + amp * Math.exp(-Math.pow((t - peak) / width, 2)) * 2.4;
      } else if (shape === "flat") {
        v = base + amp * 0.15 * Math.sin(t * Math.PI * 3);
      }
      v += (rnd() - 0.5) * noise * 2;
      out.push(Math.max(0, Math.round(v * 10) / 10));
    }
    return out;
  }

  /* ---- Viral / pathogen pillar ------------------------------------------- */
  const pathogens = [
    {
      id: "typhoid", name: "Salmonella Typhi", common: "Typhoid",
      status: "alert", trend: "rising",
      desc: {
        en: "A waterborne bacterium that causes typhoid fever. A rising signal often points to contaminated drinking water in a sector and can precede a cluster of cases by weeks.",
        hi: "जल-जनित जीवाणु जो टाइफाइड बुखार करता है। बढ़ता संकेत किसी सेक्टर में दूषित पेयजल का इशारा देता है और मामलों से कई सप्ताह पहले दिख सकता है।"
      },
      unit: "copies/mL ×1M", threshold: 78,
      series: makeSeries("spike", 11, { base: 24, amp: 24, peak: 0.78, width: 0.16 })
    },
    {
      id: "hepa", name: "Hepatitis A virus", common: "Hepatitis A",
      status: "watch", trend: "rising",
      desc: {
        en: "A liver infection spread through contaminated food and water. Wastewater catches outbreaks early because the virus sheds before symptoms appear.",
        hi: "दूषित भोजन और पानी से फैलने वाला यकृत संक्रमण। लक्षण आने से पहले विषाणु मल में आ जाता है, इसलिए अपशिष्ट जल इसे जल्दी पकड़ता है।"
      },
      unit: "copies/mL ×1M", threshold: 64,
      series: makeSeries("rising", 22, { base: 30, amp: 30, slope: 1.1 })
    },
    {
      id: "dengue", name: "Dengue virus", common: "Dengue",
      status: "watch", trend: "seasonal",
      desc: {
        en: "A mosquito-borne viral fever that rises sharply in the post-monsoon months. Sewage signals help time vector-control before hospitals fill.",
        hi: "मच्छर-जनित विषाणु ज्वर जो मानसून के बाद तेज़ी से बढ़ता है। अपशिष्ट संकेत अस्पताल भरने से पहले मच्छर-नियंत्रण का समय तय करने में मदद करते हैं।"
      },
      unit: "copies/mL ×1M", threshold: 70,
      series: makeSeries("seasonal", 33, { base: 34, amp: 26, phase: -1.2 })
    },
    {
      id: "covid", name: "SARS-CoV-2", common: "COVID-19",
      status: "low", trend: "falling",
      desc: {
        en: "The virus behind COVID-19. Wastewater tracking has tracked community spread worldwide since 2020 — independent of how much clinical testing is done.",
        hi: "कोविड-19 का कारक विषाणु। 2020 से दुनिया भर में अपशिष्ट जल निगरानी ने सामुदायिक फैलाव को मापा है — चाहे कितनी भी क्लिनिकल जाँच हो।"
      },
      unit: "copies/mL ×1M", threshold: 80,
      series: makeSeries("falling", 44, { base: 28, amp: 40 })
    },
    {
      id: "flu", name: "Influenza A / RSV", common: "Flu & RSV",
      status: "low", trend: "seasonal",
      desc: {
        en: "Respiratory viruses that surge in winter. Combined wastewater signals give an early read on the season's burden on clinics and hospitals.",
        hi: "श्वसन विषाणु जो सर्दियों में बढ़ते हैं। संयुक्त अपशिष्ट संकेत मौसमी बोझ का जल्दी अनुमान देते हैं।"
      },
      unit: "copies/mL ×1M", threshold: 72,
      series: makeSeries("seasonal", 55, { base: 26, amp: 22, phase: 0.6 })
    },
    {
      id: "cholera", name: "Vibrio cholerae", common: "Cholera",
      status: "low", trend: "stable",
      desc: {
        en: "A waterborne bacterium causing acute diarrhoeal disease. A baseline signal confirms safe water; any rise is an immediate flag for a sector's supply.",
        hi: "जल-जनित जीवाणु जो तीव्र अतिसार करता है। आधार-रेखा संकेत सुरक्षित पानी की पुष्टि करता है; कोई भी वृद्धि तुरंत चेतावनी है।"
      },
      unit: "copies/mL ×1M", threshold: 60,
      series: makeSeries("flat", 66, { base: 14, amp: 10 })
    }
  ];

  /* ---- NCD / lifestyle pillar -------------------------------------------- */
  const ncd = [
    {
      id: "alcohol", name: "Alcohol", common: "Alcohol (EtG/EtS)",
      status: "watch", trend: "rising",
      desc: {
        en: "Ethyl-glucuronide and ethyl-sulfate are direct metabolites of alcohol. Community-level trends inform de-addiction and road-safety programmes — never any individual.",
        hi: "एथिल-ग्लुकुरोनाइड और एथिल-सल्फेट शराब के सीधे मेटाबोलाइट हैं। सामुदायिक रुझान नशा-मुक्ति व सड़क-सुरक्षा कार्यक्रमों में मदद करते हैं — किसी व्यक्ति का नहीं।"
      },
      unit: "mg/day/1000 ppl", threshold: 75,
      series: makeSeries("rising", 77, { base: 36, amp: 26, slope: 1.0 })
    },
    {
      id: "tobacco", name: "Tobacco", common: "Tobacco (cotinine)",
      status: "watch", trend: "stable",
      desc: {
        en: "Cotinine is the marker of nicotine use. Sector trends help target tobacco-cessation outreach where it is most needed.",
        hi: "कोटिनीन निकोटीन उपयोग का सूचक है। सेक्टर-रुझान तंबाकू-निषेध अभियान को सही जगह पहुँचाने में मदद करते हैं।"
      },
      unit: "mg/day/1000 ppl", threshold: 70,
      series: makeSeries("flat", 88, { base: 48, amp: 14 })
    },
    {
      id: "diet", name: "Diet quality", common: "Diet markers",
      status: "low", trend: "improving",
      desc: {
        en: "Dietary biomarkers (e.g. fibre and sugar metabolites) give a population read on nutrition — useful for public-health and school-meal policy.",
        hi: "आहार बायोमार्कर (जैसे फाइबर व शर्करा मेटाबोलाइट) पोषण का सामुदायिक संकेत देते हैं — जन-स्वास्थ्य व मिड-डे-मील नीति के लिए उपयोगी।"
      },
      unit: "index", threshold: 80,
      series: makeSeries("rising", 99, { base: 40, amp: 18, slope: 0.7 })
    },
    {
      id: "pharma", name: "Cardio-metabolic drugs", common: "Diabetes & cardio signal",
      status: "watch", trend: "rising",
      desc: {
        en: "Metabolites of widely-used diabetes and blood-pressure medicines act as a proxy for chronic-disease load — supporting screening-camp planning.",
        hi: "मधुमेह व रक्तचाप की दवाओं के मेटाबोलाइट दीर्घकालिक रोग-भार के संकेतक हैं — जाँच-शिविरों की योजना में सहायक।"
      },
      unit: "mg/day/1000 ppl", threshold: 72,
      series: makeSeries("rising", 121, { base: 33, amp: 24, slope: 1.2 })
    }
  ];

  /* ---- Map: weekly sector signal frames ---------------------------------- */
  /* Abstract grid standing in for Chandigarh's sectors. An illustrative
     typhoid cluster emerges in the south-west, spreads, then decays. */
  const COLS = 8, ROWS = 6, NCELL = COLS * ROWS;
  const sectorIds = [];
  for (let i = 0; i < NCELL; i++) sectorIds.push("Sec " + (i + 1));

  function levelToStatus(v) {
    if (v >= 0.66) return "alert";
    if (v >= 0.34) return "watch";
    return "low";
  }

  const sectorsByWeek = [];
  const seedRnd = mulberry32(2024);
  // a focus cluster (a few adjacent cells in the lower-left)
  const focus = [32, 33, 40, 41, 34, 42];
  for (let w = 0; w < WEEKS; w++) {
    const t = w / (WEEKS - 1);
    const outbreak = Math.exp(-Math.pow((t - 0.74) / 0.15, 2)); // peaks ~week 19
    const frame = [];
    for (let c = 0; c < NCELL; c++) {
      let v = 0.10 + seedRnd() * 0.08; // baseline murmur
      if (focus.indexOf(c) !== -1) {
        v += outbreak * (0.85 + seedRnd() * 0.15);
      } else {
        // light spillover to neighbours of the focus, scaled down
        const near = focus.some(f => Math.abs((f % COLS) - (c % COLS)) <= 1 &&
                                       Math.abs(Math.floor(f / COLS) - Math.floor(c / COLS)) <= 1);
        if (near) v += outbreak * (0.35 + seedRnd() * 0.2);
      }
      v = Math.min(1, v);
      frame.push({ sector: sectorIds[c], value: Math.round(v * 100) / 100, status: levelToStatus(v) });
    }
    sectorsByWeek.push(frame);
  }

  /* week date labels (Mondays, illustrative) */
  const weekLabels = [];
  const start = new Date(2025, 0, 6); // Mon 6 Jan 2025
  for (let w = 0; w < WEEKS; w++) {
    const d = new Date(start.getTime() + w * 7 * 86400000);
    weekLabels.push(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }));
  }

  window.DATA = {
    meta: {
      illustrative: true,
      program: "JalDrishti",
      location: "Chandigarh UT",
      population: "12.94 lakh",
      sectors: 80,
      sites: 5,
      cols: COLS, rows: ROWS
    },
    pathogens: pathogens,
    ncd: ncd,
    sectorsByWeek: sectorsByWeek,
    weekLabels: weekLabels
  };
})();
