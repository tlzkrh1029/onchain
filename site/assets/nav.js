/*
 * Left sidebar shared by every page.
 *
 * To add an indicator, add one entry to an existing group in NAV (or add a new group).
 *   name      : label shown in the list
 *   path      : folder under site/, ending with "/" (e.g. "nvt/")
 *   summary   : one sentence shown on the home page card
 *   keywords  : extra words the search box should match
 *   status    : optional key of a home-page status renderer (see home page script)
 * An item may appear in several groups.
 *
 * Usage on a page:  <aside class="side" id="side"></aside>
 *                   <script src="{root}assets/nav.js" data-root="{root}"></script>
 */
(function () {
  "use strict";

  const NAV = [
    {
      id: "onchain",
      title: "온체인 지표",
      items: [
        {
          name: "AASI (활성 주소 심리 지표)",
          path: "aasi/",
          summary: "활성 주소 수와 가격의 28일 변화율을 비교해 단기 과열과 과매도를 판단합니다.",
          keywords: "aasi active address sentiment 활성 주소 심리 단기 과열 과매도",
          status: "aasi",
        },
      ],
    },
    {
      id: "near-term",
      title: "단기 흐름",
      items: [{ ref: "aasi/" }],
    },
  ];

  // resolve { ref } entries to the full item defined elsewhere
  const byPath = new Map();
  NAV.forEach((g) => g.items.forEach((it) => it.path && byPath.set(it.path, it)));
  NAV.forEach((g) => (g.items = g.items.map((it) => (it.ref ? byPath.get(it.ref) : it)).filter(Boolean)));
  window.ONCHAIN_NAV = NAV;
  window.ONCHAIN_ITEMS = [...byPath.values()];

  const script = document.currentScript;
  const root = (script && script.dataset.root) || "./";
  const side = document.getElementById("side");
  if (!side) return;

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("onchain." + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("onchain." + k, JSON.stringify(v));
      } catch (e) {}
    },
  };

  const norm = (p) => p.replace(/index\.html$/, "").replace(/\/+$/, "/");
  const here = norm(location.pathname);
  const href = (path) => new URL(root + path, location.href);
  const isHere = (path) => norm(href(path).pathname) === here;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ----- build -----
  side.setAttribute("aria-label", "지표 목록");
  const search = el("input", "side-search");
  search.type = "search";
  search.placeholder = "지표 검색";
  search.setAttribute("aria-label", "지표 검색");

  const home = el("a", "side-link side-home", "전체 지표 보기");
  home.href = href("").href;
  if (isHere("")) home.classList.add("active");

  const groupsBox = el("div", "side-groups");
  const collapsed = store.get("nav.collapsed", {});
  const itemEls = [];

  NAV.forEach((g) => {
    const box = el("div", "side-group");
    const head = el("button", "side-ghead");
    head.type = "button";
    const title = el("span", "t", g.title);
    const count = el("span", "n", String(g.items.length));
    const chev = el("span", "chev", "›");
    head.append(title, count, chev);
    const list = el("ul", "side-list");
    list.id = "nav-" + g.id;
    head.setAttribute("aria-controls", list.id);

    const open = !collapsed[g.id] || g.items.some((it) => isHere(it.path));
    box.classList.toggle("closed", !open);
    head.setAttribute("aria-expanded", String(open));
    head.addEventListener("click", () => {
      const nowOpen = box.classList.toggle("closed") === false;
      head.setAttribute("aria-expanded", String(nowOpen));
      collapsed[g.id] = !nowOpen;
      store.set("nav.collapsed", collapsed);
    });

    g.items.forEach((it) => {
      const li = el("li");
      const a = el("a", "side-link", it.name);
      a.href = href(it.path).href;
      if (isHere(it.path)) {
        a.classList.add("active");
        a.setAttribute("aria-current", "page");
      }
      li.append(a);
      list.append(li);
      itemEls.push({ li, box, text: (it.name + " " + (it.keywords || "")).toLowerCase() });
    });
    box.append(head, list);
    groupsBox.append(box);
  });

  const empty = el("p", "side-empty", "찾는 지표가 없습니다.");
  empty.hidden = true;

  const collapseBtn = el("button", "side-collapse", "‹ 목록 접기");
  collapseBtn.type = "button";
  collapseBtn.addEventListener("click", () => setOpen(false));

  side.append(search, home, groupsBox, empty, collapseBtn);

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    const boxes = new Map();
    let any = false;
    itemEls.forEach(({ li, box, text }) => {
      const hit = !q || q.split(/\s+/).every((w) => text.includes(w));
      li.hidden = !hit;
      if (hit) any = true;
      boxes.set(box, (boxes.get(box) || false) || hit);
    });
    boxes.forEach((hit, box) => {
      box.hidden = !hit;
      if (q && hit) box.classList.remove("closed");
    });
    empty.hidden = any;
  });

  // ----- open / close -----
  const mq = window.matchMedia("(max-width: 900px)");
  function setOpen(open) {
    if (mq.matches) {
      document.body.classList.toggle("side-open", open);
    } else {
      document.body.classList.toggle("side-closed", !open);
      store.set("nav.closed", !open);
    }
    const btn = document.getElementById("menu-btn");
    if (btn) btn.setAttribute("aria-expanded", String(open));
  }
  const isOpen = () => (mq.matches ? document.body.classList.contains("side-open") : !document.body.classList.contains("side-closed"));
  if (!mq.matches && store.get("nav.closed", false)) document.body.classList.add("side-closed");

  const btn = document.getElementById("menu-btn");
  if (btn) {
    btn.setAttribute("aria-controls", "side");
    btn.setAttribute("aria-expanded", String(isOpen()));
    btn.addEventListener("click", () => setOpen(!isOpen()));
  }
  const scrim = el("div", "side-scrim");
  scrim.addEventListener("click", () => setOpen(false));
  document.body.append(scrim);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mq.matches && isOpen()) setOpen(false);
  });
  mq.addEventListener("change", () => {
    document.body.classList.remove("side-open");
    document.body.classList.toggle("side-closed", !mq.matches && store.get("nav.closed", false));
    if (btn) btn.setAttribute("aria-expanded", String(isOpen()));
  });
})();
