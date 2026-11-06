// Spesa Smart · PWA statica. Dati reali da ../data/latest.json (fallback: demo in data.js).
// Design: docs/HANDOFF.md. Logica di formato e confronto: format.js (testata da format.test.mjs).
import { euro, unitPrice, validUntil, updatedAt, discountLabel, savingPct, diffLabel, savingEuro,
  isReliableComparison, sentenceCase, normalizeCategory, listVerdict } from "./format.js?v=202611060857";

/* global CHAINS, PRODUCTS, TODAY */
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const dockAction = $("#dock-action");
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const icon = (id, cls = "") => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const DAY = 86400000;
const CATS = ["Latticini e uova", "Salumi e formaggi", "Pane e colazione", "Pasta, riso e dispensa", "Bevande", "Carne e pesce", "Frutta e verdura", "Surgelati", "Casa e igiene", "Animali"];

/* ---------- Archivio locale (sempre con try/catch: può non esserci) ---------- */
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- Catene e loghi ---------- */
let chainById = Object.fromEntries(CHAINS.map((c) => [c.id, c]));
const DOMAINS = { conad: "conad.it", coop: "coop.it", crai: "crai.it", todis: "todis.it", famila: "famila.it", ao: "aeo.it", bennet: "bennet.com", iperal: "iperal.it", ali: "alisupermercati.it", pewex: "pewex.it", prestofresco: "prestofresco.it", sidis: "sidis.it", sisa: "sisa.it", eurospin: "eurospin.it", penny: "penny.it", aldi: "aldi.it", lidl: "lidl.it", esselunga: "esselunga.it", carrefour: "carrefour.it", md: "mdspa.it", tigros: "tigros.it", basko: "basko.it" };
const chainName = (id) => chainById[id]?.name || ALL_CHAINS.find((c) => c.id === id)?.name || id;
const initials = (name) => name.replace(/[^A-Za-zÀ-ú]/g, "").slice(0, 2);
function logo(id, cls = "") {
  const name = chainName(id), d = DOMAINS[id];
  return `<span class="logo ${cls}" role="img" aria-label="${esc(name)}">${d ? `<img src="https://www.google.com/s2/favicons?domain=${d}&sz=64" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${initials(name)}'))">` : initials(name)}</span>`;
}

/* ---------- Dati ---------- */
let MODE = "demo", FLYERS = {}, ALL_CHAINS = [], INSEGNE = [], GENERATED = null, LOAD_ERROR = false;
const unitShort = (u) => ({ litro: "l", pezzo: "pz" }[u] || u);

async function loadReal() {
  if (new URLSearchParams(location.search).has("demo")) return;
  try {
    const [latest, hist] = await Promise.all(["../data/latest.json", "../data/history.json"].map((u) =>
      fetch(u, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })));
    const day = (d) => new Date(d + "T00:00:00").getTime();
    const covered = latest.chains.filter((c) => c.status === "ok" || c.status === "parziale");
    window.CHAINS = covered.map((c) => ({ id: c.id, name: c.name }));
    window.PRODUCTS = latest.products.map((p) => {
      const listings = {};
      for (const c of covered) {
        const o = p.offers[c.id];
        if (!o) continue;
        if (!o.found || !o.ppu) { listings[c.id] = null; continue; }
        const qty = o.price / o.ppu;
        listings[c.id] = {
          title: o.title, pack: o.pack, qty, price: o.price, ppu: o.ppu, was: o.promo?.oldPrice ?? null,
          until: o.promo?.until || o.validUntil || null, cardPrice: o.cardPrice || null, updatedAt: day(o.updatedAt),
          history: (hist[p.id]?.[c.id] || []).map(([d, , ppu]) => ({ day: day(d), v: ppu })),
        };
      }
      return { ...p, listings };
    });
    FLYERS = latest.flyers || {};
    ALL_CHAINS = latest.chains;
    GENERATED = latest.generatedAt || latest.date;
    chainById = Object.fromEntries(CHAINS.map((c) => [c.id, c]));
    MODE = "real";
    try { INSEGNE = (await (await fetch("../scraper/insegne.json", { cache: "no-store" })).json()).insegne || []; } catch {}
  } catch { LOAD_ERROR = true; }
}

// Offerte di un prodotto, una per catena, ordinate dal €/unità più basso.
function offers(p) {
  return Object.entries(p.listings || {}).filter(([, l]) => l).map(([chain, l]) => ({
    chain, title: l.title ?? l.label ?? "", pack: l.pack ?? "", qty: l.qty, price: l.price,
    ppu: l.ppu ?? l.price / l.qty, was: l.was ?? (l.promo ? l.listPrice : null), until: l.until ?? l.promo?.until ?? null,
    cardPrice: l.cardPrice || null, history: (l.history || []).map((h) => ({ day: h.day, v: h.v ?? h.price / l.qty })),
  })).sort((a, b) => a.ppu - b.ppu);
}
// Il confronto si mostra solo se affidabile (regola 4 del design): niente vino da tavola contro DOC.
function comparison(p) {
  const list = offers(p);
  const reliable = isReliableComparison(list.map((o) => ({ name: o.title, unit: unitShort(p.unit), packQty: o.qty, unitPrice: o.ppu })));
  return { list, reliable };
}
const catOf = (p) => p.category || "Altro";

/* ---------- Formati locali ---------- */
const prettyName = (s) => (s || "").split(" · ").map((part, i) => (part === part.toUpperCase() ? (i === 0 ? sentenceCase(part) : sentenceCase(part).replace(/(^|\s)\S/g, (c) => c.toUpperCase())) : part)).join(" · ");
const brandOf = (title) => { const parts = (title || "").split(" · "); return parts.length > 1 ? prettyName(parts.at(-1)) : ""; };
const packShort = (s) => (s || "").replace(/\s*x\s*/gi, "×").replace(/,\s*al (kg|litro|l) € ?[\d,]+/i, "").trim();
const until = (d) => (d ? `<span class="meta">${icon("cal", "icon--xs")}${validUntil(typeof d === "number" ? new Date(d) : d + "T00:00:00")}</span>` : "");
const freshness = () => (GENERATED ? updatedAt(GENERATED) : "");

/* ---------- Componenti ---------- */
function offerRow(o) {
  const pct = o.promo?.pct || (o.was && o.was > o.price ? Math.round((1 - o.price / o.was) * 100) : 0);
  const was = o.promo?.oldPrice ?? o.was;
  return `<div class="offer"${o.pid ? ` data-go="${o.pid}" role="link" tabindex="0"` : ""}>
    ${logo(o.chain)}
    <div class="offer__body">
      <div class="offer__name">${esc(prettyName(o.title))}</div>
      <div class="offer__pack">${o.pack ? `${esc(packShort(o.pack))} · ` : ""}<b>${euro(o.price)}</b>${was && pct ? ` <s>${euro(was).replace(" €", "")}</s>` : ""}</div>
      <div class="offer__meta">${until(o.validUntil)}${o.cardPrice ? `<span class="meta meta--strong">${icon("card", "icon--xs")}con carta ${euro(o.cardPrice)}</span>` : ""}</div>
    </div>
    <div class="offer__price">${pct ? `<span class="badge-sale">${discountLabel(o.price, was)}</span>` : ""}${o.ppu ? `<div class="offer__unit">${unitPrice(o.ppu, unitShort(o.unit))}</div>` : ""}</div>
  </div>`;
}

function starBtn(p, extra = "") {
  const on = inList(p.id);
  return `<button type="button" class="star-btn" data-star="${p.id}" aria-pressed="${on}" aria-label="${on ? "Togli" : "Aggiungi"} ${esc(p.name.toLowerCase())} ${on ? "dalla" : "alla"} lista"${extra}>${icon("star", "icon--lg")}</button>`;
}

function productRow(p) {
  const { list, reliable } = comparison(p);
  const best = list[0];
  const sub = !list.length ? "Non in offerta questa settimana" : reliable ? `${logo(best.chain, "logo--sm")}<span>${list.length} catene</span>` : list.length === 1 ? `${logo(best.chain, "logo--sm")}<span>solo qui</span>` : `${list.length} offerte da confrontare`;
  return `<div class="product${list.length ? "" : " product--empty"}">
    <a class="product__link" href="#p/${p.id}"><span style="flex:1;min-width:0"><span class="product__name" style="display:block">${esc(p.name)}</span><span class="product__sub">${sub}</span></span>
    ${best && (reliable || list.length === 1) ? `<span class="product__price">${unitPrice(best.ppu, unitShort(p.unit))}</span>` : ""}</a>
    ${starBtn(p)}
  </div>`;
}

function setDock(html = "") { dockAction.innerHTML = html; dockAction.style.marginBottom = html ? "10px" : "0"; }

/* ---------- La mia lista e avvisi ---------- */
// { productId: { addedAt, priceAtAdd, threshold | null } }
const getList = () => {
  const l = store.get("lista", null);
  if (l) return l;
  // migrazione dai vecchi avvisi
  const old = store.get("alerts", {}), out = {};
  for (const [id, thr] of Object.entries(old)) out[id] = { addedAt: Date.now(), priceAtAdd: null, threshold: thr };
  store.set("lista", out);
  return out;
};
const inList = (id) => !!getList()[id];
function bestNow(p) { const { list, reliable } = comparison(p); return list.length && (reliable || list.length === 1) ? list[0] : null; }
function hotInfo(p) {
  const e = getList()[p.id], b = bestNow(p);
  if (!e || !b) return null;
  if (e.threshold && b.ppu <= e.threshold) return `sotto la tua soglia di ${euro(e.threshold).replace(" €", "")}`;
  if (e.priceAtAdd && b.ppu < e.priceAtAdd - 0.005) return `sceso da ${euro(e.priceAtAdd).replace(" €", "")}`;
  return null;
}
function addToList(id) {
  const p = PRODUCTS.find((x) => x.id === id), b = p && bestNow(p);
  const l = getList(); l[id] = { addedAt: Date.now(), priceAtAdd: b ? b.ppu : null, threshold: null }; store.set("lista", l);
  rerender();
  if (b) thresholdSheet(p, b.ppu);
  else toast(`${p.name} è nella tua lista`);
}
function removeFromList(id) {
  const l = getList(), prev = l[id]; delete l[id]; store.set("lista", l);
  rerender();
  const p = PRODUCTS.find((x) => x.id === id);
  toast(`${p?.name || "Prodotto"} tolto dalla lista`, () => { const m = getList(); m[id] = prev; store.set("lista", m); rerender(); });
}

/* ---------- Fogli e toast ---------- */
function openSheet(html, { label = "" } = {}) {
  const root = $("#sheet-root");
  root.innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="sheet__grip"></div>${html}</div>`;
  const first = root.querySelector("button, input, select, a"); first?.focus();
  return root.querySelector(".sheet");
}
function closeSheet() { $("#sheet-root").innerHTML = ""; }
let toastTimer;
function toast(msg, undo) {
  const t = $("#toast");
  t.innerHTML = `<span style="flex:1">${esc(msg)}</span>${undo ? `<button type="button">Annulla</button>` : ""}`;
  t.hidden = false;
  if (undo) t.querySelector("button").onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

function thresholdSheet(p, best) {
  const u = unitShort(p.unit);
  let v = Math.floor(best * 0.95 * 10) / 10;
  const sh = openSheet(`
    <div class="empty__title"><span class="alert__icon" style="width:32px;height:32px;background:var(--brand);color:var(--onbrand)">${icon("check", "icon--sm")}</span>${esc(p.name)} è nella tua lista</div>
    <p style="margin-top:12px">Vuoi un avviso quando scende sotto un prezzo?</p>
    <div class="dock__row" style="margin-top:10px">
      <div class="stepper"><button type="button" data-step="-0.1" aria-label="Abbassa la soglia">${icon("minus")}</button><output aria-live="polite" class="num"></output><button type="button" data-step="0.1" aria-label="Alza la soglia">${icon("plus")}</button></div>
      <button type="button" class="btn btn-primary" style="flex:1" data-ok>Avvisami</button>
    </div>
    <button type="button" class="list-more" data-close>Non serve</button>
    <p class="xsmall">Vedrai l'avviso in questa pagina quando apri l'app. Le notifiche sul telefono non sono ancora attive.</p>`, { label: "Avviso di prezzo" });
  const out = sh.querySelector("output"), show = () => (out.textContent = unitPrice(v, u));
  show();
  sh.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => { v = Math.max(0.1, Math.round((v + +b.dataset.step) * 10) / 10); show(); }));
  sh.querySelector("[data-ok]").onclick = () => { const l = getList(); if (l[p.id]) l[p.id].threshold = v; store.set("lista", l); closeSheet(); rerender(); toast(`Ti avvisiamo sotto ${unitPrice(v, u)}`); };
}

function sourcesSheet() {
  const covered = CHAINS.map((c) => c.name).join(", ");
  openSheet(`
    <h2 class="h2">Da dove vengono i prezzi</h2>
    <p>Dai volantini pubblici delle catene, letti in automatico.</p>
    <p>Si aggiornano due volte al giorno. Ultimo aggiornamento: ${esc(freshness() || "—")}.</p>
    <p>Catene con prezzi: ${esc(covered)}.</p>
    <a class="btn btn-ghost btn--block" href="#catene" style="margin-top:14px" data-close>Copertura di tutte le catene</a>`, { label: "Da dove vengono i prezzi" });
}

/* ---------- Ricerca ---------- */
const wordRe = (w) => new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
function search(q) {
  const t = norm(q).split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  return PRODUCTS.filter((p) => { const hay = [p.name, ...(p.aliases || [])].map(norm).join(" | "); return t.every((w) => wordRe(w).test(hay)); });
}
// La parola cercata non deve comparire come ingrediente: "cioccolato al latte" non è latte.
const PREP = /(?:\/\s*$)|(?:^|\s)(?:al|allo|alla|ai|agli|alle|all'|con|di|da|del|dello|della|dei|degli|delle|gusto|sapore|aroma|ripien[oaie]|e)\s+$/;
function mainWord(title, w) {
  const t = norm(title), re = new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  let m; while ((m = re.exec(t))) { if (!PREP.test(t.slice(0, m.index + m[1].length))) return true; }
  return false;
}
function allOffers() {
  return Object.entries(FLYERS).flatMap(([c, list]) => list.map((o) => ({ chain: c, ...o })));
}
function flyerHits(q) {
  const t = norm(q).split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  const pids = new Set(search(q).map((p) => p.id));
  const hasPid = Object.values(FLYERS).some((l) => l.some((o) => o.pid));
  return allOffers().filter((o) => t.every((w) => mainWord(o.title, w)) && (!pids.size || !hasPid || pids.has(o.pid)))
    .sort((a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9)).slice(0, 40);
}
const recent = () => store.get("recenti", []);
function saveRecent(q) { q = q.trim().toLowerCase(); if (q.length < 2) return; store.set("recenti", [q, ...recent().filter((x) => x !== q)].slice(0, 5)); }

/* ---------- Schermata: Cerca (home) ---------- */
function homeView(q = "") {
  setDock();
  const hot = PRODUCTS.filter((p) => inList(p.id) && hotInfo(p));
  view.innerHTML = `
    <header class="topbar">
      <div class="brandmark"><svg width="28" height="28" viewBox="0 0 30 30" aria-hidden="true"><path class="tag-body" d="M3 9a4 4 0 0 1 4-4h12l9 10-9 10H7a4 4 0 0 1-4-4z"/><circle class="tag-hole" cx="9" cy="15" r="2.4"/></svg>spesa smart</div>
      ${GENERATED ? `<button type="button" class="freshness" data-sources aria-label="Da dove vengono i prezzi, aggiornati ${esc(freshness())}">${icon("clock", "icon--sm")}${esc(freshness())}</button>` : ""}
    </header>
    ${dataNotice()}
    <h1 class="h1" style="margin:20px var(--gutter) 0">Cosa ti serve?</h1>
    <label class="search-hero">${icon("search", "icon--lg")}<span class="sr-only">Cerca un prodotto</span>
      <input id="q" type="search" placeholder="Latte, tonno, caffè…" autocomplete="off" enterkeyhint="search" value="${esc(q)}">
      <button type="button" class="icon-btn" id="q-clear" aria-label="Cancella" style="margin-right:-12px"${q ? "" : " hidden"}>${icon("x", "icon--sm muted")}</button>
    </label>
    <div id="results"></div>`;
  const input = $("#q"), clear = $("#q-clear");
  const render = () => {
    const v = input.value.trim();
    clear.hidden = !v;
    history.replaceState(null, "", v ? `#q=${encodeURIComponent(v)}` : "#");
    $("#results").innerHTML = v ? resultsHtml(v) : homeHtml(hot);
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { saveRecent(input.value); input.blur(); } });
  clear.onclick = () => { input.value = ""; render(); input.focus(); };
  render();
  if (location.hash === "#cerca") input.focus();
}

function homeHtml(hot) {
  const counts = Object.fromEntries(CATS.map((c) => [c, PRODUCTS.filter((p) => catOf(p) === c && offers(p).length).length]));
  const rec = recent();
  return `
    ${rec.length ? `<section class="section" style="padding-top:22px"><h2 class="xsmall muted" style="margin:0;font-weight:700">Ricerche recenti</h2>
      <div class="chips chips--wrap">${rec.map((r) => `<a class="chip" href="#q=${encodeURIComponent(r)}">${icon("history", "icon--sm muted")}${esc(r)}</a>`).join("")}</div></section>` : ""}
    ${hot.length ? `<a class="alert" href="#lista"><span class="alert__icon">${icon("bell", "icon--sm")}</span>
      <span style="flex:1;min-width:0"><span class="alert__title" style="display:block">${hot.length === 1 ? "1 prodotto della tua lista è sceso" : `${hot.length} prodotti della tua lista sono scesi`}</span><span class="alert__sub">${esc(hot.slice(0, 3).map((p) => p.name).join(", "))}</span></span>${icon("chev-r", "icon--sm")}</a>` : ""}
    <section class="section" style="padding-top:26px"><h2 class="h2">Sfoglia per categoria</h2>
      <div class="catgrid">${CATS.map((c) => `<a class="cat" href="#cat/${encodeURIComponent(c)}"><b>${esc(c)}</b><span>${counts[c] ? `${counts[c]} in offerta` : "niente in offerta"}</span></a>`).join("")}</div>
    </section>
    <section class="section small muted coverage-row">
      <span class="logo-stack">${CHAINS.slice(0, 5).map((c) => logo(c.id, "logo--sm")).join("")}</span>
      <span style="margin-left:6px">Prezzi dai volantini di ${CHAINS.length} ${CHAINS.length === 1 ? "catena" : "catene"}.</span>
      <a class="link" href="#catene" style="margin-left:auto">Copertura</a>
    </section>`;
}

function resultsHtml(v) {
  const res = search(v), fh = MODE === "real" ? flyerHits(v) : [];
  const cards = res.map((p) => ({ p, ...comparison(p) })).filter((r) => r.reliable);
  const others = res.filter((p) => !cards.some((c) => c.p.id === p.id));
  if (!cards.length && !fh.length && !others.some((p) => offers(p).length)) {
    const sugg = PRODUCTS.filter((p) => comparison(p).reliable).slice(0, 3);
    return `<section class="section"><div class="empty"><div class="empty__title">Niente per «${esc(v)}»</div><p>Non è in offerta questa settimana.</p>
      ${sugg.length ? `<div class="chips chips--wrap" style="margin-top:12px">${sugg.map((p) => `<a class="chip" href="#p/${p.id}">${esc(p.name)}</a>`).join("")}</div>` : ""}</div></section>
      ${others.length ? `<section class="section" style="padding-top:16px"><div class="list">${others.map(productRow).join("")}</div></section>` : ""}`;
  }
  return `
    ${cards.length ? `<section class="section" style="padding-top:16px"><h2 class="h3">Confronta i prezzi</h2>${cards.map(({ p, list }) => `
      <div class="result-card"><a href="#p/${p.id}" data-recent="${esc(v)}"><span style="flex:1;min-width:0"><b style="display:block;font-size:16px">${esc(p.name)}</b><span class="small herom">Confronta ${list.length} catene</span></span>
        <span style="text-align:right"><span class="xsmall herom" style="display:block">${esc(chainName(list[0].chain))}</span><span class="tag tag--ribbon num" style="font-size:16px;padding:2px 8px">${unitPrice(list[0].ppu, unitShort(p.unit))}</span></span></a>${starBtn(p)}</div>`).join("")}</section>` : ""}
    ${others.length ? `<section class="section" style="padding-top:16px"><div class="list">${others.map(productRow).join("")}</div></section>` : ""}
    ${fh.length ? `<section class="section" style="padding-top:16px"><div class="section-head"><h2 class="h3">Nei volantini</h2><span class="small muted">${fh.length}</span></div><div class="list">${fh.map(offerRow).join("")}</div></section>` : ""}`;
}

/* ---------- Schermata: categoria ---------- */
function categoryView(cat) {
  setDock();
  const ps = PRODUCTS.filter((p) => catOf(p) === cat);
  const withOffer = ps.filter((p) => offers(p).length).sort((a, b) => a.name.localeCompare(b.name));
  const without = ps.filter((p) => !offers(p).length).sort((a, b) => a.name.localeCompare(b.name));
  view.innerHTML = `
    <div class="backbar"><a class="icon-btn" href="#" aria-label="Indietro" data-back>${icon("chev-l", "icon--lg")}</a></div>
    <h1 class="h1" style="margin:0 var(--gutter)">${esc(cat)}</h1>
    <p class="small muted sub">${withOffer.length} in offerta questa settimana</p>
    ${withOffer.length ? `<section class="section" style="padding-top:16px"><div class="list">${withOffer.map(productRow).join("")}</div></section>` : ""}
    ${without.length ? `<section class="section"><h2 class="h3 muted" style="font-size:16px">Non in offerta questa settimana</h2><div class="list">${without.map(productRow).join("")}</div></section>` : ""}`;
}

/* ---------- Schermata: scheda prodotto ---------- */
let period = 30;
function productView(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return homeView();
  const { list, reliable } = comparison(p);
  const u = unitShort(p.unit);
  const best = list[0], worst = list.at(-1);
  const showCompare = list.length >= 2 && reliable;
  const notCovered = ALL_CHAINS.filter((c) => c.status !== "ok" && c.status !== "parziale").map((c) => c.name);
  const missing = Object.entries(p.listings || {}).filter(([, l]) => !l).map(([c]) => chainName(c));
  const save = showCompare ? savingEuro({ bestUnit: best.ppu, worstUnit: worst.ppu, bestPackQty: best.qty, unit: u }) : null;

  const verdict = !best ? `
    <section class="section"><div class="empty"><div class="empty__title">Non in offerta questa settimana</div>
      <p>Nessuna catena coperta ha ${esc(p.name.toLowerCase())} in volantino. Il prossimo controllo è entro poche ore.</p></div></section>`
    : (showCompare || list.length === 1) ? `
    <section class="verdict" aria-label="${showCompare ? "Più conveniente" : "In offerta"}">
      <div class="verdict__head"><span class="tag">${showCompare ? "Più conveniente" : "Solo qui questa settimana"}</span><span class="verdict__chain">${logo(best.chain)}${esc(chainName(best.chain))}</span></div>
      <div class="verdict__price"><strong>${euro(best.ppu).replace(" €", "")}</strong><span>€/${u}</span></div>
      ${showCompare ? `<span class="tag tag--ribbon" style="margin-top:12px">${savingPct(best.ppu, worst.ppu)}% in meno di ${esc(chainName(worst.chain))}</span>` : ""}
      ${save && save.euro > 0 ? `<div class="verdict__euro">${euro(save.euro)} risparmiati su ${save.packs} ${save.packs === 1 ? "confezione" : "confezioni"}</div>` : ""}
      <div class="verdict__proof"><span>${[brandOf(best.title), packShort(best.pack)].filter(Boolean).map(esc).join(" · ")} · <b>${euro(best.price)}</b></span>${until(best.until)}</div>
      ${MODE === "real" ? `<button type="button" class="btn btn-ghost btn--block" data-nearest="${best.chain}">${icon("pin")}Negozio più vicino</button>` : ""}
    </section>`
    : `<section class="section"><div class="empty"><div class="empty__title">${icon("info", "icon--sm")}Prodotti diversi tra le catene</div>
      <p>Le offerte di questa settimana non sono confrontabili (formati o qualità troppo diversi). Eccole così come sono.</p></div></section>`;

  const max = Math.max(...list.map((o) => o.ppu));
  const rows = list.map((o, i) => `
    <div class="chainprice">
      <div class="chainprice__top"><div style="flex:1;min-width:0"><div class="chainprice__name">${esc(chainName(o.chain))}</div><div class="small muted">${[brandOf(o.title) || prettyName(o.title), packShort(o.pack), euro(o.price)].filter(Boolean).map(esc).join(" · ")}</div></div>
        <div style="text-align:right"><div class="chainprice__unit">${euro(o.ppu).replace(" €", "")}<small> €/${u}</small></div>${showCompare && i ? `<div class="diff">${diffLabel(o.ppu, best.ppu)}</div>` : ""}</div></div>
      ${showCompare ? `<div class="bar${i === 0 ? " bar--best" : ""}"><span style="width:${Math.round((o.ppu / max) * 100)}%"></span></div>` : ""}
      ${o.was || o.cardPrice ? `<div class="chainprice__extra">${o.was && o.was > o.price ? `<span class="badge-sale">${discountLabel(o.price, o.was)}</span>` : ""}${o.cardPrice ? `<span class="meta meta--strong">${icon("card", "icon--xs")}con carta ${euro(o.cardPrice)}</span>` : ""}</div>` : ""}
    </div>`).join("");

  view.innerHTML = `
    <div class="backbar"><a class="icon-btn" href="#" aria-label="Indietro" data-back>${icon("chev-l", "icon--lg")}</a>
      <button type="button" class="icon-btn" aria-label="Condividi" style="margin-left:auto" data-share="${p.id}">${icon("share")}</button></div>
    <h1 class="h1" style="margin:0 var(--gutter)">${esc(p.name)}</h1>
    <p class="small muted sub">${esc(catOf(p))} · ${list.length} ${list.length === 1 ? "catena" : "catene"}</p>
    ${verdict}
    ${list.length > 1 || (list.length === 1 && !showCompare && false) ? `<section class="section" style="padding-top:26px"><h2 class="h2">Prezzi al ${u === "pz" ? "pezzo" : u}</h2><div class="list">${rows}</div>
      ${missing.length ? `<p class="small muted" style="margin:10px 2px 0">Non in offerta questa settimana da ${esc(missing.join(", "))}.</p>` : ""}
      ${notCovered.length ? `<p class="small muted" style="display:flex;gap:6px;align-items:flex-start;margin:6px 2px 0">${icon("info", "icon--sm")}<span>${esc(notCovered.slice(0, 6).join(", "))}${notCovered.length > 6 ? ` e altre ${notCovered.length - 6}` : ""} non sono ancora coperte.</span></p>` : ""}</section>` : ""}
    ${best ? historySection(p, list, u) : ""}`;

  const on = inList(p.id), e = getList()[p.id];
  setDock(on
    ? `<div class="dock__row"><button type="button" class="btn btn-ghost" style="flex:1;min-height:52px" data-star="${p.id}" aria-pressed="true">${icon("star")}Nella tua lista</button>
       <button type="button" class="btn btn-ghost" style="min-height:52px" data-threshold="${p.id}">${icon("bell")}${e?.threshold ? unitPrice(e.threshold, u) : "Avviso"}</button></div>`
    : `<button type="button" class="btn btn-primary btn--block" data-star="${p.id}" aria-pressed="false">${icon("star")}Aggiungi alla mia lista</button>`);
}

function historySection(p, list, u) {
  const days = new Set(list.flatMap((o) => o.history.map((h) => h.day)));
  const n = days.size;
  const head = `<div class="section-head"><h2 class="h2">Andamento</h2>${n >= 7 ? `<div class="segmented" role="group" aria-label="Periodo">${[30, 90].map((d) => `<button type="button" aria-pressed="${period === d}" data-period="${d}">${d} g</button>`).join("")}</div>` : ""}</div>`;
  if (n < 7) {
    const first = Math.min(...days, TODAY);
    const ready = new Date(first + 6 * DAY);
    return `<section class="section">${head}<div class="empty" style="margin-top:12px">
      <div class="section-head"><b>Storico in costruzione</b><span class="small muted"><b style="color:var(--ink)">${Math.max(1, n)}/7</b> giorni</span></div>
      <div class="progress-days">${Array.from({ length: 7 }, (_, i) => `<span class="${i < Math.max(1, n) ? "on" : ""}"></span>`).join("")}</div>
      <p>Dal ${ready.getDate()}/${ready.getMonth() + 1} vedrai se il prezzo di oggi è davvero basso.</p></div></section>`;
  }
  const W = 340, H = 160, L = 34, B = 18, T = 8, R = 6;
  const series = list.map((o) => ({ chain: o.chain, pts: o.history.filter((h) => h.day >= TODAY - period * DAY) })).filter((s) => s.pts.length > 1);
  const all = series.flatMap((s) => s.pts.map((x) => x.v));
  let mn = Math.min(...all), mx = Math.max(...all); const pad = (mx - mn) * 0.1 || 0.1; mn -= pad; mx += pad;
  const t0 = Math.min(...series.map((s) => s.pts[0].day)), t1 = Math.max(...series.map((s) => s.pts.at(-1).day));
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), y = (v) => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  const ticks = [mn + pad, (mn + mx) / 2, mx - pad];
  const bestChain = list[0].chain;
  return `<section class="section">${head}<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del prezzo al ${u}">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 4}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(2).replace(".", ",")}</text>`).join("")}
    <text x="${L}" y="${H - 2}">${new Date(t0).getDate()}/${new Date(t0).getMonth() + 1}</text><text x="${W - R}" y="${H - 2}" text-anchor="end">oggi</text>
    ${series.sort((a) => (a.chain === bestChain ? 1 : -1)).map((s) => `<polyline class="${s.chain === bestChain ? "best" : "other"}" points="${s.pts.map((q) => `${x(q.day).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ")}"/>`).join("")}
  </svg><div class="legend">${series.map((s) => `<span><i class="${s.chain === bestChain ? "best" : ""}"></i>${esc(chainName(s.chain))}</span>`).join("")}</div></div></section>`;
}

/* ---------- Schermata: La mia lista ---------- */
function listView() {
  const ids = Object.keys(getList());
  const ps = ids.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean);
  view.innerHTML = `<header class="page-head"><h1 class="h1">La mia lista</h1>${ps.length ? `<span class="small muted">${ps.length} ${ps.length === 1 ? "prodotto" : "prodotti"}</span>` : ""}</header><div id="list-body"></div>`;
  setDock(`<a class="btn btn-primary btn--block" href="#cerca">${icon("plus")}Aggiungi un prodotto</a>`);
  if (!ps.length) {
    $("#list-body").innerHTML = `<section class="section"><div class="empty" style="text-align:center">
      <span class="alert__icon" style="width:48px;height:48px;margin:0 auto;background:var(--tag);color:var(--ontag)">${icon("star")}</span>
      <div class="empty__title" style="justify-content:center;margin-top:10px">La tua lista è vuota</div>
      <p>Cerca un prodotto e tocca la stella. Qui vedrai dove costa meno, solo per le cose che compri tu.</p>
      <a class="btn btn-primary" href="#cerca">Cerca un prodotto</a></div></section>`;
    return;
  }
  // Nel verdetto entrano solo i confronti affidabili o le offerte di una sola catena.
  const items = ps.map((p) => { const { list, reliable } = comparison(p); return { id: p.id, name: p.name, p, offers: list.length && (reliable || list.length === 1) ? list.map((o) => ({ chain: o.chain, unitPrice: o.ppu, o })) : [], unreliable: list.length > 1 && !reliable }; });
  const v = listVerdict(items.filter((i) => !i.unreliable));
  const unreliable = items.filter((i) => i.unreliable);
  const total = Object.values(v.counts).reduce((a, b) => a + b, 0);
  const row = (it) => {
    const b = it.best?.o || it.offers[0]?.o, hot = hotInfo(it.p), u = unitShort(it.p.unit);
    return `<div class="product${hot ? " row--hot" : ""}">
      <a class="product__link" href="#p/${it.id}"><span style="flex:1;min-width:0"><span class="product__name" style="display:block">${esc(it.name)}</span>
        <span class="small${hot ? "" : " muted"}">${[brandOf(b.title), packShort(b.pack), euro(b.price)].filter(Boolean).map(esc).join(" · ")}</span>
        ${hot ? `<span class="xsmall" style="display:flex;align-items:center;gap:4px;margin-top:4px;font-weight:800">${icon("down", "icon--xs")}${esc(hot)}</span>` : ""}</span>
        <span style="text-align:right">${b.was && b.was > b.price ? `<span class="badge-sale">${discountLabel(b.price, b.was)}</span>` : ""}<span class="product__price" style="display:block;margin-top:3px">${unitPrice(b.ppu, u)}</span></span></a>
      ${starBtn(it.p)}</div>`;
  };
  $("#list-body").innerHTML = `
    ${v.winner ? `<section class="verdict" aria-label="Dove costa meno questa settimana">
      <span class="tag">Dove costa meno questa settimana</span>
      <div style="margin-top:12px;font:800 44px/1 var(--font-display);letter-spacing:-.03em">${esc(chainName(v.winner))}</div>
      <div style="margin-top:6px;font-size:15px;font-weight:700">${total === 1 ? "Il più conveniente per il tuo prodotto in offerta" : v.counts[v.winner] === total ? `Il più conveniente per tutti i tuoi ${total} prodotti in offerta` : `Il più conveniente per ${v.counts[v.winner]} dei tuoi ${total} prodotti in offerta`}</div>
      <div class="split" aria-hidden="true">${v.byChain.map((g, i) => `<span class="${i === 0 ? "win" : ""}" style="flex:${g.items.length}"></span>`).join("")}</div>
      <div class="small" style="display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;color:var(--herom)">${v.byChain.map((g, i) => (i === 0 ? `<b style="color:var(--onhero)">${esc(chainName(g.chain))} ${g.items.length}</b>` : `<span>${esc(chainName(g.chain))} ${g.items.length}</span>`)).join("")}</div>
    </section>` : ""}
    ${v.byChain.map((g) => `<section class="section"><div class="chain-head">${logo(g.chain, "logo--sm")}<h2 class="h3">Da ${esc(chainName(g.chain))}</h2><span class="small muted">${g.items.length} ${g.items.length === 1 ? "prodotto" : "prodotti"}</span></div>
      <div class="list">${g.items.map(row).join("")}</div></section>`).join("")}
    ${unreliable.length ? `<section class="section"><h2 class="h3" style="font-size:16px">Da confrontare a mano</h2><div class="list">${unreliable.map((it) => productRow(it.p)).join("")}</div></section>` : ""}
    ${v.missing.length ? `<section class="section"><h2 class="h3 muted" style="font-size:16px">Non in offerta questa settimana</h2>
      ${v.missing.map((it) => `<div class="missing" style="margin-top:10px"><a class="row-link" href="#p/${it.id}" style="flex:1"><span class="product__name muted" style="display:block">${esc(it.name)}</span><span class="small muted">Ti avvisiamo quando torna</span></a>${starBtn(it.p, ' style="color:var(--muted)"')}</div>`).join("")}</section>` : ""}`;
}

/* ---------- Schermata: Offerte ---------- */
let offChain = "tutte", offCat = "tutte", offSort = "sconto", offQ = "";
const shownPerGroup = {};
function pctOf(o) { return o.promo?.pct || 0; }
function offersView() {
  if (MODE !== "real") { view.innerHTML = `<section class="section"><div class="empty"><div class="empty__title">Prezzi non disponibili</div><p>Le offerte arrivano dai dati reali.</p></div></section>`; setDock(); return; }
  const all = allOffers().map((o) => ({ ...o, cat: normalizeCategory(o.category || "") || "Altro" }));
  const counts = { tutte: all.length };
  for (const o of all) counts[o.chain] = (counts[o.chain] || 0) + 1;
  view.innerHTML = `
    <header class="page-head"><h1 class="h1">Offerte</h1>${GENERATED ? `<button type="button" class="freshness" data-sources style="padding:0">${icon("clock", "icon--xs")}${esc(freshness())}</button>` : ""}</header>
    <div class="chips" role="group" aria-label="Catena">${["tutte", ...CHAINS.map((c) => c.id).sort((a, b) => (counts[b] || 0) - (counts[a] || 0))].filter((c) => counts[c]).map((c) =>
      `<button type="button" class="chip" aria-pressed="${offChain === c}" data-offchain="${c}">${c === "tutte" ? "Tutte" : esc(chainName(c))} <span class="count">${counts[c]}</span></button>`).join("")}</div>
    <div id="offlist"></div>`;
  setDock(`<div class="dock__row"><label class="searchfield" style="height:50px">${icon("search")}<span class="sr-only">Cerca nelle offerte</span><input id="offq" type="search" placeholder="Cerca nelle offerte" value="${esc(offQ)}" enterkeyhint="search" autocomplete="off"></label>
    <button type="button" class="icon-btn icon-btn--outline" aria-label="Filtri e ordinamento" style="width:50px;height:50px;border-radius:14px" data-filters>${icon("filter")}</button></div>`);
  $("#offq").oninput = (e) => { offQ = e.target.value; drawOffers(all); };
  drawOffers(all);
}
function drawOffers(all) {
  const qWords = norm(offQ).split(/\s+/).filter(Boolean);
  const list = all.filter((o) => (offChain === "tutte" || o.chain === offChain) && (offCat === "tutte" || o.cat === offCat)
    && qWords.every((w) => mainWord(o.title, w) || wordRe(w).test(norm(o.pack))));
  const sorter = offSort === "ppu" ? (a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9) : offSort === "prezzo" ? (a, b) => a.price - b.price : (a, b) => pctOf(b) - pctOf(a) || (a.ppu ?? 1e9) - (b.ppu ?? 1e9);
  list.sort(sorter);
  const groups = offSort === "sconto"
    ? [["Oltre il 40%", (o) => pctOf(o) > 40], ["Dal 25% al 40%", (o) => pctOf(o) >= 25 && pctOf(o) <= 40], ["Fino al 25%", (o) => pctOf(o) > 0 && pctOf(o) < 25], ["Senza sconto", (o) => !pctOf(o)]]
    : [[offSort === "ppu" ? "€/unità più basso" : "Prezzo più basso", () => true]];
  const el = $("#offlist");
  if (!list.length) { el.innerHTML = `<section class="section"><div class="empty"><div class="empty__title">Nessuna offerta</div><p>Prova a togliere un filtro o a cercare un'altra parola.</p></div></section>`; return; }
  el.innerHTML = groups.map(([title, fn]) => {
    const items = list.filter(fn);
    if (!items.length) return "";
    const key = `${title}|${offChain}|${offCat}|${offSort}|${offQ}`;
    const closed = title === "Senza sconto" && !shownPerGroup[key];
    const n = shownPerGroup[key] || (closed ? 0 : 3);
    if (closed) return `<section class="section" style="padding-top:16px"><button type="button" class="group-toggle" data-more="${esc(key)}" data-step="20">Senza sconto <span class="small muted" style="display:inline-flex;gap:6px;align-items:center;font-weight:500">${items.length}${icon("chev-d", "icon--sm")}</span></button></section>`;
    return `<section class="section" style="padding-top:20px"><div class="section-head"><h2 class="h3">${title}</h2><span class="small muted">${items.length}</span></div>
      <div class="list">${items.slice(0, n).map(offerRow).join("")}${items.length > n ? `<button type="button" class="list-more" data-more="${esc(key)}" data-step="${n < 3 ? 3 : 20}">Altre ${items.length - n}</button>` : ""}</div></section>`;
  }).join("");
}
function filtersSheet() {
  const cats = ["tutte", ...CATS, "Altro"];
  const sh = openSheet(`
    <h2 class="h2">Filtri</h2>
    <label class="lbl" for="f-cat">Categoria</label>
    <select id="f-cat" class="field select-field">${cats.map((c) => `<option value="${esc(c)}" ${c === offCat ? "selected" : ""}>${c === "tutte" ? "Tutte le categorie" : esc(c)}</option>`).join("")}</select>
    <label class="lbl">Ordina per</label>
    <div class="segmented" role="group" aria-label="Ordina per">${[["sconto", "Sconto"], ["ppu", "€/unità"], ["prezzo", "Prezzo"]].map(([k, l]) => `<button type="button" style="flex:1" aria-pressed="${offSort === k}" data-sort="${k}">${l}</button>`).join("")}</div>
    <button type="button" class="btn btn-primary btn--block" style="margin-top:18px" data-close>Mostra offerte</button>`, { label: "Filtri" });
  sh.querySelector("#f-cat").onchange = (e) => { offCat = e.target.value; offersView(); };
  sh.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => { offSort = b.dataset.sort; sh.querySelectorAll("[data-sort]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); offersView(); }));
}

/* ---------- Negozio più vicino (posizione solo su richiesta, mai salvata) ---------- */
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
function km(a, b) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function nearestSheet(chainId) {
  const name = chainName(chainId);
  const sh = openSheet(`
    <h2 class="h2">${esc(name)} più vicino</h2>
    <p>Usiamo la posizione solo ora. Non la salviamo.</p>
    <div class="stack"><button type="button" class="btn btn-primary btn--block" data-geo>${icon("pin")}Usa la posizione</button>
    <form data-cap class="dock__row"><label class="sr-only" for="cap">CAP</label><input id="cap" class="field" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" placeholder="Scrivi il CAP" autocomplete="postal-code"><button class="btn btn-ghost" type="submit">Cerca</button></form></div>
    <div id="near-out" aria-live="polite"></div>`, { label: `${name} più vicino` });
  const out = sh.querySelector("#near-out");
  const run = async (pos) => {
    out.innerHTML = `<p>Cerco i negozi ${esc(name)} entro 15 km…</p>`;
    const q = `[out:json][timeout:20];nwr["shop"~"supermarket|convenience"]["name"~"${name}",i](around:15000,${pos.lat},${pos.lon});out center tags 50;`;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!r.ok) continue;
        const st = ((await r.json()).elements || []).map((e) => { const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
          return { name: t.name, addr: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") + (t["addr:city"] ? `, ${t["addr:city"]}` : ""), lat, lon, km: km(pos, { lat, lon }) }; })
          .filter((s) => s.lat != null).sort((a, b) => a.km - b.km).slice(0, 3);
        out.innerHTML = st.length ? `<div class="list">${st.map((s) => `<a class="product" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener" style="text-decoration:none;padding:12px 14px">
          <span style="flex:1;min-width:0"><span class="product__name" style="display:block">${esc(s.name)}</span><span class="small muted">${esc(s.addr || "Indirizzo non indicato")}</span></span><span class="product__price">${s.km < 1 ? Math.round(s.km * 1000) + " m" : s.km.toFixed(1).replace(".", ",") + " km"}</span></a>`).join("")}</div>`
          : `<p>Nessun ${esc(name)} entro 15 km.</p>`;
        return;
      } catch {}
    }
    out.innerHTML = `<p>Ricerca dei negozi non disponibile ora. <a href="https://www.google.com/maps/search/${encodeURIComponent(name)}/@${pos.lat},${pos.lon},13z" target="_blank" rel="noopener">Apri su Maps</a></p>`;
  };
  sh.querySelector("[data-geo]").onclick = () => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition((p) => run({ lat: p.coords.latitude, lon: p.coords.longitude }), () => { out.innerHTML = `<p>Posizione non disponibile. Scrivi il CAP qui sopra.</p>`; sh.querySelector("#cap").focus(); }, { timeout: 8000 })
    : sh.querySelector("#cap").focus();
  sh.querySelector("[data-cap]").onsubmit = async (e) => {
    e.preventDefault();
    const cap = sh.querySelector("#cap").value.trim();
    if (!/^\d{5}$/.test(cap)) { out.innerHTML = `<p>Il CAP ha 5 cifre.</p>`; return; }
    out.innerHTML = `<p>Cerco il CAP ${cap}…</p>`;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${cap}&country=it&format=json&limit=1`);
      const [hit] = await r.json();
      if (!hit) throw 0;
      run({ lat: +hit.lat, lon: +hit.lon });
    } catch { out.innerHTML = `<p>CAP non trovato.</p>`; }
  };
}

/* ---------- Schermata: copertura delle catene ---------- */
function chainsView() {
  setDock();
  const st = Object.fromEntries(ALL_CHAINS.map((c) => [c.id, c]));
  const fams = {};
  for (const i of INSEGNE) {
    const f = (fams[i.famiglia] ||= { id: i.famiglia, name: i.nomeFamiglia, pv: 0, insegne: [], tipo: i.tipo });
    f.pv += i.puntiVendita; f.insegne.push(i.insegna);
  }
  const status = (f) => f.tipo === "drogheria" ? "fuori" : !st[f.id] ? "dafare" : (st[f.id].status === "ok" || st[f.id].status === "parziale") ? "attiva" : /AI/.test(st[f.id].note || "") ? "arrivo" : "bloccata";
  const groups = { attiva: [], arrivo: [], bloccata: [], dafare: [], fuori: [] };
  for (const f of Object.values(fams)) groups[status(f)].push(f);
  const titles = { attiva: "Con prezzi", arrivo: "In arrivo", bloccata: "Non leggibili", dafare: "Non ancora collegate", fuori: "Drogherie, per ora escluse" };
  const food = Object.values(fams).filter((f) => f.tipo !== "drogheria");
  const pct = food.length ? Math.round((groups.attiva.reduce((s, f) => s + f.pv, 0) / food.reduce((s, f) => s + f.pv, 0)) * 100) : 0;
  const why = (f, k) => k === "bloccata" ? `${f.name} non è disponibile: il sito non permette di leggere il volantino` : k === "arrivo" ? "Volantino trovato, lettura in corso" : f.insegne.join(", ");
  view.innerHTML = `
    <div class="backbar"><a class="icon-btn" href="#" aria-label="Indietro" data-back>${icon("chev-l", "icon--lg")}</a></div>
    <h1 class="h1" style="margin:0 var(--gutter)">Copertura</h1>
    <p class="small muted sub">${groups.attiva.length} catene con prezzi su ${food.length} catene alimentari</p>
    <section class="verdict" aria-label="Copertura"><span class="tag">Punti vendita coperti</span>
      <div class="verdict__price"><strong>${pct}%</strong></div>
      <div class="verdict__euro">${groups.arrivo.length} catene in arrivo nei prossimi giorni</div></section>
    ${Object.keys(titles).filter((k) => groups[k].length).map((k) => `<section class="section"><div class="section-head"><h2 class="h3">${titles[k]}</h2><span class="small muted">${groups[k].length}</span></div>
      <div class="list">${groups[k].sort((a, b) => b.pv - a.pv).map((f) => `<div class="product" style="padding:10px 14px">${logo(f.id)}<span style="flex:1;min-width:0"><span class="product__name" style="display:block">${esc(f.name)}</span><span class="small muted">${esc(why(f, k))}</span></span><span class="small muted num">${f.pv} negozi</span></div>`).join("")}</div></section>`).join("")}
    <p class="xsmall muted" style="margin:14px var(--gutter) 0">Elenco insegne: QBerg, Grande Distribuzione Italia 2025.</p>`;
}

/* ---------- Avvisi su dati vecchi o errori ---------- */
function dataNotice() {
  if (LOAD_ERROR) return `<section class="section" style="padding-top:12px"><div class="empty"><div class="empty__title">Prezzi non disponibili</div><p>I tuoi avvisi restano salvati.</p><button type="button" class="btn btn-ghost" data-retry>Riprova</button></div></section>`;
  if (GENERATED && Date.now() - new Date(GENERATED) > 20 * 3600000) return `<div class="notice" style="margin:12px var(--gutter) 0">${icon("clock", "icon--sm")}<span style="flex:1"><b>Prezzi di ${esc(updatedAt(GENERATED))}</b>${navigator.onLine ? "" : ` <span class="muted">· offline</span>`}</span><button type="button" class="btn" style="min-height:44px;padding:0 12px;font-size:13px;background:var(--sunk);color:var(--ink)" data-retry>Riprova</button></div>`;
  return "";
}

/* ---------- Router ---------- */
function route() {
  closeSheet();
  const h = decodeURIComponent(location.hash);
  const tab = h.startsWith("#offerte") ? "offerte" : h.startsWith("#lista") ? "lista" : "cerca";
  document.querySelectorAll(".tab").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (h.startsWith("#offerte")) offersView();
  else if (h.startsWith("#lista")) listView();
  else if (h.startsWith("#catene")) chainsView();
  else if (h.startsWith("#cat/")) categoryView(h.slice(5));
  else if (h.startsWith("#p/")) productView(h.slice(3));
  else homeView(h.startsWith("#q=") ? h.slice(3) : "");
  window.scrollTo(0, 0);
}
function rerender() { const y = window.scrollY; route(); window.scrollTo(0, y); }

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-star],[data-threshold],[data-close],[data-sources],[data-nearest],[data-share],[data-back],[data-period],[data-offchain],[data-more],[data-filters],[data-retry],[data-go],[data-recent]");
  if (!t) return;
  const d = t.dataset;
  if (d.recent) saveRecent(d.recent);
  if (d.star) { e.preventDefault(); inList(d.star) ? removeFromList(d.star) : addToList(d.star); return; }
  if (d.threshold) { const p = PRODUCTS.find((x) => x.id === d.threshold), b = bestNow(p); thresholdSheet(p, getList()[p.id]?.threshold || (b ? b.ppu : 1)); return; }
  if ("close" in d) { closeSheet(); if (t.tagName !== "A") e.preventDefault(); return; }
  if ("sources" in d) return sourcesSheet();
  if (d.nearest) return nearestSheet(d.nearest);
  if (d.share) { const p = PRODUCTS.find((x) => x.id === d.share); const url = location.href; navigator.share ? navigator.share({ title: p.name, text: `${p.name} su Spesa Smart`, url }).catch(() => {}) : (navigator.clipboard?.writeText(url), toast("Link copiato")); return; }
  if ("back" in d) { e.preventDefault(); history.length > 1 ? history.back() : (location.hash = ""); return; }
  if (d.period) { period = +d.period; rerender(); return; }
  if (d.offchain) { offChain = d.offchain; offersView(); return; }
  if (d.more) { shownPerGroup[d.more] = (shownPerGroup[d.more] || 0) + +d.step + (shownPerGroup[d.more] ? 0 : 3); drawOffers(allOffers().map((o) => ({ ...o, cat: normalizeCategory(o.category || "") || "Altro" }))); return; }
  if ("filters" in d) return filtersSheet();
  if ("retry" in d) { location.reload(); return; }
  if (d.go && d.go !== "undefined") location.hash = "#p/" + d.go;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
  if (e.key === "Enter" && e.target.matches?.('[role="link"][data-go]')) location.hash = "#p/" + e.target.dataset.go;
});
addEventListener("hashchange", route);
addEventListener("online", rerender);
addEventListener("offline", rerender);

// Categorie dei volantini non riconosciute: le segnaliamo in console per estendere la mappa.
loadReal().then(() => {
  if (MODE === "real") {
    const unknown = new Set(allOffers().map((o) => o.category).filter((c) => c && !normalizeCategory(c)));
    if (unknown.size) console.info("Categorie da mappare:", [...unknown]);
  }
  route();
});
