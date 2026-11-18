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
  // Zoom behaviour. The defaults are the chosen behaviour; a preview page may switch them.
  //   dir : "auto" = horizontal drag zooms dates, vertical drag zooms values, diagonal drag zooms both
  //         "box"  = every drag zooms dates and values
  //   axes: "all"    = a value zoom rescales both the % axis and the price axis to the box
  //         "region" = only the axis of the part of the chart the box covers
  //   undo: "all"  = double-click leaves every zoom level at once; "step" = one level per double-click
  const OPT = (window.AASI_OPTS = Object.assign({ dir: "auto", axes: "all", undo: "all" }, window.AASI_OPTS || {}));

  // view: "home" = selected period (default 1 year), "full" = whole history, "zoom" = boxes picked by dragging.
  // Double-click toggles home <-> full, or leaves the zoom back to the view it started from.
  const view = { mode: "home", homeKey: "365", prev: "home", stack: [] };
  const zoomNow = () => (view.mode === "zoom" && view.stack.length ? view.stack[view.stack.length - 1] : null);

  (window.AASI_DATA
    ? Promise.resolve(window.AASI_DATA)
    : fetch("../data/aasi.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }))
    .then((json) => {
      D = json;
      const s0 = parseDay(D.start);
      X = D.series.price.map((_, i) => s0 + i * DAY);
      if ($("card-zone")) renderStatus();
      if ($("sig-table")) renderSignals();
      buildCharts();
      setupRanges();
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", buildCharts);
    })
    .catch((e) => {
      if ($("updated")) $("updated").textContent = "데이터를 불러오지 못했습니다 (" + e.message + ").";
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
    return { min: Math.max(X[0], last - Number(key) * DAY), max: last };
  }

  function applyView() {
    const z = zoomNow();
    if (!z && view.mode === "zoom") view.mode = view.prev;
    const r = z ? z.x : rangeFor(view.mode === "full" ? "all" : view.homeKey);
    charts.forEach((c) => c.setScale("x", { min: r.min, max: r.max }));
    const pressed = view.mode === "full" ? "all" : view.mode === "home" ? view.homeKey : null;
    document.querySelectorAll(".ranges button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === pressed)));
    const hint = $("view-hint");
    if (hint) {
      const back = OPT.undo === "step" && view.stack.length > 1 ? "한 단계 전 화면" : "확대 전 화면";
      hint.textContent = z ? "확대 중입니다" + (view.stack.length > 1 ? " (" + view.stack.length + "단계)" : "") + ". 더블클릭하면 " + back + "으로 돌아갑니다." : "";
    }
  }

  // leave any zoom (used by the preview page when its options change)
  window.AASI_resetZoom = () => {
    if (view.mode === "zoom") {
      view.stack = [];
      view.mode = view.prev;
      applyView();
    }
  };

  function onDoubleClick() {
    if (view.mode === "zoom") {
      if (OPT.undo === "step" && view.stack.length > 1) view.stack.pop();
      else {
        view.stack = [];
        view.mode = view.prev;
      }
    } else view.mode = view.mode === "home" ? "full" : "home";
    applyView();
  }

  // kind: "x" = dates only, "y" = values only, "xy" = both. b = box in CSS px inside the plot area.
  function zoomBox(u, kind, b) {
    const cur = zoomNow();
    const next = {
      x: { min: u.scales.x.min, max: u.scales.x.max },
      y: cur ? cur.y : null,
      price: cur ? cur.price : null,
    };
    if (kind !== "y") {
      const min = u.posToVal(b.left, "x"), max = u.posToVal(b.left + b.width, "x");
      if (max - min < 3 * DAY) return; // too narrow to be useful
      next.x = { min, max };
    }
    if (kind !== "x") {
      const H = u.over.clientHeight;
      let keys = ["y", "price"];
      if (OPT.axes === "region") {
        const top = b.top / H, bottom = (b.top + b.height) / H;
        if (bottom <= 0.55) keys = ["price"]; // box in the upper (price) part
        else if (top >= 0.45) keys = ["y"]; // box in the lower (change-rate) part
      }
      for (const k of keys) next[k] = { min: u.posToVal(b.top + b.height, k), max: u.posToVal(b.top, k) };
    }
    if (view.mode !== "zoom") {
      view.prev = view.mode;
      view.stack = [];
    }
    view.mode = "zoom";
    view.stack.push(next);
    applyView();
  }

  // Drag (single press, or the second press of a double-click): pick a box, release to zoom.
  // Double-click without dragging: see onDoubleClick.
  const DBL_MS = 500, DBL_PX = 16, DRAG_PX = 6, MIN_1D = 20;
  let lastClick = { t: 0, x: 0, y: 0 };

  function dragKind(dx, dy, pointerType) {
    if (pointerType === "touch") return "x"; // vertical swipes keep scrolling the page
    if (OPT.dir === "box") return dy < DRAG_PX ? "x" : dx < DRAG_PX ? "y" : "xy";
    if (dx < MIN_1D && dy < MIN_1D) return dx >= dy ? "x" : "y";
    if (dy < MIN_1D) return "x";
    if (dx < MIN_1D) return "y";
    return "xy";
  }

  function attachGestures(u) {
    const over = u.over;
    const sel = el("div", "zsel");
    ["tl", "tr", "bl", "br"].forEach((c) => sel.append(el("span", "c " + c)));
    over.append(sel);
    let down = null;
    const pos = (e) => {
      const r = over.getBoundingClientRect();
      return {
        x: Math.min(Math.max(e.clientX - r.left, 0), over.clientWidth),
        y: Math.min(Math.max(e.clientY - r.top, 0), over.clientHeight),
      };
    };
    const boxOf = (d, p, kind) => {
      const W = over.clientWidth, H = over.clientHeight;
      return {
        left: kind === "y" ? 0 : Math.min(d.x, p.x),
        width: kind === "y" ? W : Math.abs(p.x - d.x),
        top: kind === "x" ? 0 : Math.min(d.y, p.y),
        height: kind === "x" ? H : Math.abs(p.y - d.y),
      };
    };

    over.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const p = pos(e);
      const second = e.timeStamp - lastClick.t < DBL_MS && Math.abs(p.x - lastClick.x) < DBL_PX && Math.abs(p.y - lastClick.y) < DBL_PX;
      down = { x: p.x, y: p.y, second, moved: false, type: e.pointerType };
      e.preventDefault(); // no text selection while dragging
      over.setPointerCapture(e.pointerId);
    });
    over.addEventListener("pointermove", (e) => {
      if (!down) return;
      const p = pos(e);
      const dx = Math.abs(p.x - down.x), dy = Math.abs(p.y - down.y);
      if (dx > DRAG_PX || (dy > DRAG_PX && down.type !== "touch")) down.moved = true;
      if (!down.moved) return;
      const kind = dragKind(dx, dy, down.type);
      const b = boxOf(down, p, kind);
      sel.className = "zsel k" + kind;
      Object.assign(sel.style, { display: "block", left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px" });
      over.classList.add("dragging");
    });
    const finish = (e, cancelled) => {
      if (!down) return;
      const d = down;
      down = null;
      sel.style.display = "none";
      over.classList.remove("dragging");
      if (cancelled) return;
      const p = pos(e);
      if (d.moved) {
        lastClick.t = 0;
        const kind = dragKind(Math.abs(p.x - d.x), Math.abs(p.y - d.y), d.type);
        zoomBox(u, kind, boxOf(d, p, kind));
      } else if (d.second) {
        lastClick.t = 0;
        onDoubleClick();
      } else {
        lastClick = { t: e.timeStamp, x: d.x, y: d.y };
      }
    };
    over.addEventListener("pointerup", (e) => finish(e, false));
    over.addEventListener("pointercancel", (e) => finish(e, true));
  }

  // log ticks with round values: wide ranges 1-3-10, medium 1-2-5, narrow finer steps
  function logSplits(min, max, maxTicks) {
    const decades = Math.log10(max / min);
    if (decades < 0.35) {
      // narrow zoom: plain round numbers
      const raw = (max - min) / maxTicks, mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => (max - min) / s <= maxTicks) || 10 * mag;
      const out = [];
      for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
      return out;
    }
    const pick = (mants) => {
      const out = [];
      for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++)
        for (const m of mants) {
          const v = m * Math.pow(10, e);
          if (v >= min && v <= max) out.push(v);
        }
      return out;
    };
    let out = pick(decades > 2.2 ? [1] : decades > 0.9 ? [1, 2, 5] : [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8]);
    if (out.length < 3 && decades > 2.2) out = pick([1, 3]);
    const step = Math.ceil(out.length / maxTicks);
    return out.filter((_, i) => i % step === 0);
  }
  const usdShort = (v) =>
    v >= 1e6 ? "$" + +(v / 1e6).toFixed(2) + "M" : v >= 1000 ? "$" + +(v / 1000).toFixed(1) + "k" : v >= 10 ? "$" + nf0.format(v) : "$" + +v.toFixed(2);

  function buildCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
    const S = D.series;
    const C = {
      text: cssVar("--text-secondary"),
      grid: cssVar("--grid"),
      zero: cssVar("--grid-strong"),
      pc: cssVar("--series-price-chg"),
      aa: cssVar("--series-aa"),
      up: cssVar("--band-upper"),
      dn: cssVar("--band-lower"),
      price: cssVar("--series-price"),
      surface: cssVar("--surface-1"),
    };
    const box = $("chart-aasi");
    const narrow = () => window.innerWidth < 560;
    const height = () => (narrow() ? 380 : Math.round(Math.min(760, Math.max(540, box.clientWidth * 0.36))));
    const axisBase = { stroke: C.text, ticks: { show: false }, font: "12px sans-serif", grid: { show: false } };

    // signal markers sit on the price line
    const over = S.price.map(() => null), under = S.price.map(() => null);
    const idx = new Map(X.map((x, i) => [ymd(x), i]));
    for (const e of D.entries) {
      const i = idx.get(e.date);
      if (i != null) (e.zone === "over" ? over : under)[i] = S.price[i];
    }
    const showPts = (u) => u.scales.x.max - u.scales.x.min <= 1100 * DAY; // too dense on longer views
    const pts = (color) => ({ show: showPts, size: 8, fill: color, stroke: C.surface, width: 1.5 });

    const PCT_TOP = 0.6, PRICE_BOTTOM = 0.52;
    // Layout like the original chart: the change-rate lines fill the lower part,
    // the BTC price (log) the upper part. Ranges follow the visible period.
    const pctRange = (u, min, max) => {
      const z = zoomNow();
      if (z && z.y) return [z.y.min, z.y.max];
      if (min == null || max == null) return [-0.5, 1];
      const R = Math.max(max - min, 0.05) / PCT_TOP;
      const lo = min - 0.03 * R;
      return [lo, lo + R];
    };
    const priceRange = (u, min, max) => {
      const z = zoomNow();
      if (z && z.price) return [z.price.min, z.price.max];
      if (!(min > 0) || !(max > 0)) return [1, 10];
      const lmin = Math.log10(min), lmax = Math.log10(max);
      const R = Math.max(lmax - lmin, 0.15) / (0.95 - PRICE_BOTTOM);
      const lo = lmin - PRICE_BOTTOM * R;
      return [Math.pow(10, lo), Math.pow(10, lo + R)];
    };

    const u = new uPlot(
      {
        width: box.clientWidth,
        height: height(),
        legend: { show: false },
        tzDate: utc,
        cursor: { drag: { x: false, y: false, setScale: false }, points: { size: 7 }, bind: { dblclick: () => () => null } },
        scales: {
          x: { time: true },
          y: { range: pctRange },
          price: { distr: 3, range: priceRange },
        },
        axes: [
          Object.assign({}, axisBase, { values: xValues, space: 90 }),
          Object.assign({}, axisBase, {
            scale: "y",
            size: 52,
            space: 70,
            grid: { show: true, stroke: C.grid, width: 1 },
            // ticks and grid only in the lower part where the change-rate lines live
            splits: (u, ax, min, max) => {
              const z = zoomNow();
              const lim = z && z.y ? max : min + PCT_TOP * (max - min);
              const want = narrow() ? 4 : 6;
              const step = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2].find((s) => (lim - min) / s <= want) || 5;
              const out = [];
              for (let v = Math.ceil(min / step) * step; v <= lim + 1e-9; v += step) out.push(+v.toFixed(4));
              return out;
            },
            values: (u, vs) => {
              const step = vs.length > 1 ? Math.abs(vs[1] - vs[0]) : 1;
              return vs.map((v) => (v * 100).toFixed(step < 0.01 ? 1 : 0) + "%");
            },
          }),
          Object.assign({}, axisBase, {
            scale: "price",
            side: 1,
            size: 60,
            filter: (u, splits) => splits, // keep every label (uPlot thins log-axis labels by default)
            // label only the upper band of the chart where the price line lives
            splits: (u, ax, min, max) => {
              const z = zoomNow();
              if (z && z.price) return logSplits(min, max, narrow() ? 4 : 7);
              const lmin = Math.log10(min), lmax = Math.log10(max);
              return logSplits(Math.pow(10, lmin + (PRICE_BOTTOM - 0.06) * (lmax - lmin)), max, narrow() ? 4 : 5);
            },
            values: (u, vs) => vs.map((v) => (v == null ? "" : usdShort(v))),
          }),
        ],
        series: [
          {},
          { label: "활성 주소 28일 변화율", scale: "y", stroke: C.aa, width: 1 },
          { label: "BTC 가격", scale: "price", stroke: C.price, width: 1.6 },
          { label: "상단 밴드", scale: "y", stroke: C.up, width: 1.5, dash: [5, 4] },
          { label: "하단 밴드", scale: "y", stroke: C.dn, width: 1.5, dash: [5, 4] },
          { label: "가격 28일 변화율", scale: "y", stroke: C.pc, width: 2 },
          { label: "과열 진입", scale: "price", stroke: C.up, paths: () => null, points: pts(C.up) },
          { label: "과매도 진입", scale: "price", stroke: C.dn, paths: () => null, points: pts(C.dn) },
        ],
        plugins: [
          zeroLine(C.zero),
          tooltipPlugin((tip, i) => {
            tip.append(el("div", "t", ymd(X[i])));
            tipRow(tip, { color: C.price }, "BTC 가격", usd(S.price[i]));
            tipRow(tip, { color: C.pc }, "가격 28일 변화율", pct(S.px_chg[i]));
            tipRow(tip, { color: C.up, dash: true }, "상단 밴드", pct(S.upper[i]));
            tipRow(tip, { color: C.dn, dash: true }, "하단 밴드", pct(S.lower[i]));
            tipRow(tip, { color: C.aa }, "활성 주소 28일", pct(S.aa_chg[i]));
            const z = zoneOf(S.px_chg[i], S.upper[i], S.lower[i]);
            if (z) tipRow(tip, null, "구간", ZONE[z].label);
            if (over[i] != null) tipRow(tip, null, "신호", "과열 구간 진입");
            if (under[i] != null) tipRow(tip, null, "신호", "과매도 구간 진입");
          }),
        ],
      },
      [X, S.aa_chg, S.price, S.upper, S.lower, S.px_chg, over, under],
      box
    );

    charts = [u];
    charts.forEach(attachGestures);
    applyView();

    if (ro) ro.disconnect();
    ro = new ResizeObserver(() => u.setSize({ width: box.clientWidth, height: height() }));
    ro.observe(box);
  }

  function setupRanges() {
    document.querySelectorAll(".ranges button").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.range;
        view.stack = [];
        if (k === "all") view.mode = "full";
        else {
          view.homeKey = k;
          view.mode = "home";
        }
        applyView();
      })
    );
  }
})();
