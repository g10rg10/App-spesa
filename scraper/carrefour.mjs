// Carrefour: volantini per formato e area (es. Market Nord-Est). La pagina volantino di un negozio
// carica le anteprime delle pagine da gdodig-car.youroperator.it; da lì ricaviamo le pagine a piena
// risoluzione (stesso nome senza "_ant") e le passiamo all'estrattore AI.
// Negozio di riferimento: Carrefour Market Senago (MI); si cambia con CARREFOUR_STORE_URL.
import { createRequire } from "node:module";
import { extractFlyer } from "./flyer-ai.mjs";
const require = createRequire(import.meta.url);
const UA = { "User-Agent": "Mozilla/5.0" };
const STORE = process.env.CARREFOUR_STORE_URL || "https://www.carrefour.it/volantino/supermercato-carrefour-market-senago-via-risorgimento-51/3583";
const SKIP = /vin\d|vini|catalogo|punti|payback/i; // cataloghi vini e raccolte punti: niente prezzi della spesa

export async function loadCarrefour() {
  const { chromium } = require("playwright");
  const browser = await browser_open(chromium);
  const prefixes = new Map(); // ".../mobile/25_2026_MRK_Nord_Est_" -> nome volantino
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("response", (r) => {
      const m = r.url().match(/^(https:\/\/gdodig-car\.youroperator\.it\/volantini\/[^/]+\/[^/]+\/mobile\/(.+)_)1_ant\.jpg$/);
      if (m && !SKIP.test(m[2])) prefixes.set(m[1], m[2]);
    });
    await page.goto(STORE, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
  } finally { await browser.close(); }
  const out = [];
  for (const [prefix, name] of prefixes) {
    const pages = [];
    for (let n = 1; n <= 60; n++) {
      const r = await fetch(`${prefix}${n}.jpg`, { headers: UA });
      if (!r.ok) break;
      pages.push({ url: `${prefix}${n}.jpg`, data: Buffer.from(await r.arrayBuffer()), mediaType: "image/jpeg" });
    }
    if (!pages.length) continue;
    console.log(`[carrefour] ${name}: ${pages.length} pagine`);
    out.push(...(await extractFlyer("carrefour", pages, { validUntil: null, sourceUrl: STORE })));
  }
  return out;
}
const browser_open = (chromium) => chromium.launch();
