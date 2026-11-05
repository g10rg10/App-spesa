// Dati DEMO. Struttura identica a quella che dovrà restituire il backend:
// catene, negozi, prodotti normalizzati, listino per catena (null = non venduto).
// Lo storico è generato in modo deterministico per simulare 90 giorni di rilevazioni.

const CHAINS = [
  { id: "esselunga", name: "Esselunga", color: "#d62828" },
  { id: "coop",      name: "Coop",      color: "#e85d04" },
  { id: "conad",     name: "Conad",     color: "#2a9d8f" },
  { id: "lidl",      name: "Lidl",      color: "#1d4ed8" },
  { id: "carrefour", name: "Carrefour", color: "#7c3aed" },
  { id: "eurospin",  name: "Eurospin",  color: "#ca8a04" },
];

// Negozi demo intorno a Milano
const STORES = [
  { chain: "esselunga", name: "Esselunga Viale Piave",      lat: 45.4718, lon: 9.2064 },
  { chain: "esselunga", name: "Esselunga Via Ripamonti",    lat: 45.4392, lon: 9.2001 },
  { chain: "coop",      name: "Coop Piazza Lodi",           lat: 45.4489, lon: 9.2185 },
  { chain: "coop",      name: "Coop Via Arona",             lat: 45.4886, lon: 9.1561 },
  { chain: "conad",     name: "Conad City Corso Buenos Aires", lat: 45.4790, lon: 9.2093 },
  { chain: "conad",     name: "Conad Via Tortona",          lat: 45.4529, lon: 9.1653 },
  { chain: "lidl",      name: "Lidl Via Pellegrino Rossi",  lat: 45.5182, lon: 9.1777 },
  { chain: "lidl",      name: "Lidl Viale Monza",           lat: 45.5003, lon: 9.2243 },
  { chain: "carrefour", name: "Carrefour Express Via Torino", lat: 45.4610, lon: 9.1848 },
  { chain: "carrefour", name: "Carrefour Market Via Padova",  lat: 45.4955, lon: 9.2290 },
  { chain: "eurospin",  name: "Eurospin Via Novara",        lat: 45.4730, lon: 9.1093 },
];

// qty in kg o litri; base = prezzo tipico della confezione
const PRODUCTS = [
  { id: "peperoncino-verde", name: "Peperoncino verde fresco", unit: "kg", category: "Ortofrutta",
    aliases: ["chilli verde", "chili verde", "peperoncini verdi", "jalapeno", "peperoncino piccante"],
    listings: {
      esselunga: { label: "Peperoncini verdi piccanti 100 g", qty: 0.1, base: 1.29 },
      coop:      { label: "Peperoncino verde vaschetta 150 g", qty: 0.15, base: 1.79 },
      conad:     { label: "Peperoncini verdi 100 g", qty: 0.1, base: 1.39 },
      lidl: null,
      carrefour: { label: "Peperoncino verde sfuso", qty: 1, base: 9.90 },
      eurospin: null,
    } },
  { id: "pomodori-ciliegino", name: "Pomodori ciliegino", unit: "kg", category: "Ortofrutta",
    aliases: ["pomodorini", "ciliegini", "cherry tomatoes", "pomodoro ciliegia"],
    listings: {
      esselunga: { label: "Pomodoro ciliegino 500 g", qty: 0.5, base: 2.19 },
      coop:      { label: "Pomodorini ciliegino 500 g", qty: 0.5, base: 1.99 },
      conad:     { label: "Ciliegino Sapori&Dintorni 400 g", qty: 0.4, base: 1.89 },
      lidl:      { label: "Pomodorini ciliegino 500 g", qty: 0.5, base: 1.49 },
      carrefour: { label: "Pomodoro ciliegino 250 g", qty: 0.25, base: 1.29 },
      eurospin:  { label: "Pomodorini 500 g", qty: 0.5, base: 1.39 },
    } },
  { id: "latte-intero", name: "Latte intero fresco", unit: "l", category: "Latticini",
    aliases: ["latte", "latte fresco", "latte alta qualità"],
    listings: {
      esselunga: { label: "Latte fresco intero 1 l", qty: 1, base: 1.59 },
      coop:      { label: "Latte fresco intero Coop 1 l", qty: 1, base: 1.45 },
      conad:     { label: "Latte intero fresco 1 l", qty: 1, base: 1.49 },
      lidl:      { label: "Latte fresco intero Milbona 1 l", qty: 1, base: 1.19 },
      carrefour: { label: "Latte intero 1 l", qty: 1, base: 1.55 },
      eurospin:  { label: "Latte fresco intero 1 l", qty: 1, base: 1.15 },
    } },
  { id: "spaghetti", name: "Spaghetti di semola", unit: "kg", category: "Pasta",
    aliases: ["pasta", "spaghetti n.5", "spaghettoni"],
    listings: {
      esselunga: { label: "Spaghetti n.5 500 g", qty: 0.5, base: 0.89 },
      coop:      { label: "Spaghetti Coop 1 kg", qty: 1, base: 1.49 },
      conad:     { label: "Spaghetti 500 g", qty: 0.5, base: 0.85 },
      lidl:      { label: "Spaghetti Combino 1 kg", qty: 1, base: 1.09 },
      carrefour: { label: "Spaghetti 500 g", qty: 0.5, base: 0.79 },
      eurospin:  { label: "Spaghetti Tre Mulini 500 g", qty: 0.5, base: 0.55 },
    } },
  { id: "olio-evo", name: "Olio extravergine d'oliva", unit: "l", category: "Dispensa",
    aliases: ["olio", "evo", "olio extra vergine", "olio oliva"],
    listings: {
      esselunga: { label: "Olio EVO 100% italiano 1 l", qty: 1, base: 9.99 },
      coop:      { label: "Olio extravergine Coop 1 l", qty: 1, base: 8.79 },
      conad:     { label: "Olio EVO 750 ml", qty: 0.75, base: 6.99 },
      lidl:      { label: "Olio EVO Primadonna 1 l", qty: 1, base: 7.49 },
      carrefour: { label: "Olio extravergine 1 l", qty: 1, base: 8.99 },
      eurospin:  { label: "Olio EVO 1 l", qty: 1, base: 6.99 },
    } },
  { id: "avocado", name: "Avocado Hass", unit: "kg", category: "Ortofrutta",
    aliases: ["avocado", "avocadi"],
    listings: {
      esselunga: { label: "Avocado Hass 2 pz (~400 g)", qty: 0.4, base: 2.99 },
      coop:      { label: "Avocado pronto da mangiare 2 pz", qty: 0.4, base: 3.29 },
      conad: null,
      lidl:      { label: "Avocado Hass rete 500 g", qty: 0.5, base: 2.49 },
      carrefour: { label: "Avocado sfuso", qty: 1, base: 6.90 },
      eurospin: null,
    } },
  { id: "uova", name: "Uova fresche (6)", unit: "pz", category: "Latticini",
    aliases: ["uova", "uovo", "uova bio", "uova allevate a terra"],
    listings: {
      esselunga: { label: "Uova allevate a terra 6 pz", qty: 6, base: 2.09 },
      coop:      { label: "Uova fresche 6 pz", qty: 6, base: 1.99 },
      conad:     { label: "Uova fresche 6 pz", qty: 6, base: 2.15 },
      lidl:      { label: "Uova a terra 6 pz", qty: 6, base: 1.69 },
      carrefour: { label: "Uova 6 pz", qty: 6, base: 2.19 },
      eurospin:  { label: "Uova 6 pz", qty: 6, base: 1.59 },
    } },
  { id: "zenzero", name: "Zenzero fresco", unit: "kg", category: "Ortofrutta",
    aliases: ["zenzero", "ginger"],
    listings: {
      esselunga: { label: "Zenzero fresco 150 g", qty: 0.15, base: 1.49 },
      coop: null,
      conad:     { label: "Zenzero radice sfuso", qty: 1, base: 7.90 },
      lidl:      { label: "Zenzero 200 g", qty: 0.2, base: 1.29 },
      carrefour: null,
      eurospin: null,
    } },
];

// ---------- Generazione storico demo (deterministica) ----------
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const DAY = 86400000;
const TODAY = new Date(new Date().toDateString()).getTime();
const HISTORY_DAYS = 90;

function buildHistory(productId, chainId, base) {
  const r = rng(hashStr(productId + chainId));
  const points = [];
  let level = base * (0.95 + r() * 0.1);
  let promo = null; // {start, end, pct}
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const day = TODAY - i * DAY;
    if (r() < 0.02) level *= 1 + (r() < 0.6 ? 0.04 : -0.03);       // ritocchi di listino
    if (!promo && r() < 0.025) promo = { start: day, end: day + (6 + Math.floor(r() * 8)) * DAY, pct: [0.2, 0.25, 0.3][Math.floor(r() * 3)] };
    let price = Math.round(level * 100) / 100;
    let promoOn = promo && day >= promo.start && day <= promo.end;
    if (promoOn) price = Math.round(level * (1 - promo.pct) * 100) / 100;
    points.push({ day, price, list: Math.round(level * 100) / 100, promo: promoOn ? { until: promo.end, pct: promo.pct } : null });
    if (promo && day >= promo.end) promo = null;
  }
  return points;
}

// Simula freschezza dati diversa per catena (non tutte aggiornano ogni giorno)
const STALENESS = { esselunga: 0, coop: 0, conad: 1, lidl: 0, carrefour: 2, eurospin: 0 };

for (const p of PRODUCTS) {
  for (const [chainId, l] of Object.entries(p.listings)) {
    if (!l) continue;
    l.history = buildHistory(p.id, chainId, l.base);
    const last = l.history[l.history.length - 1 - STALENESS[chainId]];
    l.price = last.price;
    l.listPrice = last.list;
    l.promo = last.promo;
    l.updatedAt = last.day;
  }
}
