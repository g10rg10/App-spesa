// Scraper giornaliero. Node >= 20, nessuna dipendenza.
// Uso: node scraper/scrape.mjs  -> aggiorna data/latest.json e data/history.json
import { readFile, writeFile } from "node:fs/promises";
import { loadEurospin } from "./eurospin.mjs";
import { loadPenny } from "./penny.mjs";

const ROOT = new URL("../", import.meta.url);
const UA = "Mozilla/5.0 (compatible; AppSpesaBot/0.1; prototipo personale)";
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/\s+/g, " ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Converte "1 kg = 1.98 €" o "1 l = 0,89 €" -> { ppu, unit }
function parseBase(text) {
  const m = text && text.match(/1\s*(kg|l|pz)[^=]*=\s*([\d.,]+)/i);
  return m ? { ppu: parseFloat(m[2].replace(",", ".")), unit: m[1].toLowerCase() } : null;
}
// Ricava quantità da "500 g confezione", "1000 ml bottiglia", "6 pezzi"
function parseQty(text) {
  const m = text && norm(text).match(/([\d.,]+)\s*(kg|g|ml|cl|l|pz|pezzi)\b/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return { kg: [n, "kg"], g: [n / 1000, "kg"], l: [n, "l"], cl: [n / 100, "l"], ml: [n / 1000, "l"], pz: [n, "pz"], pezzi: [n, "pz"] }[m[2]];
}

// ---------- Adapter per catena ----------
// Ogni adapter ha:
//  - load()  -> tutte le offerte della catena (volantini), cercate poi in locale, oppure
//  - search(query) -> risultati di ricerca (siti con motore di ricerca)
// Ogni offerta: { title, pack, price, ppu, unit, promo, url }
const ADAPTERS = {
  eurospin: { name: "Eurospin", coverage: "volantino", load: loadEurospin },
  penny:    { name: "Penny",    coverage: "volantino", load: loadPenny },
  lidl: {
    name: "Lidl",
    coverage: "sito",
    enabled: false, // risponde 401 alle richieste automatiche: disattivato

    async search(q) {
      const url = `https://www.lidl.it/q/api/search?q=${encodeURIComponent(q)}&locale=it_IT&assortment=IT&version=2.1.0&fetchsize=48`;
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.items || []).map((it) => {
        const g = it.gridbox?.data || {};
        const p = g.price || {};
        if (typeof p.price !== "number") return null;
        let base = parseBase(p.basePrice?.text);
        if (!base) { const q2 = parseQty(p.packaging?.text); if (q2) base = { ppu: +(p.price / q2[0]).toFixed(2), unit: q2[1] }; }
        const until = g.stockAvailability?.badgeInfoV2?.[0]?.validUntil;
        const promo = p.discount && p.oldPrice
          ? { oldPrice: p.oldPrice, pct: p.discount.percentageDiscount, until: until ? new Date(until * 1000).toISOString().slice(0, 10) : null }
          : null;
        return { title: g.fullTitle || g.title, pack: p.packaging?.text || "", price: p.price, ppu: base?.ppu ?? null, unit: base?.unit ?? null,
                 promo, url: g.canonicalUrl ? "https://www.lidl.it" + g.canonicalUrl : null };
      }).filter(Boolean);
    },
  },
};

// Catene note ma non ancora coperte: l'app mostra "dati non disponibili", NON "non trovato".
const NOT_COVERED = {
  esselunga: { name: "Esselunga", note: "Prezzi online visibili solo dopo login/CAP" },
  coop:      { name: "Coop",      note: "L'API c'è ma senza negozio selezionato non restituisce prezzi" },
  conad:     { name: "Conad",     note: "Il sito blocca le richieste automatiche (403)" },
  carrefour: { name: "Carrefour", note: "Il sito blocca le richieste automatiche (403)" },
  lidl:      { name: "Lidl",      note: "Il sito blocca le richieste automatiche (401)" },
};

// Corrispondenza a inizio parola: "vino" non deve trovare "bovino", "cola" non "cioccolatini".
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (t, w) => new RegExp("(^|[^a-z0-9])" + esc(norm(w).trim())).test(t);

function pickBest(results, match, unit) {
  const ok = results.filter((r) => {
    const t = norm(r.title + " " + r.pack);
    return match.must.every((w) => w.split("|").some((alt) => hasWord(t, alt))) && !match.exclude.some((w) => hasWord(t, w));
  });
  ok.sort((a, b) => ((a.unit === unit ? a.ppu : null) ?? 1e9) - ((b.unit === unit ? b.ppu : null) ?? 1e9) || a.price - b.price);
  return ok[0] || null;
}

async function main() {
  const catalog = JSON.parse(await readFile(new URL("scraper/catalog.json", ROOT)));
  const histPath = new URL("data/history.json", ROOT);
  let history = {};
  try { history = JSON.parse(await readFile(histPath)); } catch {}

  const chains = [];
  const products = catalog.products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, aliases: p.aliases, offers: {} }));

  const flyers = {}; // offerte complete per catena, per la ricerca libera nell'app
  for (const [chainId, ad] of Object.entries(ADAPTERS)) {
    if (ad.enabled === false) continue;
    let errors = 0, all = null;
    if (ad.load) {
      try { all = await ad.load(); flyers[chainId] = all; console.log(`[${chainId}] ${all.length} offerte`); }
      catch (e) { console.error(`[${chainId}] ${e.message}`); chains.push({ id: chainId, name: ad.name, coverage: ad.coverage, status: "errore" }); continue; }
    }
    for (const [i, p] of catalog.products.entries()) {
      const m = p.match[chainId] || p.match;
      try {
        const best = pickBest(all || (await ad.search(m.query)), m, p.unit);
        products[i].offers[chainId] = best ? { found: true, ...best, updatedAt: today } : { found: false, updatedAt: today };
        if (best) {
          const h = ((history[p.id] ||= {})[chainId] ||= []);
          const row = [today, best.price, best.ppu, best.promo ? 1 : 0];
          if (h.at(-1)?.[0] === today) h[h.length - 1] = row; else h.push(row);
        }
      } catch (e) {
        errors++;
        console.error(`[${chainId}] ${p.id}: ${e.message}`);
      }
      if (!all) await sleep(1500); // gentili con il sito
    }
    chains.push({ id: chainId, name: ad.name, coverage: ad.coverage, status: errors === 0 ? "ok" : errors === catalog.products.length ? "errore" : "parziale" });
  }
  for (const [id, c] of Object.entries(NOT_COVERED)) chains.push({ id, name: c.name, status: "non_coperta", note: c.note });

  if (chains.every((c) => c.status !== "ok")) { console.error("Nessuna fonte funzionante: dati NON sovrascritti."); process.exit(1); }
  await writeFile(new URL("data/latest.json", ROOT), JSON.stringify({ generatedAt: new Date().toISOString(), date: today, chains, products, flyers }));
  await writeFile(histPath, JSON.stringify(history));
  const found = products.filter((p) => Object.values(p.offers).some((o) => o.found)).length;
  console.log(`OK ${today}: ${found}/${products.length} prodotti trovati`);
}
main();
