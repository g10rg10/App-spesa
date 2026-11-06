// Scraper giornaliero. Node >= 20, nessuna dipendenza.
// Uso: node scraper/scrape.mjs  -> aggiorna data/latest.json e data/history.json
import { readFile, writeFile } from "node:fs/promises";
import { loadEurospin } from "./eurospin.mjs";
import { loadPenny } from "./penny.mjs";
import { loadAldi } from "./aldi.mjs";
import { ebsnChain } from "./ebsn.mjs";
import { loadMd } from "./md.mjs";
import { loadCarrefour } from "./carrefour.mjs";
import { VO_CHAINS, voChain } from "./volantinoggi.mjs";
import { aiAvailable } from "./flyer-ai.mjs";
import { classify, offerKey } from "./classify.mjs";

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
  aldi:     { name: "Aldi",     coverage: "volantino", load: loadAldi, ai: true },
  tigros:   { name: "Tigros",   coverage: "volantino", load: ebsnChain("tigros", "www.tigros.it"), ai: true },
  carrefour: { name: "Carrefour", coverage: "volantino", load: loadCarrefour, ai: true },
  md:       { name: "MD",       coverage: "volantino", load: loadMd, ai: true },
  // Catene da volantinoggi.it, in ordine di priorità
  ...Object.fromEntries(VO_CHAINS.map((c) => [c.id, { name: c.name, coverage: "volantino", load: voChain(c), ai: true }])),
  basko:    { name: "Basko",    coverage: "volantino", load: ebsnChain("basko", "www.basko.it"), ai: true },
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
  lidl:      { name: "Lidl",      note: "Il sito blocca le richieste automatiche (401)" },
};

// Corrispondenza a inizio parola: "vino" non deve trovare "bovino", "cola" non "cioccolatini".
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Un termine che finisce con "$" deve essere una parola intera ("te$" non trova "tenero").
const hasWord = (t, w) => {
  const whole = w.endsWith("$");
  const term = esc(norm(whole ? w.slice(0, -1) : w).trim());
  return new RegExp("(^|[^a-z0-9])" + term + (whole ? "(?![a-z0-9])" : "")).test(t);
};

// cls: Map(offerKey -> productId|null) dal classificatore AI. Per le offerte classificate vale l'AI,
// per le altre (nessuna chiave e non in cache) si usano le regole del catalogo.
function pickBest(results, match, unit, productId, cls) {
  const ok = results.filter((r) => {
    const k = offerKey(r);
    const t = norm(r.title + " " + r.pack);
    // Se l'offerta è stata classificata, l'AI deve essere d'accordo; in ogni caso devono valere anche le regole.
    // Doppio controllo: l'AI elimina i falsi positivi delle parole chiave, le regole quelli dell'AI.
    if (cls?.has(k) && cls.get(k) !== productId) return false;
    return match.must.every((w) => w.split("|").some((alt) => hasWord(t, alt))) && !match.exclude.some((w) => hasWord(t, w));
  });
  ok.sort((a, b) => ((a.unit === unit ? a.ppu : null) ?? 1e9) - ((b.unit === unit ? b.ppu : null) ?? 1e9) || a.price - b.price);
  return ok[0] || null;
}

// Ordine di lettura AI: le catene con più punti vendita prima (il budget gratuito giornaliero è limitato).
const PRIORITY = ["eurospin", "penny", "conad", "coop", "despar", "carrefour", "crai", "md", "aldi", "todis", "sisa", "famila", "ao", "tigros", "basko", "bennet", "iperal", "ali"];
const ordered = (obj) => Object.entries(obj).sort(([a], [b]) => (PRIORITY.indexOf(a) + 1 || 99) - (PRIORITY.indexOf(b) + 1 || 99));

async function main() {
  const catalog = JSON.parse(await readFile(new URL("scraper/catalog.json", ROOT)));
  const histPath = new URL("data/history.json", ROOT);
  let history = {};
  try { history = JSON.parse(await readFile(histPath)); } catch {}

  const chains = [];
  const products = catalog.products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, category: p.category, aliases: p.aliases, offers: {} }));

  const flyers = {}; // offerte complete per catena, per la ricerca libera nell'app
  // Offerte del giro precedente: se una catena oggi non risponde, si tengono quelle ancora valide.
  let prevFlyers = {};
  try { prevFlyers = JSON.parse(await readFile(new URL("data/latest.json", ROOT))).flyers || {}; } catch {}
  const stillValid = (id) => (prevFlyers[id] || []).filter((o) => !o.validUntil || o.validUntil >= today);
  for (const [chainId, ad] of ordered(ADAPTERS)) {
    if (ad.enabled === false) continue;
    let errors = 0, all = null, cls = null;
    if (ad.load) {
      try {
        all = await ad.load();
        if (!all.length && stillValid(chainId).length) {
          all = stillValid(chainId);
          console.warn(`[${chainId}] nessuna offerta letta oggi: tengo ${all.length} offerte ancora valide del giro precedente`);
        }
        if (!all.length) {
          console.warn(`[${chainId}] nessuna offerta`); chains.push({ id: chainId, name: ad.name, status: "non_coperta", note: ad.ai ? (aiAvailable() ? "Volantino in lettura con AI: pronto nei prossimi giri" : "Volantino letto con AI: serve GROQ_API_KEY su GitHub") : "Nessuna offerta letta" }); continue; }
        flyers[chainId] = all; console.log(`[${chainId}] ${all.length} offerte`);
        cls = await classify(all, catalog);
        for (const o of all) { const pid = cls.get(offerKey(o)); if (pid) o.pid = pid; } // l'app usa pid per la ricerca
      }
      catch (e) {
        console.error(`[${chainId}] errore: ${e.message}`);
        if (stillValid(chainId).length) { all = stillValid(chainId); console.warn(`[${chainId}] tengo ${all.length} offerte ancora valide del giro precedente`); }
        else { chains.push({ id: chainId, name: ad.name, coverage: ad.coverage, status: "errore" }); continue; }
        flyers[chainId] = all;
        cls = await classify(all, catalog);
      }
    }
    for (const [i, p] of catalog.products.entries()) {
      const m = p.match[chainId] || p.match;
      try {
        const best = pickBest(all || (await ad.search(m.query)), m, p.unit, p.id, cls);
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
