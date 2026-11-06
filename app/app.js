// Spesa Smart – prototipo. Dati da data.js (demo). Alert salvati sul dispositivo.
const $ = (s) => document.querySelector(s);
const view = $("#view");
const eur = (n) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const fmtDate = (t) => new Date(t).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
let chainById = Object.fromEntries(CHAINS.map((c) => [c.id, c]));
let MODE = "demo";
// Loghi: icona ufficiale del sito della catena (favicon). Se non si carica resta il pallino colorato.
const DOMAINS = { eurospin: "eurospin.it", penny: "penny.it", aldi: "aldi.it", lidl: "lidl.it", esselunga: "esselunga.it", coop: "coop.it", conad: "conad.it", carrefour: "carrefour.it", md: "mdspa.it", tigros: "tigros.it" };
function logo(chainId, size = 20) {
  const c = chainById[chainId] || {};
  const d = DOMAINS[chainId];
  return `<span class="logo" style="width:${size}px;height:${size}px;background:${c.color || "#888"}">${d ? `<img src="https://www.google.com/s2/favicons?domain=${d}&sz=64" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}
let FLYERS = {};      // offerte complete dei volantini (dati reali)
let OTHER_CHAINS = []; // catene senza dati
const COLORS = { eurospin: "#ca8a04", penny: "#cd1719", aldi: "#00005f", md: "#e30613", tigros: "#00843d", lidl: "#1d4ed8", coop: "#e85d04", conad: "#2a9d8f", esselunga: "#d62828", carrefour: "#7c3aed" };

// Prova a caricare i dati reali prodotti dallo scraper; altrimenti resta in demo.
async function loadReal() {
  if (new URLSearchParams(location.search).has("demo")) return;
  try {
    const [latest, hist] = await Promise.all(["../data/latest.json", "../data/history.json"].map((u) => fetch(u, { cache: "no-store" }).then((r) => { if (!r.ok) throw 0; return r.json(); })));
    const day = (d) => new Date(d + "T00:00:00").getTime();
    const covered = latest.chains.filter((c) => c.status === "ok" || c.status === "parziale");
    CHAINS = covered.map((c) => ({ id: c.id, name: c.name, color: COLORS[c.id] || "#555", coverage: c.coverage }));
    OTHER_CHAINS = latest.chains.filter((c) => !covered.includes(c));
    PRODUCTS = latest.products.map((p) => {
      const listings = {};
      for (const c of covered) {
        const o = p.offers[c.id];
        if (!o) continue;
        if (!o.found || !o.ppu) { listings[c.id] = null; continue; }
        const qty = o.price / o.ppu;
        listings[c.id] = {
          label: `${o.title} · ${o.pack}`, qty, price: o.price, listPrice: o.promo?.oldPrice ?? o.price,
          promo: o.promo ? { pct: (o.promo.pct || 0) / 100, until: day(o.promo.until) } : null,
          validUntil: o.validUntil ? day(o.validUntil) : null, updatedAt: day(o.updatedAt), cardPrice: o.cardPrice || null,
          history: (hist[p.id]?.[c.id] || []).map(([d, , ppu, promo]) => ({ day: day(d), price: ppu * qty, promo: !!promo })),
        };
      }
      return { ...p, category: "", listings };
    });
    FLYERS = latest.flyers || {};
    chainById = Object.fromEntries(CHAINS.map((c) => [c.id, c]));
    MODE = "real";
    $(".badge").textContent = "DATI REALI";
    $(".badge").style.color = "var(--good)";
  } catch {}
}
const unitLabel = (u) => ({ kg: "kg", l: "litro", pz: "pezzo" }[u]);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- Posizione e negozio più vicino ----------
let userPos = { lat: 45.4642, lon: 9.19 }; // fallback: Milano centro
let posIsReal = false;
navigator.geolocation?.getCurrentPosition((p) => { userPos = { lat: p.coords.latitude, lon: p.coords.longitude }; posIsReal = true; route(); }, () => {}, { timeout: 5000 });
function km(a, b) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function nearest(chainId) {
  if (MODE === "real") return null;
  return STORES.filter((s) => s.chain === chainId).map((s) => ({ ...s, km: km(userPos, s) })).sort((a, b) => a.km - b.km)[0];
}

// ---------- Ricerca ----------
function search(q) {
  const t = norm(q).split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  return PRODUCTS.map((p) => {
    const hay = [p.name, ...p.aliases, ...Object.values(p.listings).filter(Boolean).map((l) => l.label)].map(norm).join(" | ");
    const score = t.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { p, score };
  }).filter((x) => x.score === t.length).map((x) => x.p);
}
const offers = (p) => Object.entries(p.listings).filter(([, l]) => l).map(([chain, l]) => ({ chain, ...l, ppu: l.price / l.qty }));
const bestOffer = (p) => offers(p).sort((a, b) => a.ppu - b.ppu)[0];
const flyerHits = (q) => { const t = norm(q).split(/\s+/).filter(Boolean); if (!t.length) return []; return Object.entries(FLYERS).flatMap(([c, list]) => list.filter((o) => t.every((w) => norm(o.title + " " + o.pack + " " + (o.category || "")).includes(w))).map((o) => ({ chain: c, ...o }))).sort((a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9)).slice(0, 30); };

// ---------- Alert ----------
const getAlerts = () => store.get("alerts", {});
function triggeredAlerts() {
  const a = getAlerts();
  return PRODUCTS.filter((p) => a[p.id] && bestOffer(p) && bestOffer(p).ppu <= a[p.id]).map((p) => ({ p, best: bestOffer(p), target: a[p.id] }));
}

// ---------- Viste ----------
function homeView(q = "") {
  $("#title").textContent = "Spesa Smart";
  $("#back").hidden = true;
  const hits = triggeredAlerts();
  view.innerHTML = `
    ${hits.map(({ p, best, target }) => `<div class="banner" data-go="${p.id}">🔔 <b>${p.name}</b> è sceso a ${eur(best.ppu)}/${unitLabel(p.unit)} da ${chainById[best.chain].name} (soglia ${eur(target)})</div>`).join("")}
    <input id="q" class="search" type="search" placeholder="Cerca un prodotto, es. chilli verde" value="${q.replace(/"/g, "&quot;")}" autocomplete="off" autofocus>
    <div class="chips">${(MODE === "real" ? ["latte", "olio", "caffè", "grana", "clementine", "chilli verde"] : ["chilli verde", "latte", "olio", "avocado", "zenzero", "uova"]).map((s) => `<button class="chip" data-q="${s}">${s}</button>`).join("")}</div>
    <div id="results"></div>`;
  const input = $("#q");
  const render = () => {
    const v = input.value; history.replaceState(null, "", v ? `#q=${encodeURIComponent(v)}` : "#");
    const res = search(v), fh = MODE === "real" ? flyerHits(v) : [];
    const flyerHtml = fh.length ? `<h2>Nei volantini (${fh.length})</h2>` + fh.map((o) => `<div class="card row"><div><b>${o.title}</b><br><small>${logo(o.chain, 14)} ${chainById[o.chain]?.name || o.chain} · ${o.pack}${o.cardPrice ? ` · con carta ${eur(o.cardPrice)}` : ""}${o.validUntil ? ` · fino al ${fmtDate(new Date(o.validUntil))}` : ""}</small></div><div class="price" style="font-size:16px">${o.promo ? `<span class="old">${eur(o.promo.oldPrice)}</span>` : ""}${eur(o.price)}<br><small class="muted">${o.ppu ? `${eur(o.ppu)}/${o.unit}` : ""}</small></div></div>`).join("") : "";
    $("#results").innerHTML = !v.trim() ? `<p class="hint">Scrivi il nome di un prodotto: ti mostro dove costa meno, al kg o al litro.</p>`
      : !res.length && !fh.length ? `<p class="hint">Nessun prodotto trovato per “${v}”. Prova con un nome più generico.</p>`
      : res.map((p) => { const b = bestOffer(p); return `<div class="card prod" data-go="${p.id}"><div><b>${p.name}</b><br><small>${offers(p).length ? `${offers(p).length} su ${CHAINS.length} ${CHAINS.length === 1 ? "catena" : "catene"}` : "nessuna offerta oggi"}${p.category ? " · " + p.category : ""}</small></div><div class="price" style="font-size:16px">${b ? `da ${eur(b.ppu)}<br><small>/${unitLabel(p.unit)} · ${logo(b.chain, 14)} ${chainById[b.chain].name}</small>` : `<small class="muted">non trovato da<br>${CHAINS.map((c) => c.name).join(", ")}</small>`}</div></div>`; }).join("") + flyerHtml;
  };
  input.addEventListener("input", render);
  render();
}

let sortBy = "ppu";
let period = 30;
function productView(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return homeView();
  $("#title").textContent = p.name;
  $("#back").hidden = false;
  const list = offers(p).sort((a, b) => a[sortBy] - b[sortBy]);
  const missing = Object.entries(p.listings).filter(([, l]) => !l).map(([c]) => chainById[c].name);
  const alertVal = getAlerts()[p.id];
  const u = unitLabel(p.unit);
  view.innerHTML = `
    <div class="toggle">
      <button class="chip ${sortBy === "ppu" ? "on" : ""}" data-sort="ppu">€/${u}</button>
      <button class="chip ${sortBy === "price" ? "on" : ""}" data-sort="price">Prezzo confezione</button>
    </div>
    ${!list.length ? `<p class="hint">Al momento nessuna catena coperta lo vende a un prezzo rilevato.</p>` : ""}
    ${list.map((o, i) => { const s = nearest(o.chain); const age = Math.round((TODAY - o.updatedAt) / 86400000); return `
      <div class="card row ${i === 0 ? "best" : ""}">
        <div class="chain">${logo(o.chain)}${chainById[o.chain].name}${i === 0 ? '<span class="tag">PIÙ CONVENIENTE</span>' : ""}</div>
        <div class="price">${o.promo ? `<span class="old">${eur(o.listPrice)}</span>` : ""}${eur(o.price)}</div>
        <div class="muted">${o.label}</div>
        <div class="ppu">${eur(o.ppu)}/${u}</div>
        <div class="muted">📍 ${s ? `${s.name} · ${s.km.toFixed(1)} km${posIsReal ? "" : " (da Milano centro)"}` : `<a href="https://www.google.com/maps/search/${encodeURIComponent(chainById[o.chain].name)}" target="_blank" rel="noopener">Negozio più vicino</a>`}</div><div></div>
        ${o.cardPrice ? `<div class="promo">Con carta fedeltà: ${eur(o.cardPrice)}</div><div></div>` : ""}
        ${o.validUntil && !o.promo ? `<div class="muted">Prezzo volantino valido fino al ${fmtDate(o.validUntil)}</div><div></div>` : ""}
        <div class="muted ${age > 0 ? "stale" : ""}">Aggiornato ${age === 0 ? "oggi" : age === 1 ? "ieri" : `${age} giorni fa`}</div><div></div>
        ${o.promo ? (o.promo.until < TODAY ? `<div class="stale">⚠ Promo finita il ${fmtDate(o.promo.until)}: prezzo da verificare</div><div></div>` : `<div class="promo">−${Math.round(o.promo.pct * 100)}% fino al ${fmtDate(o.promo.until)}</div><div></div>`) : ""}
      </div>`; }).join("")}
    ${missing.map((m) => `<div class="missing">✕ ${MODE === "real" ? `Non nel volantino ${m} di questa settimana` : `Non trovato da ${m}`}</div>`).join("")}
    ${OTHER_CHAINS.length ? `<p class="muted">Dati non ancora disponibili per: ${OTHER_CHAINS.map((c) => c.name).join(", ")}.</p>` : ""}
    <h2>Storico prezzo (€/${u})</h2>
    <div class="toggle">${[30, 90].map((d) => `<button class="chip ${period === d ? "on" : ""}" data-period="${d}">${d} giorni</button>`).join("")}</div>
    <div class="card">${chart(p)}</div>
    <h2>Avvisami quando scende</h2>
    <div class="card">
      <div class="alert">
        <span>Sotto</span><input id="thr" type="number" inputmode="decimal" step="0.01" min="0" value="${alertVal ?? (list[0] ? (list[0].ppu * 0.9).toFixed(2) : "")}"><span>€/${u}</span>
        <button class="btn" id="saveAlert">${alertVal ? "Aggiorna" : "Attiva alert"}</button>
        ${alertVal ? '<button class="btn ghost" id="delAlert">Rimuovi</button>' : ""}
      </div>
      <p class="muted" style="margin:8px 0 0">${alertVal ? `Attivo: ti avviso sotto ${eur(alertVal)}/${u} in qualsiasi catena.` : "Ti avviso quando il prezzo più basso, in qualsiasi catena, scende sotto questa soglia."}</p>
    </div>`;
  $("#saveAlert").onclick = () => { const v = parseFloat($("#thr").value); if (v > 0) { store.set("alerts", { ...getAlerts(), [p.id]: v }); productView(id); } };
  $("#delAlert") && ($("#delAlert").onclick = () => { const a = getAlerts(); delete a[p.id]; store.set("alerts", a); productView(id); });
}

function chart(p) {
  const W = 340, H = 180, L = 36, B = 20, T = 8, R = 8;
  const series = offers(p).map((o) => ({ chain: o.chain, pts: o.history.slice(-period).map((h) => ({ day: h.day, v: h.price / o.qty, promo: !!h.promo })) }));
  if (!series.length || series.every((s) => s.pts.length < 2)) return `<p class="muted" style="margin:0">Lo storico si costruisce un giorno alla volta: ${series[0]?.pts.length || 0} rilevazione finora. Torna tra qualche giorno.</p>`;
  const all = series.flatMap((s) => s.pts.map((x) => x.v));
  let min = Math.min(...all), max = Math.max(...all); const pad = (max - min) * 0.1 || 0.1; min -= pad; max += pad;
  const t0 = series[0].pts[0].day, t1 = series[0].pts.at(-1).day;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks = [min + pad, (min + max) / 2, max - pad];
  const best = series.map((s) => ({ s, low: s.pts.reduce((a, b) => (b.v < a.v ? b : a)) })).sort((a, b) => a.low.v - b.low.v)[0];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Storico prezzi">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".08"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v.toFixed(2)}</text>`).join("")}
    <text x="${L}" y="${H - 4}">${fmtDate(t0)}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">oggi</text>
    ${series.map((s) => `<polyline fill="none" stroke="${chainById[s.chain].color}" stroke-width="2" stroke-linejoin="round" points="${s.pts.map((q) => `${x(q.day).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ")}"/>`).join("")}
    <circle cx="${x(best.low.day)}" cy="${y(best.low.v)}" r="4" fill="${chainById[best.s.chain].color}" stroke="#fff" stroke-width="1.5"/>
  </svg>
  <div class="chips" style="margin:6px 0 0">${series.map((s) => `<span class="muted">${logo(s.chain)} ${chainById[s.chain].name}</span>`).join("")}</div>
  <p class="muted" style="margin:6px 0 0">Minimo del periodo: ${eur(best.low.v)} da ${chainById[best.s.chain].name} il ${fmtDate(best.low.day)}. I cali improvvisi sono promo.</p>`;
}

// ---------- Offerte ----------
let offChain = "tutte", offCat = "tutte", offSort = "sconto";
const titleCase = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
function allOffers() {
  return Object.entries(FLYERS).flatMap(([c, list]) => list.map((o) => ({ chain: c, ...o, pct: o.promo?.pct || 0, cat: o.category ? titleCase(o.category) : "Altro" })));
}
function offersView() {
  $("#title").textContent = "Offerte";
  $("#back").hidden = true;
  if (MODE !== "real") { view.innerHTML = `<p class="hint">Le offerte sono disponibili solo con i dati reali.</p>`; return; }
  const all = allOffers();
  const cats = [...new Set(all.filter((o) => offChain === "tutte" || o.chain === offChain).map((o) => o.cat))].sort();
  if (!cats.includes(offCat)) offCat = "tutte";
  let list = all.filter((o) => (offChain === "tutte" || o.chain === offChain) && (offCat === "tutte" || o.cat === offCat));
  list.sort(offSort === "sconto" ? (a, b) => b.pct - a.pct || a.price - b.price : offSort === "ppu" ? (a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9) : (a, b) => a.price - b.price);
  const shown = list.slice(0, 150);
  view.innerHTML = `
    <div class="filters">
      ${["tutte", ...CHAINS.map((c) => c.id)].map((c) => `<button class="chip ${offChain === c ? "on" : ""}" data-offchain="${c}">${c === "tutte" ? "Tutte le catene" : logo(c, 16) + " " + chainById[c].name}</button>`).join("")}
    </div>
    <div class="filters">
      <select class="chip" id="offcat"><option value="tutte">Tutte le categorie</option>${cats.map((c) => `<option ${c === offCat ? "selected" : ""}>${c}</option>`).join("")}</select>
      ${[["sconto", "Sconto più alto"], ["prezzo", "Prezzo più basso"], ["ppu", "€/kg più basso"]].map(([k, l]) => `<button class="chip ${offSort === k ? "on" : ""}" data-offsort="${k}">${l}</button>`).join("")}
    </div>
    <p class="muted">${list.length} offerte${list.length > shown.length ? ` · prime ${shown.length}` : ""} · volantini validi fino al ${fmtDate(new Date(Math.max(...all.map((o) => +new Date(o.validUntil || 0)))))}</p>
    ${shown.map((o) => `<div class="card row"><div><b>${o.pct ? `<span class="disc">−${o.pct}%</span>` : ""}${titleCase(o.title)}</b><br><small class="muted">${logo(o.chain)} ${chainById[o.chain].name}${o.pack ? " · " + o.pack : ""}${o.validUntil ? ` · fino al ${fmtDate(new Date(o.validUntil))}` : ""}${o.cardPrice ? ` · con carta ${eur(o.cardPrice)}` : ""}</small></div><div class="price" style="font-size:16px">${o.promo ? `<span class="old">${eur(o.promo.oldPrice)}</span>` : ""}${eur(o.price)}<br><small class="muted">${o.ppu ? `${eur(o.ppu)}/${o.unit}` : ""}</small></div></div>`).join("")}`;
  $("#offcat").onchange = (e) => { offCat = e.target.value; offersView(); };
}

// ---------- Router ----------
function route() {
  const h = location.hash;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (h.startsWith("#offerte") ? "offerte" : "cerca")));
  if (h.startsWith("#offerte")) offersView();
  else if (h.startsWith("#p/")) productView(h.slice(3));
  else homeView(h.startsWith("#q=") ? decodeURIComponent(h.slice(3)) : "");
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go],[data-q],[data-sort],[data-period],[data-offchain],[data-offsort]");
  if (!t) return;
  if (t.dataset.go) location.hash = "#p/" + t.dataset.go;
  if (t.dataset.q) { $("#q").value = t.dataset.q; $("#q").dispatchEvent(new Event("input")); }
  if (t.dataset.sort) { sortBy = t.dataset.sort; route(); }
  if (t.dataset.period) { period = +t.dataset.period; route(); }
  if (t.dataset.offchain) { offChain = t.dataset.offchain; offersView(); }
  if (t.dataset.offsort) { offSort = t.dataset.offsort; offersView(); }
});
$("#back").onclick = () => history.length > 1 ? history.back() : (location.hash = "");
addEventListener("hashchange", route);
loadReal().then(route);
