// Spesa Smart. Dati reali da ../data/latest.json (fallback: demo in data.js). Avvisi salvati sul dispositivo.
const $ = (s) => document.querySelector(s);
const view = $("#view");
const eur = (n) => n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const fmtDate = (t) => new Date(t).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
let chainById = Object.fromEntries(CHAINS.map((c) => [c.id, c]));
let MODE = "demo";
// Loghi: icona ufficiale del sito della catena (favicon). Se non si carica resta il pallino colorato.
const DOMAINS = { eurospin: "eurospin.it", penny: "penny.it", aldi: "aldi.it", lidl: "lidl.it", esselunga: "esselunga.it", coop: "coop.it", conad: "conad.it", carrefour: "carrefour.it", md: "mdspa.it", tigros: "tigros.it", basko: "basko.it" };
function logo(chainId, size = 20) {
  const c = chainById[chainId] || {};
  const d = DOMAINS[chainId];
  return `<span class="logo" style="width:${size}px;height:${size}px;background:${c.color || "#888"}">${d ? `<img src="https://www.google.com/s2/favicons?domain=${d}&sz=64" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
}
let FLYERS = {};      // offerte complete dei volantini (dati reali)
let OTHER_CHAINS = []; // catene senza dati
const COLORS = { eurospin: "#ca8a04", penny: "#cd1719", aldi: "#00005f", md: "#e30613", tigros: "#00843d", basko: "#e2001a", lidl: "#1d4ed8", coop: "#e85d04", conad: "#2a9d8f", esselunga: "#d62828", carrefour: "#7c3aed" };

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
    const d = latest.date ? new Date(latest.date + "T00:00:00") : null;
    const ago = d ? Math.round((TODAY - d) / 86400000) : null;
    $("#subtitle").textContent = `${CHAINS.length} catene · aggiornato ${ago === 0 ? "oggi" : ago === 1 ? "ieri" : d ? fmtDate(d) : ""}`;
  } catch {}
}
const unitLabel = (u) => ({ kg: "kg", l: "litro", pz: "pezzo" }[u]);
const store_ = {
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
  // AI e parola chiave devono essere d'accordo: "Omogeneizzato" non è latte anche se l'AI sbaglia.
  const ok = (o) => t.every((w) => mainWord(o.title, w)) && (!pids.size || !hasPid || pids.has(o.pid));
  return Object.entries(FLYERS).flatMap(([c, list]) => list.filter(ok).map((o) => ({ chain: c, ...o })))
    .sort((a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9)).slice(0, 30);
};

// ---------- Alert ----------
const getAlerts = () => store_.get("alerts", {});
function triggeredAlerts() {
  const a = getAlerts();
  return PRODUCTS.filter((p) => a[p.id] && bestOffer(p) && bestOffer(p).ppu <= a[p.id]).map((p) => ({ p, best: bestOffer(p), target: a[p.id] }));
}

// ---------- Componenti ----------
// Nomi leggibili: "TONNO PINNA GIALLA · ONDINA" -> "Tonno pinna gialla · Ondina"
function pretty(s) {
  return (s || "").split(" · ").map((part, i) => {
    if (part !== part.toUpperCase()) return part;
    const low = part.toLowerCase();
    return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }).join(" · ");
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const perUnit = (v, u) => `${eur(v)}<span class="u">/${u === "l" || u === "litro" ? "l" : u === "pezzo" ? "pz" : u}</span>`;
const chainName = (id) => chainById[id]?.name || id;
const isFood = (o) => !/non alimentare|casa e igiene/i.test(o.category || "");
const pctOff = (o) => o.promo?.pct ? Math.round(o.promo.pct * (o.promo.pct <= 1 ? 100 : 1)) : 0;

function offerRow(o, { go } = {}) {
  const pct = o.promo?.pct || 0;
  return `<div class="item"${go ? ` data-go="${go}"` : ""}>
    ${logo(o.chain, 32)}
    <div class="item-main">
      <div class="item-title">${pct ? `<span class="off">−${pct}%</span>` : ""}${esc(pretty(o.title))}</div>
      <div class="item-meta">${esc(chainName(o.chain))}${o.pack ? ` · ${esc(o.pack)}` : ""}${o.validUntil ? ` · fino al ${fmtDate(new Date(o.validUntil))}` : ""}</div>
      ${o.cardPrice ? `<div class="item-note">Con carta fedeltà ${eur(o.cardPrice)}</div>` : ""}
    </div>
    <div class="item-price">
      <div class="p">${eur(o.price)}</div>
      ${o.promo ? `<div class="was">${eur(o.promo.oldPrice)}</div>` : ""}
      ${o.ppu ? `<div class="sub">${perUnit(o.ppu, o.unit)}</div>` : ""}
    </div>
  </div>`;
}

function productRow(p) {
  const list = offers(p).sort((a, b) => a.ppu - b.ppu);
  const b = list[0];
  const save = list.length > 1 ? Math.round((1 - list[0].ppu / list.at(-1).ppu) * 100) : 0;
  return `<div class="item" data-go="${p.id}">
    ${b ? logo(b.chain, 32) : `<span class="logo empty" style="width:32px;height:32px"></span>`}
    <div class="item-main">
      <div class="item-title">${esc(p.name)}</div>
      <div class="item-meta">${!b ? "Nessuna offerta questa settimana" : list.length > 1 ? `${list.length} catene · risparmi fino al ${save}%` : `Solo da ${esc(chainName(b.chain))}`}</div>
    </div>
    <div class="item-price">${b ? `<div class="sub">da</div><div class="p">${perUnit(b.ppu, p.unit)}</div>` : `<div class="sub">—</div>`}</div>
    <span class="chev">›</span>
  </div>`;
}

const sel = (id, value, options) => `<label class="select"><select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
const section = (title, body, more = "") => `<section><div class="sec-head"><h2>${title}</h2>${more}</div>${body}</section>`;
const empty = (t) => `<p class="empty">${t}</p>`;
function setHeader(title, back = false) {
  $("#title").textContent = title;
  $("#back").hidden = !back;
}

// ---------- Home e ricerca ----------
function homeView(q = "") {
  setHeader("Spesa Smart");
  const hits = triggeredAlerts();
  view.innerHTML = `
    ${hits.map(({ p, best, target }) => `<div class="banner" data-go="${p.id}">🔔 <b>${esc(p.name)}</b> è sceso a ${perUnit(best.ppu, p.unit)} da ${esc(chainName(best.chain))} (la tua soglia: ${eur(target)})</div>`).join("")}
    <div class="searchbar"><span>🔍</span><input id="q" type="search" placeholder="Cerca un prodotto: latte, tonno, caffè…" value="${esc(q)}" autocomplete="off"></div>
    <div id="results"></div>`;
  const input = $("#q");
  const render = () => {
    const v = input.value.trim();
    history.replaceState(null, "", v ? `#q=${encodeURIComponent(v)}` : "#");
    $("#results").innerHTML = v ? resultsHtml(v) : homeHtml();
  };
  input.addEventListener("input", render);
  render();
  if (!q) input.blur();
}

function homeHtml() {
  const compared = PRODUCTS.filter((p) => offers(p).length > 1)
    .map((p) => { const l = offers(p).sort((a, b) => a.ppu - b.ppu); return { p, save: 1 - l[0].ppu / l.at(-1).ppu }; })
    .sort((a, b) => b.save - a.save).slice(0, 6);
  const deals = allOffers().filter((o) => isFood(o) && o.promo?.pct).sort((a, b) => b.promo.pct - a.promo.pct).slice(0, 5);
  const popular = PRODUCTS.filter((p) => offers(p).length).slice(0, 10);
  return `
    <div class="quick">${popular.map((p) => `<button class="chip" data-go="${p.id}">${esc(p.name)}</button>`).join("")}</div>
    ${compared.length ? section("Dove risparmi di più", compared.map(({ p }) => productRow(p)).join(""), `<a class="more" href="#catalogo">Tutti ›</a>`) : ""}
    ${deals.length ? section("Sconti più forti di oggi", deals.map((o) => offerRow(o, { go: o.pid })).join(""), `<a class="more" href="#offerte">Tutte ›</a>`) : ""}
    <p class="foot">Prezzi presi dai volantini di ${CHAINS.map((c) => `${logo(c.id, 16)} ${esc(c.name)}`).join(", ")}${MODE === "real" ? "" : " (dati dimostrativi)"}.</p>`;
}

function resultsHtml(v) {
  const res = search(v), fh = MODE === "real" ? flyerHits(v) : [];
  if (!res.length && !fh.length) return empty(`Nessun risultato per “${esc(v)}”. Prova con un nome più semplice, es. “tonno” invece di “tonno pinna gialla”.`);
  return `
    ${res.length ? section("Confronta i prezzi", res.map(productRow).join("")) : ""}
    ${fh.length ? section(`Nei volantini <small>(${fh.length})</small>`, fh.map((o) => offerRow(o, { go: o.pid })).join("")) : ""}`;
}

// ---------- Scheda prodotto ----------
let period = 30;
function productView(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return homeView();
  setHeader(p.name, true);
  const u = unitLabel(p.unit);
  const list = offers(p).sort((a, b) => a.ppu - b.ppu);
  const best = list[0], worst = list.at(-1);
  const missing = Object.entries(p.listings).filter(([, l]) => !l).map(([c]) => chainName(c));
  const alertVal = getAlerts()[p.id];
  // Negozio: nel riquadro in alto sempre (anche l'invito ad attivare la posizione), nelle righe solo se trovato.
  const store = (c, always = false) => {
    const s = nearest(c); if (s) return `📍 ${esc(s.name)} · ${s.km.toFixed(1)} km`;
    if (!always && !NEARBY[c]) return "";
    const line = storeLine(c); return line ? `📍 ${line}` : "";
  };

  const hero = !best ? `<div class="hero none"><b>Nessuna offerta questa settimana</b><p>Nessuna delle catene coperte ha ${esc(p.name.toLowerCase())} in volantino in questo momento. Attiva un avviso qui sotto per sapere quando torna.</p></div>` : `
    <div class="hero">
      <div class="hero-label">Più conveniente</div>
      <div class="hero-chain">${logo(best.chain, 36)}<span>${esc(chainName(best.chain))}</span></div>
      <div class="hero-price">${perUnit(best.ppu, p.unit)}</div>
      <div class="hero-pack">${esc(pretty(best.label))} → <b>${eur(best.price)}</b>${best.promo ? ` <span class="off">−${Math.round(best.promo.pct * 100)}%</span>` : ""}</div>
      ${list.length > 1 ? `<div class="hero-save">Risparmi il ${Math.round((1 - best.ppu / worst.ppu) * 100)}% rispetto a ${esc(chainName(worst.chain))}</div>` : ""}
      ${store(best.chain, true) ? `<div class="hero-store">${store(best.chain, true)}</div>` : ""}
    </div>`;

  view.innerHTML = `
    ${hero}
    ${list.length > 1 ? section("Tutti i prezzi <small>al " + u + "</small>", list.map((o, i) => `
      <div class="item ${i === 0 ? "best" : ""}">
        ${logo(o.chain, 32)}
        <div class="item-main">
          <div class="item-title">${esc(chainName(o.chain))}${o.promo ? ` <span class="off">−${Math.round(o.promo.pct * 100)}%</span>` : ""}</div>
          <div class="item-meta">${esc(pretty(o.label))} · ${eur(o.price)}</div>
          ${o.cardPrice ? `<div class="item-note">Con carta fedeltà ${eur(o.cardPrice)}</div>` : ""}
          ${o.promo && o.promo.until < TODAY ? `<div class="item-warn">Promo finita il ${fmtDate(o.promo.until)}: prezzo da verificare</div>` : ""}
          ${i > 0 && store(o.chain) ? `<div class="item-meta">${store(o.chain)}</div>` : ""}
        </div>
        <div class="item-price"><div class="p">${perUnit(o.ppu, p.unit)}</div>${i > 0 ? `<div class="diff">+${Math.round((o.ppu / best.ppu - 1) * 100)}%</div>` : `<div class="best-tag">migliore</div>`}</div>
      </div>`).join("")) : ""}
    ${missing.length ? `<p class="note">Non in offerta questa settimana da: ${missing.map(esc).join(", ")}.</p>` : ""}
    ${OTHER_CHAINS.length ? `<p class="note">Non ancora coperte: ${OTHER_CHAINS.map((c) => esc(c.name)).join(", ")}.</p>` : ""}
    ${section(`Andamento del prezzo <small>al ${u}</small>`, `<div class="seg">${[30, 90].map((d) => `<button class="${period === d ? "on" : ""}" data-period="${d}">${d} giorni</button>`).join("")}</div><div class="card">${chart(p)}</div>`)}
    ${section("Avvisami quando scende", `<div class="card">
      <div class="alert">
        <span>Sotto</span><input id="thr" type="number" inputmode="decimal" step="0.01" min="0" value="${alertVal ?? (best ? (best.ppu * 0.9).toFixed(2) : "")}"><span>€/${u}</span>
        <button class="btn" id="saveAlert">${alertVal ? "Aggiorna" : "Attiva"}</button>
        ${alertVal ? '<button class="btn ghost" id="delAlert">Rimuovi</button>' : ""}
      </div>
      <p class="note" style="margin:8px 0 0">${alertVal ? `Attivo: ti avviso sotto ${eur(alertVal)}/${u} in qualsiasi catena.` : "Ti avviso quando il prezzo più basso, in qualsiasi catena, scende sotto questa soglia."}</p>
    </div>`)}`;
  $("#saveAlert").onclick = () => { const v = parseFloat($("#thr").value); if (v > 0) { store_.set("alerts", { ...getAlerts(), [p.id]: v }); productView(id); } };
  $("#delAlert") && ($("#delAlert").onclick = () => { const a = getAlerts(); delete a[p.id]; store_.set("alerts", a); productView(id); });
}

function chart(p) {
  const W = 340, H = 170, L = 36, B = 20, T = 8, R = 8;
  const series = offers(p).map((o) => ({ chain: o.chain, pts: o.history.slice(-period).map((h) => ({ day: h.day, v: h.price / o.qty })) }));
  if (!series.length || series.every((s) => s.pts.length < 2)) return `<p class="note" style="margin:0">Il grafico si costruisce un giorno alla volta: torna tra qualche giorno per vedere come cambia il prezzo.</p>`;
  const all = series.flatMap((s) => s.pts.map((x) => x.v));
  let min = Math.min(...all), max = Math.max(...all); const pad = (max - min) * 0.1 || 0.1; min -= pad; max += pad;
  const t0 = Math.min(...series.map((s) => s.pts[0]?.day ?? Infinity)), t1 = Math.max(...series.map((s) => s.pts.at(-1)?.day ?? 0));
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks = [min + pad, (min + max) / 2, max - pad];
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Andamento del prezzo">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" opacity=".1"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v.toFixed(2)}</text>`).join("")}
    <text x="${L}" y="${H - 4}">${fmtDate(t0)}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">oggi</text>
    ${series.filter((s) => s.pts.length > 1).map((s) => `<polyline fill="none" stroke="${chainById[s.chain].color}" stroke-width="2.5" stroke-linejoin="round" points="${s.pts.map((q) => `${x(q.day).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ")}"/>`).join("")}
  </svg>
  <div class="legend">${series.map((s) => `<span><i style="background:${chainById[s.chain].color}"></i>${esc(chainName(s.chain))}</span>`).join("")}</div>`;
}

// ---------- Offerte ----------
let offChain = "tutte", offCat = "tutte", offSort = "sconto", offQ = "";
function allOffers() {
  return Object.entries(FLYERS).flatMap(([c, list]) => list.map((o) => ({ chain: c, ...o, cat: o.category ? pretty(o.category) : "Altro" })));
}
function offersView() {
  setHeader("Offerte");
  if (MODE !== "real") { view.innerHTML = empty("Le offerte sono disponibili solo con i dati reali."); return; }
  const all = allOffers();
  const cats = [...new Set(all.map((o) => o.cat))].sort();
  view.innerHTML = `
    <div class="searchbar"><span>🔍</span><input id="offq" type="search" placeholder="Cerca nelle offerte: tonno, pannolini…" value="${esc(offQ)}" autocomplete="off"></div>
    <div class="filters">
      ${sel("f-chain", offChain, [["tutte", "Tutte le catene"], ...CHAINS.map((c) => [c.id, c.name])])}
      ${sel("f-cat", offCat, [["tutte", "Tutte le categorie"], ...cats.map((c) => [c, c])])}
      ${sel("f-sort", offSort, [["sconto", "Sconto più alto"], ["prezzo", "Prezzo più basso"], ["ppu", "€/kg più basso"]])}
    </div>
    <div id="offlist"></div>`;
  const draw = () => {
    const qWords = norm(offQ).split(/\s+/).filter(Boolean);
    const list = all.filter((o) => (offChain === "tutte" || o.chain === offChain) && (offCat === "tutte" || o.cat === offCat)
      && qWords.every((w) => mainWord(o.title, w) || wordRe(w).test(norm(o.pack))));
    list.sort(offSort === "sconto" ? (a, b) => (b.promo?.pct || 0) - (a.promo?.pct || 0) || a.price - b.price : offSort === "ppu" ? (a, b) => (a.ppu ?? 1e9) - (b.ppu ?? 1e9) : (a, b) => a.price - b.price);
    const shown = list.slice(0, 120);
    $("#offlist").innerHTML = `<p class="count">${list.length} offerte${list.length > shown.length ? ` · prime ${shown.length}` : ""}</p>`
      + (shown.length ? `<div class="list">${shown.map((o) => offerRow(o, { go: o.pid })).join("")}</div>` : empty("Nessuna offerta con questi filtri."));
  };
  $("#offq").oninput = (e) => { offQ = e.target.value; draw(); };
  $("#f-chain").onchange = (e) => { offChain = e.target.value; draw(); };
  $("#f-cat").onchange = (e) => { offCat = e.target.value; draw(); };
  $("#f-sort").onchange = (e) => { offSort = e.target.value; draw(); };
  draw();
}

// ---------- Catalogo ----------
let catChain = "tutte", catCat = "tutte", catSort = "nome", catAvail = "tutti";
function catalogView() {
  setHeader("Catalogo");
  const cats = [...new Set(PRODUCTS.map((p) => p.category || "Altro"))].sort();
  view.innerHTML = `
    <div class="filters">
      ${sel("c-chain", catChain, [["tutte", "Tutte le catene"], ...CHAINS.map((c) => [c.id, c.name])])}
      ${sel("c-cat", catCat, [["tutte", "Tutte le categorie"], ...cats.map((c) => [c, c])])}
      ${sel("c-sort", catSort, [["nome", "Per categoria"], ["prezzo", "Prezzo più basso"], ["ppu", "€/kg più basso"]])}
      ${sel("c-avail", catAvail, [["tutti", "Tutti i prodotti"], ["prezzo", "Solo con prezzo"]])}
    </div>
    <div id="catlist"></div>`;
  const draw = () => {
    const pick = (p) => (catChain === "tutte" ? bestOffer(p) : offers(p).find((o) => o.chain === catChain));
    let rows = PRODUCTS.map((p) => ({ p, b: pick(p) }))
      .filter((r) => (catAvail === "tutti" && catChain === "tutte" || r.b) && (catCat === "tutte" || (r.p.category || "Altro") === catCat));
    const withPrice = rows.filter((r) => r.b).length;
    let html = `<p class="count">${rows.length} prodotti · ${withPrice} con un prezzo questa settimana</p>`;
    if (catSort === "nome") {
      const groups = {};
      for (const r of rows) (groups[r.p.category || "Altro"] ||= []).push(r);
      html += Object.keys(groups).sort().map((g) => section(esc(g), `<div class="list">${groups[g].sort((a, b) => a.p.name.localeCompare(b.p.name)).map(({ p }) => productRow(p)).join("")}</div>`)).join("");
    } else {
      rows.sort((a, b) => (a.b ? (catSort === "ppu" ? a.b.ppu : a.b.price) : 1e9) - (b.b ? (catSort === "ppu" ? b.b.ppu : b.b.price) : 1e9));
      html += `<div class="list">${rows.map(({ p }) => productRow(p)).join("")}</div>`;
    }
    $("#catlist").innerHTML = rows.length ? html : empty("Nessun prodotto con questi filtri.");
  };
  $("#c-chain").onchange = (e) => { catChain = e.target.value; draw(); };
  $("#c-cat").onchange = (e) => { catCat = e.target.value; draw(); };
  $("#c-sort").onchange = (e) => { catSort = e.target.value; draw(); };
  $("#c-avail").onchange = (e) => { catAvail = e.target.value; draw(); };
  draw();
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
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go],[data-period],[data-askpos]");
  if (!t) return;
  if (t.dataset.go && t.dataset.go !== "undefined") location.hash = "#p/" + t.dataset.go;
  if (t.dataset.period) { period = +t.dataset.period; route(); }
  if (t.dataset.askpos) { e.preventDefault(); askPosition(); }
});
$("#back").onclick = () => history.length > 1 ? history.back() : (location.hash = "");
addEventListener("hashchange", route);
loadReal().then(() => { if (posIsReal) loadNearby(); route(); });
