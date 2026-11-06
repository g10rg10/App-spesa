/* Spesa Smart · helper di formato e logica dei confronti.
   JS puro, nessuna dipendenza. Usabile come modulo ES o incollato in app.js.
   I nomi dei campi sono indicativi: adattarli alla struttura reale di data/latest.json. */

const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });
const nfQ = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });

/** 1.49 → "1,49 €" */
export function euro(n) { return `${nf2.format(n)} €`; }

/** 6.912, 'kg' → "6,91 €/kg" ; unità ammesse: kg, l, pz */
export function unitPrice(n, unit) { return `${nf2.format(n)} €/${unit}`; }

/** Formato confezione abbreviato.
 *  pack({qty:0.96, unit:'kg'}) → "960 g"
 *  pack({qty:60, unit:'g', count:3}) → "3×60 g"
 *  pack({qty:1, unit:'l', count:6}) → "6×1 l"
 *  pack({qty:1, unit:'pz'}) → "1 pz"
 *  pack({perUnit:true, unit:'kg'}) → "al kg" */
export function pack({ qty, unit, count = 1, perUnit = false }) {
  if (perUnit) return `al ${unit}`;
  let q = qty, u = unit;
  if (u === 'kg' && q < 1) { q = q * 1000; u = 'g'; }
  if (u === 'l' && q < 1) { q = q * 1000; u = 'ml'; }
  if (u === 'g' && q >= 1000) { q = q / 1000; u = 'kg'; }
  if (u === 'ml' && q >= 1000) { q = q / 1000; u = 'l'; }
  const base = `${nfQ.format(q)} ${u}`;
  return count > 1 ? `${count}×${base}` : base;
}

/** Date di validità brevi: "al 15/11" */
export function validUntil(date) {
  const d = new Date(date);
  return `al ${d.getDate()}/${d.getMonth() + 1}`;
}

/** Aggiornamento dati: "oggi 07:30" · "ieri 13:30" · "3/11 07:30" */
export function updatedAt(date, now = new Date()) {
  const d = new Date(date);
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `oggi ${hm}`;
  if (diff === 1) return `ieri ${hm}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${hm}`;
}

/** Sconto del volantino, arrotondato: (1.99, 2.99) → "−33%" (segno meno tipografico) */
export function discountLabel(price, was) {
  return `−${nf0.format(Math.round((1 - price / was) * 100))}%`;
}

/** Risparmio della migliore rispetto alla più cara, in % intero: (6.91, 11.06) → 38 */
export function savingPct(best, worst) { return Math.round((1 - best / worst) * 100); }

/** Quanto costa in più del migliore: (9.37, 6.91) → "+36%" ; il migliore restituisce "" */
export function diffLabel(price, best) {
  const p = Math.round((price / best - 1) * 100);
  return p <= 0 ? '' : `+${p}%`;
}

/** Risparmio in euro mostrato nel verdetto.
 *  Quantità di riferimento: confezioni della migliore offerta fino ad almeno 500 g / 500 ml (minimo 1).
 *  bestPackQty in kg o l. Esempio tonno: 0,16 kg → 4 confezioni = 0,64 kg → (11,06 − 6,91) × 0,64 = 2,66 €.
 *  Ritorna { packs, euro } oppure null se il prodotto è a pezzi. */
export function savingEuro({ bestUnit, worstUnit, bestPackQty, unit }) {
  if (unit === 'pz') return null;
  const packs = Math.max(1, Math.ceil(0.5 / bestPackQty - 1e-9));
  const value = (worstUnit - bestUnit) * bestPackQty * packs;
  return { packs, euro: Math.round(value * 100) / 100 };
}

/* ---------- Affidabilità del confronto ----------
   Regola di prodotto: i confronti non affidabili NON si mostrano (nessun filtro per l'utente).
   Un confronto tra offerte di catene diverse è affidabile solo se tutte le condizioni valgono. */

const QUALITY_MARKERS = [
  /\b(doc|docg|igt|igp|dop)\b/i,  // vini e denominazioni
  /\bbio(logic[oa])?\b/i,
  /\b(light|zero|senza lattosio|delattosat[oa])\b/i,
  /\b(integrale)\b/i,
  /\b(extra ?vergine|evo)\b/i,   // "EVO" è la sigla di extravergine
];

function markers(name) { return QUALITY_MARKERS.map((re) => re.test(name)); }

/** offers: [{ name, unit: 'kg'|'l'|'pz', packQty (in kg/l/pz), unitPrice }]
 *  Ritorna true se il confronto si può mostrare. */
export function isReliableComparison(offers) {
  if (offers.length < 2) return false;
  // 1. stessa unità di misura
  if (new Set(offers.map((o) => o.unit)).size !== 1) return false;
  // 2. stessa classe di qualità (es. non DOC contro vino da tavola, non bio contro non bio)
  const m0 = markers(offers[0].name).join();
  if (offers.some((o) => markers(o.name).join() !== m0)) return false;
  // 3. formati paragonabili: la confezione più grande non supera 8 volte la più piccola
  const q = offers.map((o) => o.packQty);
  if (Math.max(...q) / Math.min(...q) > 8) return false;
  // 4. differenza plausibile: oltre il 60% di risparmio si considera un errore di matching
  const u = offers.map((o) => o.unitPrice);
  if (savingPct(Math.min(...u), Math.max(...u)) > 60) return false;
  return true;
}

/* ---------- Normalizzazione dei volantini ---------- */

const KEEP_UPPER = new Set(['DOP', 'IGP', 'DOC', 'DOCG', 'IGT', 'UHT', 'BIO']);

/** "TONNO ALL'OLIO DI OLIVA ONDINA" → "Tonno all'olio di oliva Ondina" (marca da gestire a parte se nota) */
export function sentenceCase(s) {
  const words = s.trim().replace(/\s+/g, ' ').toLowerCase().split(' ');
  return words.map((w, i) => {
    const up = w.toUpperCase();
    if (KEEP_UPPER.has(up)) return up;
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }).join(' ');
}

/** Mappa le categorie delle catene alle 10 del catalogo. Estendere con i valori reali. */
export const CATEGORY_MAP = [
  [/latt|uova|yogurt|burro/i, 'Latticini e uova'],
  [/salum|formagg|gastronom/i, 'Salumi e formaggi'],
  [/pane|colazion|biscott|cereal|merend/i, 'Pane e colazione'],
  [/pasta|riso|dispensa|conserv|scatol|olio|sugh/i, 'Pasta, riso e dispensa'],
  [/bevand|acqua|vin|birr|succ/i, 'Bevande'],
  [/carne|pesce|macelleri|pescheri/i, 'Carne e pesce'],
  [/frutta|verdur|ortofrutt/i, 'Frutta e verdura'],
  [/surgel|gelat/i, 'Surgelati'],
  [/casa|igiene|deters|pulizi|cura persona/i, 'Casa e igiene'],
  [/animal|pet|cane|gatto/i, 'Animali'],
];
export function normalizeCategory(raw) {
  for (const [re, cat] of CATEGORY_MAP) if (re.test(raw)) return cat;
  return null; // categoria sconosciuta: loggare e aggiungere alla mappa
}

/* ---------- La mia lista: dove costa meno questa settimana ----------
   items: prodotti scelti dall'utente, ciascuno con le migliori offerte per catena di QUESTA settimana
     [{ id, name, offers: [{ chain, unitPrice }] }]  (offers vuoto = non in offerta)
   Considera solo i confronti affidabili a monte (isReliableComparison sul prodotto).
   Ritorna:
     { winner: 'Aldi' | null, byChain: [{ chain, items: [...] }] ordinato per numero di prodotti,
       counts: { Aldi: 3, ... }, inOffer: 5, missing: [item, ...] }
   A parità di conteggio vince la catena con la somma €/unità più bassa sui suoi prodotti. */
export function listVerdict(items) {
  const byChain = new Map();
  const missing = [];
  for (const item of items) {
    if (!item.offers || item.offers.length === 0) { missing.push(item); continue; }
    const best = item.offers.reduce((a, b) => (b.unitPrice < a.unitPrice ? b : a));
    if (!byChain.has(best.chain)) byChain.set(best.chain, []);
    byChain.get(best.chain).push({ ...item, best });
  }
  const groups = [...byChain.entries()]
    .map(([chain, list]) => ({ chain, items: list, total: list.reduce((s, i) => s + i.best.unitPrice, 0) }))
    .sort((a, b) => b.items.length - a.items.length || a.total - b.total);
  const counts = Object.fromEntries(groups.map((g) => [g.chain, g.items.length]));
  return {
    winner: groups.length ? groups[0].chain : null,
    byChain: groups.map(({ chain, items }) => ({ chain, items })),
    counts,
    inOffer: items.length - missing.length,
    missing,
  };
}
