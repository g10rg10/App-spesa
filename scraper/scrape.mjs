// Scraper giornaliero. Node >= 20, nessuna dipendenza.
// Uso: node scraper/scrape.mjs  -> aggiorna data/latest.json e data/history.json
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const UA = "Mozilla/5.0 (compatible; AppSpesaBot/0.1; prototipo personale)";
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

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
// Ogni adapter: search(query) -> [{ title, price, ppu, unit, promo, url }]
const ADAPTERS = {
  lidl: {
    name: "Lidl",
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
  eurospin:  { name: "Eurospin",  note: "Solo volantino, da valutare" },
};

function pickBest(results, match, unit) {
  const ok = results.filter((r) => {
    const t = norm(r.title + " " + r.pack);
    return match.must.every((w) => t.includes(norm(w))) && !match.exclude.some((w) => t.includes(norm(w)));
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

  for (const [chainId, ad] of Object.entries(ADAPTERS)) {
    let errors = 0;
    for (const [i, p] of catalog.products.entries()) {
      const m = p.match[chainId] || p.match;
      try {
        const best = pickBest(await ad.search(m.query), m, p.unit);
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
      await sleep(1500); // gentili con il sito
    }
    chains.push({ id: chainId, name: ad.name, status: errors === 0 ? "ok" : errors === catalog.products.length ? "errore" : "parziale" });
  }
  for (const [id, c] of Object.entries(NOT_COVERED)) chains.push({ id, name: c.name, status: "non_coperta", note: c.note });

  if (chains.every((c) => c.status !== "ok")) { console.error("Nessuna fonte funzionante: dati NON sovrascritti."); process.exit(1); }
  await writeFile(new URL("data/latest.json", ROOT), JSON.stringify({ generatedAt: new Date().toISOString(), chains, products }, null, 1));
  await writeFile(histPath, JSON.stringify(history));
  const found = products.filter((p) => Object.values(p.offers).some((o) => o.found)).length;
  console.log(`OK ${today}: ${found}/${products.length} prodotti trovati`);
}
main();
