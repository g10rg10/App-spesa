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
      return { ...p, category: p.category || "", listings };
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
navigator.geolocation?.getCurrentPosition((p) => { userPos = { lat: p.coords.latitude, lon: p.coords.longitude }; posIsReal = true; if (MODE === "real") loadNearby(); route(); }, () => {}, { timeout: 5000 });
function km(a, b) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// Punti vendita reali vicino a te, da OpenStreetMap (gratuito, nessuna chiave).
// La richiesta parte dal browser dell'utente solo dopo che ha concesso la posizione.
let NEARBY = {}, nearbyState = "idle";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
async function loadNearby() {
  if (!posIsReal || nearbyState === "loading" || nearbyState === "done") return;
  nearbyState = "loading";
  const names = CHAINS.map((c) => c.name).join("|");
  const q = `[out:json][timeout:20];nwr["shop"~"supermarket|convenience"]["name"~"${names}",i](around:15000,${userPos.lat},${userPos.lon});out center tags 300;`;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!res.ok) continue;
      const els = (await res.json()).elements || [];
      NEARBY = {};
      for (const e of els) {
        const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
        const chain = CHAINS.find((c) => norm(t.name || "").includes(norm(c.name)) || norm(t.brand || "").includes(norm(c.name)));
        if (!chain || lat == null) continue;
        const st = { name: t.name, addr: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") + (t["addr:city"] ? `, ${t["addr:city"]}` : ""), lat, lon, km: km(userPos, { lat, lon }) };
        if (!NEARBY[chain.id] || st.km < NEARBY[chain.id].km) NEARBY[chain.id] = st;
      }
      nearbyState = "done"; route(); return;
    } catch {}
  }
  nearbyState = "error"; route();
}
function storeLine(chainId) {
  const name = chainById[chainId]?.name || chainId;
  if (MODE !== "real") return null;
  if (!posIsReal) return `<a href="#" data-askpos="1">Attiva la posizione per vedere il ${name} più vicino</a>`;
  const s = NEARBY[chainId];
  if (s) return `<a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener">${s.name}${s.addr ? ` · ${s.addr}` : ""}</a> · <b>${s.km < 1 ? Math.round(s.km * 1000) + " m" : s.km.toFixed(1) + " km"}</b>`;
  if (nearbyState === "loading" || nearbyState === "idle") return "Cerco il negozio più vicino…";
  return `<a href="https://www.google.com/maps/search/${encodeURIComponent(name)}/@${userPos.lat},${userPos.lon},13z" target="_blank" rel="noopener">Nessun ${name} entro 15 km: cerca su Maps</a>`;
}
function askPosition() {
  navigator.geolocation?.getCurrentPosition((p) => { userPos = { lat: p.coords.latitude, lon: p.coords.longitude }; posIsReal = true; nearbyState = "idle"; loadNearby(); route(); }, () => alert("Posizione non disponibile: controlla i permessi del browser."), { timeout: 8000 });
}

function nearest(chainId) {
  if (MODE === "real") return null;
  return STORES.filter((s) => s.chain === chainId).map((s) => ({ ...s, km: km(userPos, s) })).sort((a, b) => a.km - b.km)[0];
}

// ---------- Ricerca ----------
// Ricerca a parole intere (inizio parola): "latte" non deve trovare "fiordilatte".
const wordRe = (w) => new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
function search(q) {
  const t = norm(q).split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  return PRODUCTS.filter((p) => {
    const hay = [p.name, ...p.aliases].map(norm).join(" | ");
    return t.every((w) => wordRe(w).test(hay));
  });
}
// Nei volantini la parola cercata non deve comparire come ingrediente o gusto:
// "cioccolato al latte", "burro da creme di latte", "panini al latte" non sono latte.
const PREP = /(?:\/\s*$)|(?:^|\s)(?:al|allo|alla|ai|agli|alle|all'|con|di|da|del|dello|della|dei|degli|delle|gusto|sapore|aroma|ripien[oaie]|e)\s+$/;
function mainWord(title, w) {
  const t = norm(title);
  const re = new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  let m;
  while ((m = re.exec(t))) { if (!PREP.test(t.slice(0, m.index + m[1].length))) return true; }
  return false;
}
const offers = (p) => Object.entries(p.listings).filter(([, l]) => l).map(([chain, l]) => ({ chain, ...l, ppu: l.price / l.qty }));
const bestOffer = (p) => offers(p).sort((a, b) => a.ppu - b.ppu)[0];
const flyerHits = (q) => {
  const t = norm(q).split(/\s+/).filter(Boolean);
  if (!t.length) return [];
  // Se la ricerca corrisponde a prodotti del catalogo, mostra solo le offerte che l'AI ha riconosciuto come quei prodotti.
  const pids = new Set(search(q).map((p) => p.id));
  const hasPid = Object.values(FLYERS).some((l) => l.some((o) => o.pid));
  const ok = (o) => (pids.size && hasPid ? pids.has(o.pid) : t.every((w) => mainWord(o.title, w)));
  return Object.entries(FLYERS).flatMap(([c, list]) => list.filter(ok).map((o) => ({ chain: c, ...o })))
    .sort((a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9)).slice(0, 30);
};

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
        <div class="muted">📍 ${s ? `${s.name} · ${s.km.toFixed(1)} km${posIsReal ? "" : " (da Milano centro)"}` : storeLine(o.chain)}</div><div></div>
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
let offChain = "tutte", offCat = "tutte", offSort = "sconto", maxPrice = 0, offQ = "";
const PRICE_STEPS = [0, 1, 2, 5, 10];
const priceChips = () => `<div class="filters">${PRICE_STEPS.map((v) => `<button class="chip ${maxPrice === v ? "on" : ""}" data-maxprice="${v}">${v ? `fino a ${v} €` : "Qualsiasi prezzo"}</button>`).join("")}</div>`;
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
  const qWords = norm(offQ).split(/\s+/).filter(Boolean);
  let list = all.filter((o) => (offChain === "tutte" || o.chain === offChain) && (offCat === "tutte" || o.cat === offCat) && (!maxPrice || o.price <= maxPrice)
    && qWords.every((w) => mainWord(o.title, w) || wordRe(w).test(norm(o.pack))));
  list.sort(offSort === "sconto" ? (a, b) => b.pct - a.pct || a.price - b.price : offSort === "ppu" ? (a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9) : (a, b) => a.price - b.price);
  const shown = list.slice(0, 150);
  view.innerHTML = `
    <input id="offq" class="search" type="search" placeholder="Cerca nelle offerte, es. tonno, pannolini…" value="${offQ.replace(/"/g, "&quot;")}" autocomplete="off" style="margin-bottom:10px">
    <div class="filters">
      ${["tutte", ...CHAINS.map((c) => c.id)].map((c) => `<button class="chip ${offChain === c ? "on" : ""}" data-offchain="${c}">${c === "tutte" ? "Tutte le catene" : logo(c, 16) + " " + chainById[c].name}</button>`).join("")}
    </div>
    <div class="filters">
      <select class="chip" id="offcat"><option value="tutte">Tutte le categorie</option>${cats.map((c) => `<option ${c === offCat ? "selected" : ""}>${c}</option>`).join("")}</select>
      ${[["sconto", "Sconto più alto"], ["prezzo", "Prezzo più basso"], ["ppu", "€/kg più basso"]].map(([k, l]) => `<button class="chip ${offSort === k ? "on" : ""}" data-offsort="${k}">${l}</button>`).join("")}
    </div>
    ${priceChips()}
    <div id="offlist"><p class="muted">${list.length} offerte${list.length > shown.length ? ` · prime ${shown.length}` : ""} · volantini validi fino al ${fmtDate(new Date(Math.max(...all.map((o) => +new Date(o.validUntil || 0)))))}</p>
    ${shown.map((o) => `<div class="card row"><div><b>${o.pct ? `<span class="disc">−${o.pct}%</span>` : ""}${titleCase(o.title)}</b><br><small class="muted">${logo(o.chain)} ${chainById[o.chain].name}${o.pack ? " · " + o.pack : ""}${o.validUntil ? ` · fino al ${fmtDate(new Date(o.validUntil))}` : ""}${o.cardPrice ? ` · con carta ${eur(o.cardPrice)}` : ""}</small></div><div class="price" style="font-size:16px">${o.promo ? `<span class="old">${eur(o.promo.oldPrice)}</span>` : ""}${eur(o.price)}<br><small class="muted">${o.ppu ? `${eur(o.ppu)}/${o.unit}` : ""}</small></div></div>`).join("")}${!list.length ? `<p class="hint">Nessuna offerta con questi filtri.</p>` : ""}</div>`;
  const inp = $("#offq");
  inp.oninput = () => { offQ = inp.value; const pos = inp.selectionStart; offersView(); const n = $("#offq"); n.focus(); n.setSelectionRange(pos, pos); };
  $("#offcat").onchange = (e) => { offCat = e.target.value; offersView(); };
}

// ---------- Catalogo ----------
let catOnlyAvail = false, catChain = "tutte", catCat = "tutte", catSort = "nome";
function catalogView() {
  $("#title").textContent = "Catalogo";
  $("#back").hidden = true;
  const pick = (p) => (catChain === "tutte" ? bestOffer(p) : offers(p).find((o) => o.chain === catChain));
  const cats = [...new Set(PRODUCTS.map((p) => p.category || "Altro"))].sort();
  let rows = PRODUCTS.map((p) => ({ p, b: pick(p), n: offers(p).length }))
    .filter((r) => (!catOnlyAvail && catChain === "tutte" || r.b) && (!maxPrice || (r.b && r.b.price <= maxPrice)) && (catCat === "tutte" || (r.p.category || "Altro") === catCat));
  if (catSort !== "nome") {
    rows.sort((a, b) => (a.b ? (catSort === "ppu" ? a.b.ppu : a.b.price) : 1e9) - (b.b ? (catSort === "ppu" ? b.b.ppu : b.b.price) : 1e9));
  }
  const groups = {};
  for (const r of rows) (groups[r.p.category || "Altro"] ||= []).push(r);
  setTimeout(() => { const sel = $("#catcat"); if (sel) sel.onchange = (e) => { catCat = e.target.value; catalogView(); }; });
  const upd = Math.max(0, ...PRODUCTS.flatMap((p) => offers(p).map((o) => o.updatedAt || 0)));
  view.innerHTML = `
    <div class="filters">
      ${["tutte", ...CHAINS.map((c) => c.id)].map((c) => `<button class="chip ${catChain === c ? "on" : ""}" data-catchain="${c}">${c === "tutte" ? "Tutte le catene" : logo(c, 16) + " " + chainById[c].name}</button>`).join("")}
    </div>
    <div class="filters">
      <select class="chip" id="catcat"><option value="tutte">Tutte le categorie</option>${cats.map((c) => `<option ${c === catCat ? "selected" : ""}>${c}</option>`).join("")}</select>
      ${[["nome", "A-Z"], ["prezzo", "Prezzo più basso"], ["ppu", "€/kg più basso"]].map(([k, l]) => `<button class="chip ${catSort === k ? "on" : ""}" data-catsort="${k}">${l}</button>`).join("")}
      <button class="chip ${catOnlyAvail ? "on" : ""}" data-onlyavail="1">Solo con prezzo</button>
    </div>
    ${priceChips()}
    <p class="muted">${rows.length} prodotti · ${PRODUCTS.filter((p) => bestOffer(p)).length} con almeno un prezzo${upd ? ` · aggiornato ${fmtDate(upd)}` : ""}${maxPrice ? ` · prezzo confezione fino a ${maxPrice} €` : ""}</p>
    ${(catSort === "nome" ? Object.keys(groups).sort().map((g) => [g, groups[g].sort((a, b) => a.p.name.localeCompare(b.p.name))]) : [["", rows]]).map(([g, items]) => (g ? `<h2>${g}</h2>` : "") + items.map(({ p, b, n }) => `
      <div class="card prod" data-go="${p.id}">
        <div><b>${p.name}</b><br><small class="muted">${n ? `${n} su ${CHAINS.length} ${CHAINS.length === 1 ? "catena" : "catene"}${b.promo ? " · in offerta" : ""}` : "nessuna offerta questa settimana"}</small></div>
        <div class="price" style="font-size:16px">${b ? `${eur(b.ppu)}<small class="muted">/${unitLabel(p.unit)}</small><br><small class="muted">${logo(b.chain, 14)} ${eur(b.price)}</small>` : `<small class="muted">—</small>`}</div>
      </div>`).join("")).join("")}`;
}

// ---------- Router ----------
function route() {
  const h = location.hash;
  const tab = h.startsWith("#offerte") ? "offerte" : h.startsWith("#catalogo") ? "catalogo" : "cerca";
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  if (tab === "offerte") offersView();
  else if (tab === "catalogo") catalogView();
  else if (h.startsWith("#p/")) productView(h.slice(3));
  else homeView(h.startsWith("#q=") ? decodeURIComponent(h.slice(3)) : "");
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go],[data-q],[data-sort],[data-period],[data-offchain],[data-offsort],[data-maxprice],[data-onlyavail],[data-askpos],[data-catchain],[data-catsort]");
  if (!t) return;
  if (t.dataset.go) location.hash = "#p/" + t.dataset.go;
  if (t.dataset.q) { $("#q").value = t.dataset.q; $("#q").dispatchEvent(new Event("input")); }
  if (t.dataset.sort) { sortBy = t.dataset.sort; route(); }
  if (t.dataset.period) { period = +t.dataset.period; route(); }
  if (t.dataset.offchain) { offChain = t.dataset.offchain; offersView(); }
  if (t.dataset.offsort) { offSort = t.dataset.offsort; offersView(); }
  if (t.dataset.askpos) { e.preventDefault(); askPosition(); }
  if (t.dataset.maxprice) { maxPrice = +t.dataset.maxprice; route(); }
  if (t.dataset.onlyavail) { catOnlyAvail = !catOnlyAvail; catalogView(); }
  if (t.dataset.catchain) { catChain = t.dataset.catchain; catalogView(); }
  if (t.dataset.catsort) { catSort = t.dataset.catsort; catalogView(); }
});
$("#back").onclick = () => history.length > 1 ? history.back() : (location.hash = "");
addEventListener("hashchange", route);
loadReal().then(() => { if (posIsReal) loadNearby(); route(); });
