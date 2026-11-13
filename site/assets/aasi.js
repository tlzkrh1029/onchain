(function () {
  "use strict";

  const DAY = 86400;
  const ZONE = {
    over: { label: "과열", ico: "▲" },
    under: { label: "과매도", ico: "▼" },
    in: { label: "중립", ico: "●" },
  };

  // ---------- formatting ----------
  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const pct = (v, d = 1) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(d) + "%");
  const pp = (v, d = 1) => Math.abs(v * 100).toFixed(d) + "%p";
  const usd = (v) => (v == null ? "—" : "$" + nf0.format(v));
  const ymd = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
  const parseDay = (s) => Date.parse(s + "T00:00:00Z") / 1000;
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const utc = (ts) => uPlot.tzDate(new Date(ts * 1e3), "Etc/UTC");
  const zoneOf = (pc, ub, lb) => (pc == null || ub == null || lb == null ? null : pc > ub ? "over" : pc < lb ? "under" : "in");

  function zoneTag(z) {
    const t = el("span", "zone-tag " + z);
    t.append(el("span", "ico", ZONE[z].ico), el("span", null, ZONE[z].label));
    return t;
  }

  // ---------- data ----------
  let D = null; // payload
  let X = []; // unix seconds
  let charts = [];
  let ro = null;
  let currentRange = "365";

  fetch("../data/aasi.json", { cache: "no-cache" })
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((json) => {
      D = json;
      const s0 = parseDay(D.start);
      X = D.series.price.map((_, i) => s0 + i * DAY);
      renderStatus();
      renderSignals();
      buildCharts();
      setupRanges();
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", buildCharts);
    })
    .catch((e) => {
      $("updated").textContent = "데이터를 불러오지 못했습니다 (" + e.message + ").";
    });

  // ---------- status ----------
  function renderStatus() {
    const L = D.latest;
    const gen = D.meta.generated_at; // 2026-11-13T07:41Z
    const genDate = new Date(gen.replace("Z", ":00Z"));
    const kst = new Date(genDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    let upd = "마지막 갱신 " + gen.replace("T", " ").replace("Z", " UTC") + " (한국 시간 " + kst + ")";
    if (D.meta.data_origin === "cache") upd += " · 이번 갱신에서는 Coin Metrics에 접속하지 못해 직전에 저장한 데이터를 사용했습니다.";
    $("updated").textContent = upd;

    const cmDay = ymd(parseDay(L.date) - DAY);
    $("status-sub").textContent = "기준일 " + L.date + " (Coin Metrics 원자료의 " + cmDay + " 데이터)";

    const card = $("card-zone");
    card.classList.add("zone-" + L.zone);
    const tag = $("zone-tag");
    tag.replaceWith(Object.assign(zoneTag(L.zone), { id: "zone-tag" }));
    let desc;
    if (L.zone === "over") desc = "가격 변화율이 상단 밴드보다 " + pp(L.px_chg - L.upper) + " 높습니다.";
    else if (L.zone === "under") desc = "가격 변화율이 하단 밴드보다 " + pp(L.lower - L.px_chg) + " 낮습니다.";
    else desc = "밴드 안에 있습니다. 상단까지 " + pp(L.upper - L.px_chg) + ", 하단까지 " + pp(L.px_chg - L.lower) + " 남았습니다.";
    $("zone-desc").textContent = desc;

    $("v-pc").textContent = pct(L.px_chg);
    $("d-pc").textContent = "BTC " + usd(L.price) + " (00:00 UTC 기준)";
    $("v-band").textContent = pct(L.lower) + " ~ " + pct(L.upper);
    $("v-aa").textContent = pct(L.aa_chg);
    $("d-aa").textContent = "활성 주소 " + nf0.format(L.active_addresses) + "개 (기준일 하루 동안)";

    if (L.last_entry) {
      const days = Math.round((parseDay(L.date) - parseDay(L.last_entry.date)) / DAY);
      $("v-last").textContent = L.last_entry.date;
      const still = L.zone === L.last_entry.zone ? ", 현재 이어지는 중" : "";
      $("d-last").textContent = ZONE[L.last_entry.zone].label + " 구간 진입 · " + (days === 0 ? "오늘" : days + "일 전") + still;
    }
  }

  // ---------- signals ----------
  function median(a) {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function renderSignals() {
    const box = $("sig-stats");
    box.textContent = "";
    for (const z of ["under", "over"]) {
      const done = D.entries.filter((e) => e.zone === z && e.fwd_28d != null);
      const all = D.entries.filter((e) => e.zone === z);
      const card = el("div", "card");
      const k = el("div", "k");
      k.append(zoneTag(z), document.createTextNode(" 구간 진입 후 28일 가격 변화"));
      const v = el("div", "v", done.length ? pct(median(done.map((e) => e.fwd_28d))) : "—");
      const share = done.length ? Math.round((100 * done.filter((e) => e.fwd_28d > 0).length) / done.length) : 0;
      const d = el(
        "div",
        "d",
        "중앙값 · 신호 " + all.length + "회 중 28일이 지난 " + done.length + "회 기준, 가격이 오른 비율 " + share + "%"
      );
      card.append(k, v, d);
      box.append(card);
    }
    drawTable(false);
    $("sig-more").addEventListener("click", () => {
      const all = $("sig-more").dataset.all !== "1";
      $("sig-more").dataset.all = all ? "1" : "0";
      $("sig-more").textContent = all ? "최근 20개만 보기" : "전체 신호 보기";
      drawTable(all);
    });
  }

  function drawTable(all) {
    const tb = $("sig-table").querySelector("tbody");
    tb.textContent = "";
    const rows = [...D.entries].reverse();
    for (const e of all ? rows : rows.slice(0, 20)) {
      const tr = el("tr");
      const z = el("td", "l");
      z.append(zoneTag(e.zone));
      tr.append(
        el("td", null, e.date),
        z,
        el("td", null, usd(e.price)),
        el("td", null, pct(e.px_chg)),
        el("td", null, e.fwd_28d == null ? "28일 경과 전" : pct(e.fwd_28d))
      );
      tb.append(tr);
    }
  }

  // ---------- charts ----------
  function xValues(u, splits, ax, space, incr) {
    return splits.map((s) => {
      const d = ymd(s);
      if (incr >= 360 * DAY) return d.slice(0, 4);
      if (incr >= 28 * DAY) return d.slice(0, 7).replace("-", ".");
      return d.slice(5).replace("-", ".");
    });
  }

  function tooltipPlugin(fill) {
    let tip;
    return {
      hooks: {
        init: (u) => {
          tip = el("div", "tip");
          u.over.appendChild(tip);
          u.over.addEventListener("mouseleave", () => (tip.style.display = "none"));
        },
        setCursor: (u) => {
          const i = u.cursor.idx;
          if (i == null || u.cursor.left < 0) {
            tip.style.display = "none";
            return;
          }
          tip.textContent = "";
          fill(tip, i);
          tip.style.display = "block";
          const w = tip.offsetWidth, h = tip.offsetHeight;
          const W = u.over.clientWidth, H = u.over.clientHeight;
          let left = u.cursor.left + 14;
          if (left + w > W) left = u.cursor.left - w - 14;
          let top = u.cursor.top + 14;
          if (top + h > H) top = Math.max(0, H - h);
          tip.style.left = Math.max(0, left) + "px";
          tip.style.top = top + "px";
        },
      },
    };
  }

  function tipRow(tip, mk, label, value) {
    const r = el("div", "r");
    const l = el("span");
    if (mk) {
      const m = el("span", "mk");
      m.style.borderColor = mk.color;
      if (mk.dash) m.style.borderTopStyle = "dashed";
      l.append(m);
    }
    l.append(document.createTextNode(label));
    r.append(l, el("b", null, value));
    tip.append(r);
  }

  function zeroLine(color) {
    return {
      hooks: {
        draw: (u) => {
          const y = u.valToPos(0, "y", true);
          if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
          const ctx = u.ctx;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 1 * devicePixelRatio;
          ctx.beginPath();
          ctx.moveTo(u.bbox.left, y);
          ctx.lineTo(u.bbox.left + u.bbox.width, y);
          ctx.stroke();
          ctx.restore();
        },
      },
    };
  }

  function rangeFor(key) {
    const last = X[X.length - 1];
    if (key === "all") return { min: X[0], max: last };
    return { min: last - Number(key) * DAY, max: last };
  }

  let syncing = false;
  function syncX(u) {
    if (syncing) return;
    syncing = true;
    const { min, max } = u.scales.x;
    charts.forEach((c) => c !== u && c.setScale("x", { min, max }));
    syncing = false;
  }

  function buildCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
    const S = D.series;
    const C = {
      text: cssVar("--text-secondary"),
      grid: cssVar("--grid"),
      pc: cssVar("--series-price-chg"),
      aa: cssVar("--series-aa"),
      up: cssVar("--band-upper"),
      dn: cssVar("--band-lower"),
      price: cssVar("--series-price"),
      surface: cssVar("--surface-1"),
      muted: cssVar("--text-muted"),
    };
    const narrow = () => window.innerWidth < 560;
    const axisBase = { stroke: C.text, grid: { stroke: C.grid, width: 1 }, ticks: { show: false }, font: "12px sans-serif" };
    const xAxis = Object.assign({}, axisBase, { values: xValues, space: 64 });
    const cursor = {
      sync: { key: "aasi" },
      drag: { x: true, y: false },
      points: { size: 7 },
      // double-click returns to the selected range instead of the full history
      bind: { dblclick: () => () => { applyRange(currentRange); return null; } },
    };

    // 1) AASI
    const box1 = $("chart-aasi");
    const u1 = new uPlot(
      {
        width: box1.clientWidth,
        height: narrow() ? 270 : 360,
        legend: { show: false },
        tzDate: utc,
        cursor,
        scales: { x: { time: true } },
        axes: [xAxis, Object.assign({}, axisBase, { size: 48, values: (u, vs) => vs.map((v) => Math.round(v * 100) + "%") })],
        series: [
          {},
          { label: "활성 주소 28일 변화율", stroke: C.aa, width: 1 },
          { label: "상단 밴드", stroke: C.up, width: 1.5, dash: [5, 4] },
          { label: "하단 밴드", stroke: C.dn, width: 1.5, dash: [5, 4] },
          { label: "가격 28일 변화율", stroke: C.pc, width: 2 },
        ],
        plugins: [
          zeroLine(C.muted),
          tooltipPlugin((tip, i) => {
            tip.append(el("div", "t", ymd(X[i])));
            const z = zoneOf(S.px_chg[i], S.upper[i], S.lower[i]);
            tipRow(tip, { color: C.pc }, "가격 28일 변화율", pct(S.px_chg[i]));
            tipRow(tip, { color: C.up, dash: true }, "상단 밴드", pct(S.upper[i]));
            tipRow(tip, { color: C.dn, dash: true }, "하단 밴드", pct(S.lower[i]));
            tipRow(tip, { color: C.aa }, "활성 주소 28일", pct(S.aa_chg[i]));
            if (z) tipRow(tip, null, "구간", ZONE[z].label);
          }),
        ],
        hooks: { setScale: [(u, key) => key === "x" && syncX(u)] },
      },
      [X, S.aa_chg, S.upper, S.lower, S.px_chg],
      box1
    );

    // 2) price + entries
    const over = S.price.map(() => null), under = S.price.map(() => null);
    const idx = new Map(X.map((x, i) => [ymd(x), i]));
    for (const e of D.entries) {
      const i = idx.get(e.date);
      if (i != null) (e.zone === "over" ? over : under)[i] = S.price[i];
    }
    const pts = (color) => ({ show: true, size: 9, fill: color, stroke: C.surface, width: 1.5 });
    const box2 = $("chart-price");
    const u2 = new uPlot(
      {
        width: box2.clientWidth,
        height: narrow() ? 220 : 270,
        legend: { show: false },
        tzDate: utc,
        cursor,
        scales: { x: { time: true }, y: { distr: 3, range: (u, min, max) => [min / 1.12, max * 1.12] } },
        axes: [
          xAxis,
          Object.assign({}, axisBase, {
            size: 56,
            filter: (u, splits) => splits, // keep every label (uPlot thins log-axis labels by default)
            splits: (u, ax, min, max) => {
              const out = [];
              for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++)
                for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8]) {
                  const v = m * Math.pow(10, e);
                  if (v >= min && v <= max) out.push(v);
                }
              const step = Math.ceil(out.length / (narrow() ? 4 : 6));
              return out.filter((_, i) => i % step === 0);
            },
            values: (u, vs) => vs.map((v) => (v == null ? "" : v >= 1e6 ? "$" + +(v / 1e6).toFixed(1) + "M" : v >= 1000 ? "$" + nf0.format(v / 1000) + "k" : "$" + nf0.format(v))),
          }),
        ],
        series: [
          {},
          { label: "BTC 가격", stroke: C.price, width: 1.5 },
          { label: "과열 진입", stroke: C.up, paths: () => null, points: pts(C.up) },
          { label: "과매도 진입", stroke: C.dn, paths: () => null, points: pts(C.dn) },
        ],
        plugins: [
          tooltipPlugin((tip, i) => {
            tip.append(el("div", "t", ymd(X[i])));
            tipRow(tip, { color: C.price }, "BTC 가격", usd(S.price[i]));
            const z = zoneOf(S.px_chg[i], S.upper[i], S.lower[i]);
            if (z) tipRow(tip, null, "구간", ZONE[z].label);
            if (over[i] != null) tipRow(tip, null, "신호", "과열 구간 진입");
            if (under[i] != null) tipRow(tip, null, "신호", "과매도 구간 진입");
          }),
        ],
        hooks: { setScale: [(u, key) => key === "x" && syncX(u)] },
      },
      [X, S.price, over, under],
      box2
    );

    charts = [u1, u2];
    applyRange(currentRange);

    if (ro) ro.disconnect();
    ro = new ResizeObserver(() => {
      u1.setSize({ width: box1.clientWidth, height: narrow() ? 270 : 360 });
      u2.setSize({ width: box2.clientWidth, height: narrow() ? 220 : 270 });
    });
    ro.observe(box1);
  }

  function applyRange(key) {
    currentRange = key;
    const r = rangeFor(key);
    charts.forEach((c) => c.setScale("x", r));
    document.querySelectorAll(".ranges button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === key)));
  }

  function setupRanges() {
    document.querySelectorAll(".ranges button").forEach((b) => b.addEventListener("click", () => applyRange(b.dataset.range)));
  }
})();
