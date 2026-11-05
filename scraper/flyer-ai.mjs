// Estrattore AI universale: legge le immagini delle pagine di un volantino e restituisce le offerte.
// Ogni pagina viene analizzata una sola volta: il risultato è salvato in data/ai-cache.json
// (chiave = impronta SHA-1 dell'immagine), quindi si paga solo quando esce un volantino nuovo.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const CACHE = new URL("../data/ai-cache.json", import.meta.url);
const MODEL = process.env.FLYER_MODEL || "claude-opus-5-5";
const MAX_NEW_PAGES = +(process.env.FLYER_MAX_PAGES || 80); // tetto di sicurezza sulla spesa per singola esecuzione

const nullable = (type) => ({ type: [type, "null"] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["offers"],
  properties: {
    offers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "brand", "pack", "price", "old_price", "unit_price", "unit", "card_price", "category"],
        properties: {
          name: { type: "string", description: "Nome del prodotto come scritto sul volantino" },
          brand: nullable("string"),
          pack: { type: "string", description: "Formato, es. '500 g', '6 x 1 l', 'al kg'" },
          price: { type: "number", description: "Prezzo finale pagato da tutti, in euro" },
          old_price: { ...nullable("number"), description: "Prezzo barrato prima dello sconto" },
          unit_price: { ...nullable("number"), description: "Prezzo al kg/litro/pezzo se stampato" },
          unit: { type: ["string", "null"], enum: ["kg", "l", "pz", null] },
          card_price: { ...nullable("number"), description: "Prezzo riservato ai possessori di carta fedeltà, se diverso" },
          category: { type: "string", enum: ["Frutta e verdura", "Carne e pesce", "Latticini e uova", "Salumi e formaggi", "Pane e dolci", "Pasta, riso e dispensa", "Bevande", "Surgelati", "Casa e igiene", "Animali", "Non alimentare"] },
        },
      },
    },
  },
};

const PROMPT = `Questa è una pagina di un volantino di un supermercato italiano.
Elenca ogni prodotto in offerta con il suo prezzo. Regole:
- Riporta solo prodotti con un prezzo leggibile sulla pagina; ignora banner, ricette e pubblicità senza prezzo.
- "price" è il prezzo che paga chiunque. Se c'è anche un prezzo con carta fedeltà/app, mettilo in "card_price".
- Se un prodotto è venduto a peso ("al kg"), metti price = prezzo al kg, pack = "al kg", unit_price = price, unit = "kg".
- Non inventare: se un valore non è stampato, usa null.
- Se la pagina non contiene offerte, restituisci una lista vuota.`;

let cache = null;
async function loadCache() {
  if (!cache) { try { cache = JSON.parse(await readFile(CACHE)); } catch { cache = {}; } }
  return cache;
}

export const aiAvailable = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * pages: [{ url, data?: Buffer, mediaType? }]
 * meta:  { validUntil?: "YYYY-MM-DD", sourceUrl?: string }
 * Ritorna offerte nel formato comune dello scraper.
 */
export async function extractFlyer(chainId, pages, meta = {}) {
  const c = await loadCache();
  const client = aiAvailable() ? new Anthropic() : null;
  const out = [];
  let analysed = 0, cached = 0, skipped = 0;
  for (const pg of pages) {
    let data = pg.data;
    if (!data) {
      const res = await fetch(pg.url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) { console.error(`[${chainId}] pagina non scaricata (${res.status}): ${pg.url}`); continue; }
      data = Buffer.from(await res.arrayBuffer());
    }
    const key = createHash("sha1").update(data).digest("hex");
    let offers = c[key]?.offers;
    if (offers) cached++;
    else if (!client || analysed >= MAX_NEW_PAGES) { skipped++; continue; }
    else {
      offers = await readPage(client, data, pg.mediaType || sniff(data), chainId);
      if (offers === null) continue;
      c[key] = { chain: chainId, model: MODEL, at: new Date().toISOString().slice(0, 10), offers };
      analysed++;
      await writeFile(CACHE, JSON.stringify(c)); // salva subito: se il job si interrompe non si ripaga
    }
    for (const o of offers) out.push(toCommon(o, meta));
  }
  console.log(`[${chainId}] pagine: ${analysed} lette con AI, ${cached} dalla cache, ${skipped} saltate${client ? "" : " (manca ANTHROPIC_API_KEY)"}`);
  return out;
}

async function readPage(client, data, mediaType, chainId) {
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: data.toString("base64") } },
        { type: "text", text: PROMPT },
      ] }],
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
      console.error(`[${chainId}] pagina non letta: ${res.stop_reason}`);
      return null;
    }
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return JSON.parse(text).offers;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error(`[${chainId}] chiave API non valida`);
    else if (e instanceof Anthropic.RateLimitError) console.error(`[${chainId}] limite di richieste raggiunto, riprovo al prossimo giro`);
    else if (e instanceof Anthropic.APIError) console.error(`[${chainId}] errore API ${e.status}: ${e.message}`);
    else console.error(`[${chainId}] ${e.message}`);
    return null;
  }
}

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

function toCommon(o, meta) {
  const ppu = o.unit_price ?? null;
  return {
    title: [o.name, o.brand].filter(Boolean).join(" · "),
    pack: o.pack || "",
    category: o.category,
    price: o.price,
    ppu,
    unit: o.unit || null,
    promo: o.old_price && o.old_price > o.price ? { oldPrice: o.old_price, pct: Math.floor((1 - o.price / o.old_price) * 100), until: meta.validUntil || null } : null,
    cardPrice: o.card_price && o.card_price < o.price ? o.card_price : null,
    validUntil: meta.validUntil || null,
    url: meta.sourceUrl || null,
    source: "ai",
  };
}
