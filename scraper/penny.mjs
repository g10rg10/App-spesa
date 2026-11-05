// Penny: legge le pagine pubbliche del volantino su penny.it (HTML renderizzato).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const num = (s) => (s ? parseFloat(s.replace(/[^\d,]/g, "").replace(",", ".")) : null);
const isoFromIt = (s) => { const m = s && s.match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

export async function loadPenny() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    // Il nome della categoria cambia ogni settimana (es. "volantino-5-novembre"): la cerco nella pagina offerte.
    await page.goto("https://www.penny.it/offerte", { waitUntil: "networkidle", timeout: 60000 });
    const flyerUrl = await page.evaluate(() => [...document.querySelectorAll("a[href*='/categorie/volantino-']")].map((a) => a.href.split(/[?#]/)[0]).sort((a, b) => a.length - b.length)[0]);
    if (!flyerUrl) throw new Error("link al volantino non trovato");
    const items = [];
    for (let n = 1; n <= 10; n++) {
      await page.goto(`${flyerUrl}?page=${n}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("[data-test='product-tile']", { timeout: 20000 }).catch(() => {});
      const tiles = await page.$$eval("[data-test='product-tile']", (els) => els.map((el) => {
        const q = (s) => el.querySelector(`[data-test='${s}']`);
        return {
          slug: el.dataset.productSlug,
          title: q("product-title")?.innerText.trim(),
          pack: [...(q("product-information-piece-description")?.querySelectorAll("li") || [])].map((li) => li.innerText.trim()).join(" · "),
          validity: q("product-price-validity")?.innerText || "",
          prices: [...el.querySelectorAll("[data-test='product-price-type']")].map((pt) => ({
            text: pt.innerText,
            main: pt.querySelector(".ws-product-price-value__main")?.innerText,
            strike: pt.querySelector("s")?.innerText,
            caption: pt.querySelector("[data-test='product-price-type-label']")?.innerText,
          })),
        };
      }));
      const fresh = tiles.filter((t) => !items.some((i) => i.slug === t.slug));
      if (!fresh.length) break;
      items.push(...fresh);
    }
    return items.map((t) => {
      // Prezzo per tutti (senza carta fedeltà); il prezzo con PENNYCard va in "cardPrice"
      const pub = t.prices.find((p) => !/con pennycard/i.test(p.text)) || t.prices[0];
      const card = t.prices.find((p) => /con pennycard/i.test(p.text));
      if (!pub?.main) return null;
      const price = num(pub.main);
      const cap = pub.caption?.match(/1\s*(kg|l|pz)\s+([\d.,]+)/i);
      const [from, until] = (t.validity.match(/\d{2}\.\d{2}\.\d{4}/g) || []).map(isoFromIt);
      const old = num(pub.strike);
      return {
        title: t.title.replace(/\s*•\s*/g, " · "), pack: t.pack, price,
        ppu: cap ? num(cap[2]) : null, unit: cap ? cap[1].toLowerCase() : null,
        promo: old && old > price ? { oldPrice: old, pct: Math.floor((1 - price / old) * 100), until } : null,
        cardPrice: card ? num(card.main) : null,
        validFrom: from, validUntil: until,
        url: `https://www.penny.it/prodotto/${t.slug}`,
      };
    }).filter(Boolean);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = await loadPenny();
  console.log(o.length, "offerte"); console.log(o.slice(0, 4)); console.log(o.filter((x) => x.cardPrice).slice(0, 1));
}
