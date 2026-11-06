// Estrattore AI universale: legge le immagini delle pagine di un volantino e restituisce le offerte.
// Ogni pagina viene analizzata una sola volta: il risultato è salvato in data/ai-cache.json
// (chiave = impronta SHA-1 dell'immagine), quindi si paga solo quando esce un volantino nuovo.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const CACHE = new URL("../data/ai-cache.json", import.meta.url);
// Provider: "groq" (piano gratuito, modelli open con visione) oppure "anthropic" (Claude, a pagamento).
// Si sceglie da solo in base alla chiave presente; FLYER_PROVIDER forza la scelta.
const PROVIDER = process.env.FLYER_PROVIDER || (process.env.GROQ_API_KEY ? "groq" : "anthropic");
const MODEL = process.env.FLYER_MODEL || (PROVIDER === "groq" ? "qwen/qwen3.8-27b" : "claude-opus-5-5");
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
let newPagesThisRun = 0;   // contatore globale sulle pagine nuove (tetto di spesa/limiti)
let providerExhausted = false; // limite giornaliero raggiunto: si riprende al prossimo giro
async function loadCache() {
  if (!cache) { try { cache = JSON.parse(await readFile(CACHE)); } catch { cache = {}; } }
  return cache;
}

export const aiAvailable = () => (PROVIDER === "groq" ? !!process.env.GROQ_API_KEY : !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * pages: [{ url, data?: Buffer, mediaType? }]
 * meta:  { validUntil?: "YYYY-MM-DD", sourceUrl?: string }
 * Ritorna offerte nel formato comune dello scraper.
 */
export async function extractFlyer(chainId, pages, meta = {}) {
  const c = await loadCache();
  const client = !aiAvailable() ? null : PROVIDER === "groq" ? "groq" : new Anthropic();
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
    else if (!client || providerExhausted || newPagesThisRun >= MAX_NEW_PAGES) { skipped++; continue; }
    else {
      offers = PROVIDER === "groq"
        ? await readPageGroq(data, pg.mediaType || sniff(data), chainId)
        : await readPage(client, data, pg.mediaType || sniff(data), chainId);
      if (offers === null) continue;
      c[key] = { chain: chainId, model: MODEL, at: new Date().toISOString().slice(0, 10), offers };
      analysed++; newPagesThisRun++;
      await writeFile(CACHE, JSON.stringify(c)); // salva subito: se il job si interrompe non si ripaga
    }
    for (const o of offers) out.push(toCommon(o, meta));
  }
  console.log(`[${chainId}] pagine: ${analysed} lette con ${PROVIDER}/${MODEL}, ${cached} dalla cache, ${skipped} saltate${client ? "" : " (manca la chiave API)"}`);
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

// Groq: API compatibile OpenAI. Il piano gratuito ha limiti al minuto, quindi rallentiamo e ritentiamo sui 429.
async function readPageGroq(data, mediaType, chainId) {
  const body = {
    model: MODEL,
    temperature: 0,
    max_completion_tokens: 8000,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: [
      { type: "text", text: PROMPT + "\n\nRispondi SOLO con un oggetto JSON conforme a questo schema:\n" + JSON.stringify(SCHEMA) },
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${data.toString("base64")}` } },
    ] }],
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = (+res.headers.get("retry-after") || 20) * 1000;
      if (wait > 120000) { providerExhausted = true; console.error(`[${chainId}] limite giornaliero Groq raggiunto: riprendo al prossimo giro`); return null; }
      await sleep(wait); continue;
    }
    if (!res.ok) { console.error(`[${chainId}] errore Groq ${res.status}: ${(await res.text()).slice(0, 300)}`); return null; }
    const json = await res.json();
    try {
      const offers = JSON.parse(json.choices[0].message.content).offers;
      if (!Array.isArray(offers)) throw new Error("campo offers mancante");
      await sleep(+(process.env.FLYER_DELAY_MS || 2500));
      return offers.filter((o) => o && typeof o.name === "string" && typeof o.price === "number" && o.price > 0);
    } catch (e) { console.error(`[${chainId}] risposta Groq non valida: ${e.message}`); return null; }
  }
  return null;
}

function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

// Ricava kg/l/pezzi dal formato ("500 g", "6 x 1 l", "2 kg") per calcolare il prezzo per unità se manca.
function qtyFromPack(pack) {
  const t = (pack || "").toLowerCase().replace(",", ".");
  const m = t.match(/(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  if (!m) return null;
  const n = (m[1] ? +m[1] : 1) * +m[2];
  return { kg: [n, "kg"], g: [n / 1000, "kg"], l: [n, "l"], cl: [n / 100, "l"], ml: [n / 1000, "l"] }[m[3]];
}

function toCommon(o, meta) {
  let ppu = o.unit_price ?? null, unit = o.unit || null;
  if (ppu == null) { const q = qtyFromPack(o.pack); if (q && q[0] > 0) { ppu = +(o.price / q[0]).toFixed(2); unit = q[1]; } }
  // Controllo di coerenza: il modello a volte scambia il prezzo al kg per il prezzo barrato.
  // Scartiamo il "barrato" se coincide col prezzo per unità o implica uno sconto oltre il 60%.
  let old = o.old_price;
  if (old && ((ppu && Math.abs(old - ppu) < 0.02) || old > o.price * 2.5)) old = null;

  return {
    title: [o.name, o.brand].filter(Boolean).join(" · "),
    pack: o.pack || "",
    category: o.category,
    price: o.price,
    ppu,
    unit,
    promo: old && old > o.price ? { oldPrice: old, pct: Math.floor((1 - o.price / old) * 100), until: meta.validUntil || null } : null,
    cardPrice: o.card_price && o.card_price < o.price ? o.card_price : null,
    validUntil: meta.validUntil || null,
    url: meta.sourceUrl || null,
    source: "ai",
  };
}
