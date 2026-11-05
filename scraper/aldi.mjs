// Aldi: volantino settimanale su volantino.aldi.it (piattaforma Publitas).
// Trova il volantino corrente, scarica le immagini delle pagine e le passa all'estrattore AI.
import { createRequire } from "node:module";
import { extractFlyer } from "./flyer-ai.mjs";
const require = createRequire(import.meta.url);
const UA = { "User-Agent": "Mozilla/5.0" };
const MONTHS = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

export async function loadAldi() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  let hrefs = [];
  try {
    const page = await browser.newPage();
    await page.goto("https://www.aldi.it/volantino-online", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("a[href*='volantino.aldi.it']", { timeout: 20000 }).catch(() => {});
    hrefs = await page.$$eval("a[href*='volantino.aldi.it']", (as) => as.map((a) => a.href));
  } finally { await browser.close(); }
  const slugs = [...new Set(hrefs.map((h) => h.match(/volantino\.aldi\.it\/([a-z0-9_]+)/)?.[1]).filter(Boolean))];
  if (!slugs.length) throw new Error("volantino corrente non trovato");
  const out = [], seen = new Set();
  for (const slug of slugs.slice(0, 3)) {
    const spreads = await (await fetch(`https://volantino.aldi.it/${slug}/spreads.json`, { headers: UA })).json();
    const pages = spreads.flatMap((s) => s.pages).map((p) => ({ url: "https://volantino.aldi.it" + (p.images.at1200 || p.images.at1000) })).filter((p) => !seen.has(p.url) && seen.add(p.url));
    if (!pages.length) continue;
    // "aldi_offerte_da_lunedi_2_novembre" -> offerte valide 7 giorni da quella data
    const m = slug.match(/(\d{1,2})_([a-z]+)/);
    let validUntil = null;
    if (m && MONTHS[m[2]]) {
      const y = new Date().getFullYear();
      const d = new Date(Date.UTC(y, MONTHS[m[2]] - 1, +m[1] + 6));
      validUntil = d.toISOString().slice(0, 10);
    }
    out.push(...(await extractFlyer("aldi", pages, { validUntil, sourceUrl: `https://volantino.aldi.it/${slug}` })));
  }
  return out;
}
