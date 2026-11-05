// Eurospin: legge le offerte del volantino digitale pubblico (flyer.eurospin.com).
// Apre il visualizzatore come un normale browser e raccoglie i dati prodotto che la pagina stessa carica.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const BASE = "https://flyer.eurospin.com/it-it/punti-vendita/eurospin-italia/promozioni/";
const day = (s) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const prop = (e, code) => { const v = e.properties?.find((p) => p.code === code)?.values?.[0] ?? null; return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v; };

export async function loadEurospin() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let promotions = [];
  const products = new Map();
  // La pagina chiede i prodotti a blocchi di 24: chiediamo il volantino intero in una sola richiesta.
  await page.route(/\/products\?size=\d+/, (r) => r.continue({ url: r.request().url().replace(/size=\d+/, "size=1000") }));
  page.on("response", async (r) => {
    const u = r.url();
    try {
      if (/\/stores\/eurospin-italia\/promotions$/.test(u)) promotions = await r.json();
      else if (/\/products\?size=/.test(u)) for (const e of (await r.json()).elements || []) products.set(e.identifier, e);
    } catch {}
  });
  await page.goto(BASE.replace(/promozioni\/$/, "").replace("punti-vendita/eurospin-italia/", "") + "volantino", { waitUntil: "networkidle", timeout: 60000 });
  // Visita anche gli altri volantini attivi (es. nazionale + speciali)
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (const p of promotions) {
    if (p.hidden || (p.endDate && p.endDate.slice(0, 8) < today) || (p.startDate && p.startDate.slice(0, 8) > today)) continue;
    if (page.url().endsWith(p.alias)) continue;
    await page.goto(BASE + p.alias, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await browser.close();

  return [...products.values()].map((e) => {
    const price = prop(e, "END-PRICE");
    if (typeof price !== "number") return null;
    const unit = { KG: "kg", LT: "l", L: "l", PZ: "pz" }[prop(e, "MEASURE-UNIT")] || null;
    const old = prop(e, "INITIAL-PRICE");
    return {
      title: [prop(e, "TITLE") || e.description, prop(e, "MARK")].filter(Boolean).join(" · "),
      pack: prop(e, "DESCRIPTION") || "",
      category: prop(e, "CATEGORY"),
      price,
      ppu: prop(e, "END-KG-LT-PRICE"),
      unit,
      promo: old && old > price ? { oldPrice: old, pct: prop(e, "DISCOUNT-RATE"), until: day(prop(e, "END-DATE-VALIDITY")) } : null,
      validFrom: day(prop(e, "START-DATE-VALIDITY")),
      validUntil: day(prop(e, "END-DATE-VALIDITY")),
      url: "https://flyer.eurospin.com/it-it/volantino",
    };
  }).filter(Boolean);
}

// Test rapido: node scraper/eurospin.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const offers = await loadEurospin();
  console.log(offers.length, "offerte");
  console.log(offers.slice(0, 5));
}
