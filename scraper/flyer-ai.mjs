// Estrattore AI universale: legge le immagini delle pagine di un volantino e restituisce le offerte.
// Ogni pagina viene analizzata una sola volta: il risultato è salvato in data/ai-cache.json
// (chiave = impronta SHA-1 dell'immagine), quindi si paga solo quando esce un volantino nuovo.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);

// Le pagine vengono ridotte a 1280 px di lato lungo con ImageMagick: i prezzi restano leggibili e
// i token per pagina scendono molto (il piano gratuito di Groq ha un tetto di token al giorno).
const MAX_SIDE = +(process.env.FLYER_MAX_SIDE || 1280);
async function shrink(data) {
  if (data.length < 150_000) return { data, mediaType: null };
  const dir = await mkdtemp(join(tmpdir(), "pg-"));
  try {
    await writeFile(join(dir, "in"), data);
    await run("convert", [join(dir, "in"), "-resize", `${MAX_SIDE}x${MAX_SIDE}>`, "-quality", "85", join(dir, "out.jpg")]);
    return { data: await readFile(join(dir, "out.jpg")), mediaType: "image/jpeg" };
  } catch { return { data, mediaType: null }; }
  finally { await rm(dir, { recursive: true, force: true }); }
}

const CACHE = new URL("../data/ai-cache.json", import.meta.url);
// Provider in coda: si usa il primo con la chiave presente; quando esaurisce la quota del giorno si passa al successivo.
//  - gemini    (GEMINI_API_KEY)    piano gratuito, modello Flash scelto automaticamente (o GEMINI_MODEL)
//  - groq      (GROQ_API_KEY)      piano gratuito, modello con visione (GROQ_MODEL)
//  - github    (GITHUB_MODELS_TOKEN) GitHub Models, gratuito: nel workflow è il token automatico di GitHub
//  - anthropic (ANTHROPIC_API_KEY) a pagamento, Claude
// FLYER_PROVIDERS cambia l'ordine, es. "groq,gemini".
const KEYS = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", github: "GITHUB_MODELS_TOKEN", anthropic: "ANTHROPIC_API_KEY" };
const PROVIDERS = (process.env.FLYER_PROVIDERS || "gemini,groq,github,anthropic").split(",").map((x) => x.trim()).filter((p) => KEYS[p] && process.env[KEYS[p]]);
const exhausted = new Set();
const currentProvider = () => PROVIDERS.find((p) => !exhausted.has(p)) || null;
const GROQ_MODEL = process.env.GROQ_MODEL || process.env.FLYER_MODEL || "qwen/qwen3.8-27b";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const GITHUB_MODEL = process.env.GITHUB_MODEL || "openai/gpt-4o-mini";
let geminiModel = process.env.GEMINI_MODEL || null;
let geminiCandidates = null; // modelli Flash disponibili, dal migliore; si scorre se uno è sovraccarico o senza quota
const modelOf = (p) => ({ gemini: geminiModel || "gemini", groq: GROQ_MODEL, github: GITHUB_MODEL }[p] || CLAUDE_MODEL);
const MAX_NEW_PAGES = +(process.env.FLYER_MAX_PAGES || 80); // tetto di sicurezza sulla spesa per singola esecuzione
// Tempo massimo per la lettura AI: dopo, si smette di leggere pagine nuove e si salvano i dati.
// Deve restare sotto il limite del workflow, altrimenti GitHub interrompe il giro prima del salvataggio.
const STARTED = Date.now();
const TIME_BUDGET_MS = +(process.env.FLYER_TIME_BUDGET_MIN || 60) * 60000;
const outOfTime = () => Date.now() - STARTED > TIME_BUDGET_MS;

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
let tokensUsed = 0;
async function loadCache() {
  if (!cache) { try { cache = JSON.parse(await readFile(CACHE)); } catch { cache = {}; } }
  return cache;
}

export const aiAvailable = () => PROVIDERS.length > 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * pages: [{ url, data?: Buffer, mediaType? }]
 * meta:  { validUntil?: "YYYY-MM-DD", sourceUrl?: string }
 * Ritorna offerte nel formato comune dello scraper.
 */
export async function extractFlyer(chainId, pages, meta = {}) {
  const c = await loadCache();
  const out = [];
  let analysed = 0, cached = 0, skipped = 0;
  const used = new Set();
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
    else if (!currentProvider() || newPagesThisRun >= MAX_NEW_PAGES || outOfTime()) { skipped++; continue; }
    else {
      const small = await shrink(data);
      const mt = small.mediaType || pg.mediaType || sniff(small.data);
      // Prova il provider corrente; se nel frattempo esaurisce la quota, riprova la stessa pagina col successivo.
      let provider = null;
      for (let p = currentProvider(); p; p = currentProvider()) {
        provider = p;
        try {
          offers = p === "gemini" ? await readPageGemini(small.data, mt, chainId)
            : p === "groq" ? await readPageGroq(small.data, mt, chainId)
            : p === "github" ? await readPageGithub(small.data, mt, chainId)
            : await readPage(new Anthropic(), small.data, mt, chainId);
        } catch (e) {
          // Una risposta inattesa non deve fermare il giro: si scarta questo provider per oggi.
          console.error(`[${chainId}] ${p}: risposta inattesa (${e.message.slice(0, 120)}), passo al successivo`);
          exhausted.add(p); offers = null;
        }
        if (offers !== null || !exhausted.has(p)) break;
      }
      if (!offers) { if (!currentProvider()) skipped++; continue; }
      used.add(`${provider}/${modelOf(provider)}`);
      c[key] = { chain: chainId, model: modelOf(provider), at: new Date().toISOString().slice(0, 10), offers };
      analysed++; newPagesThisRun++;
      await writeFile(CACHE, JSON.stringify(c)); // salva subito: se il job si interrompe non si ripaga
    }
    for (const o of offers) out.push(toCommon(o, meta));
  }
  console.log(`[${chainId}] pagine: ${analysed} lette${used.size ? ` con ${[...used].join(", ")}` : ""}${analysed && tokensUsed ? ` (~${Math.round(tokensUsed / Math.max(1, newPagesThisRun))} token/pagina)` : ""}, ${cached} dalla cache, ${skipped} saltate${PROVIDERS.length ? (currentProvider() ? "" : " (quote AI del giorno esaurite)") : " (nessuna chiave AI)"}${outOfTime() ? " (tempo del giro finito)" : ""}`);
  return out;
}

async function readPage(client, data, mediaType, chainId) {
  try {
    const res = await client.beta.messages.create({
      model: CLAUDE_MODEL,
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
    if (e instanceof Anthropic.AuthenticationError) { exhausted.add("anthropic"); console.error(`[${chainId}] chiave Anthropic non valida`); }
    else if (e instanceof Anthropic.RateLimitError) { exhausted.add("anthropic"); console.error(`[${chainId}] limite Anthropic raggiunto, riprovo al prossimo giro`); }
    else if (e instanceof Anthropic.APIError) console.error(`[${chainId}] errore API ${e.status}: ${e.message}`);
    else console.error(`[${chainId}] ${e.message}`);
    return null;
  }
}

// Groq: API compatibile OpenAI. Il piano gratuito ha limiti al minuto e al giorno: niente ragionamento
// (inutile per leggere un volantino e costoso in token), risposta compatta, nuovi tentativi sui 429.
const GROQ_EXAMPLE = '{"offers":[{"name":"Mascarpone","brand":"Cucina","pack":"500 g","price":2.69,"old_price":2.99,"unit_price":5.38,"unit":"kg","card_price":null,"category":"Latticini e uova"}]}';
const CATEGORIES = SCHEMA.properties.offers.items.properties.category.enum.join(", ");
let groqNoReasoning = true;
async function readPageGroq(data, mediaType, chainId) {
  const body = {
    model: GROQ_MODEL,
    temperature: 0,
    max_completion_tokens: 4000,
    response_format: { type: "json_object" },
    ...(groqNoReasoning ? { reasoning_effort: "none" } : {}),
    messages: [{ role: "user", content: [
      { type: "text", text: `${PROMPT}\n- unit è "kg", "l", "pz" o null. category è una di: ${CATEGORIES}.\nRispondi SOLO con JSON in questo formato:\n${GROQ_EXAMPLE}` },
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
      const txt = await res.text();
      if (wait > 120000 || /tokens per day|TPD|requests per day|RPD/i.test(txt)) { exhausted.add("groq"); console.error(`[${chainId}] limite giornaliero Groq raggiunto`); return null; }
      await sleep(wait); continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 400 && groqNoReasoning && /reasoning/i.test(txt)) { groqNoReasoning = false; delete body.reasoning_effort; attempt--; continue; }
      if (/tokens per day|TPD/i.test(txt)) { exhausted.add("groq"); console.error(`[${chainId}] limite giornaliero Groq raggiunto`); return null; }
      console.error(`[${chainId}] errore Groq ${res.status}: ${txt.slice(0, 300)}`); return null;
    }
    const json = await res.json();
    if (json.usage) tokensUsed += json.usage.total_tokens || 0;
    try {
      const offers = JSON.parse(json.choices[0].message.content).offers;
      if (!Array.isArray(offers)) throw new Error("campo offers mancante");
      await sleep(+(process.env.FLYER_DELAY_MS || 2500));
      return offers.filter((o) => o && typeof o.name === "string" && typeof o.price === "number" && o.price > 0);
    } catch (e) { console.error(`[${chainId}] risposta Groq non valida: ${e.message}`); return null; }
  }
  return null;
}

// GitHub Models: API compatibile OpenAI. Quota gratuita bassa (decine di richieste al giorno): fa da riserva.
async function readPageGithub(data, mediaType, chainId) {
  const body = {
    model: GITHUB_MODEL, temperature: 0, max_tokens: 4000, response_format: { type: "json_object" },
    messages: [{ role: "user", content: [
      { type: "text", text: `${PROMPT}\n- unit è "kg", "l", "pz" o null. category è una di: ${CATEGORIES}.\nRispondi SOLO con JSON in questo formato:\n${GROQ_EXAMPLE}` },
      { type: "image_url", image_url: { url: `data:${mediaType};base64,${data.toString("base64")}`, detail: "high" } },
    ] }],
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch("https://models.github.ai/inference/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GITHUB_MODELS_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = +(res.headers.get("retry-after") || 60);
      if (wait > 120) { exhausted.add("github"); console.error(`[${chainId}] quota giornaliera GitHub Models esaurita`); return null; }
      await sleep(wait * 1000); continue;
    }
    if (res.status === 401 || res.status === 403) { exhausted.add("github"); console.error(`[${chainId}] GitHub Models non autorizzato (serve "models: read" nel workflow)`); return null; }
    if (!res.ok) { const txt = await res.text(); if (res.status === 413 || /too large|size/i.test(txt)) { console.error(`[${chainId}] pagina troppo grande per GitHub Models`); return null; } console.error(`[${chainId}] errore GitHub Models ${res.status}: ${txt.slice(0, 200)}`); return null; }
    const raw = await res.text();
    let json;
    try { json = JSON.parse(raw); }
    catch { exhausted.add("github"); console.error(`[${chainId}] GitHub Models: risposta non JSON (status ${res.status}, ${res.headers.get("content-type")}): ${raw.slice(0, 120)}`); return null; }
    if (json.usage) tokensUsed += json.usage.total_tokens || 0;
    try {
      const offers = JSON.parse(json.choices[0].message.content).offers;
      if (!Array.isArray(offers)) throw new Error("campo offers mancante");
      await sleep(4500); // ~15 richieste al minuto al massimo
      return offers.filter((o) => o && typeof o.name === "string" && typeof o.price === "number" && o.price > 0);
    } catch (e) { console.error(`[${chainId}] risposta GitHub Models non valida: ${e.message}`); return null; }
  }
  return null;
}

// Gemini (Google AI Studio). Sceglie il modello "Flash" più recente e stabile disponibile per la chiave.
async function resolveGeminiModel() {
  if (geminiCandidates) return geminiCandidates[0] || null;
  geminiCandidates = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } });
    const list = ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|thinking|exp|embedding)/.test(n));
    const score = (n) => (parseFloat(n.match(/gemini-([\d.]+)/)[1]) * 100) - (/preview/.test(n) ? 50 : 0) - (/lite/.test(n) ? 20 : 0) - (/-\d{3,}$/.test(n) ? 1 : 0);
    list.sort((a, b) => score(b) - score(a));
    for (const m of list) if (!geminiCandidates.includes(m)) geminiCandidates.push(m);
  } catch {}
  if (!geminiCandidates.length) geminiCandidates.push("gemini-2.5-flash");
  geminiModel = geminiCandidates[0];
  console.log(`[ai] modelli Gemini disponibili: ${geminiCandidates.join(", ")}`);
  return geminiModel;
}
// Passa al prossimo modello Gemini; se finiti, Gemini è esaurito per oggi.
function nextGeminiModel(reason) {
  const old = geminiCandidates.shift();
  geminiModel = geminiCandidates[0] || null;
  console.error(`[ai] Gemini ${old}: ${reason}${geminiModel ? ` → provo ${geminiModel}` : " → nessun altro modello, Gemini esaurito per oggi"}`);
  if (!geminiModel) exhausted.add("gemini");
  return geminiModel;
}
let geminiNoThinking = true;
async function readPageGemini(data, mediaType, chainId) {
  let model = await resolveGeminiModel();
  const cfg = () => ({ temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json", ...(geminiNoThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}) });
  let busy = 0; // 503 consecutivi sullo stesso modello
  for (let attempt = 1; attempt <= 8 && model; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [
        { inline_data: { mime_type: mediaType, data: data.toString("base64") } },
        { text: `${PROMPT}\n- unit è "kg", "l", "pz" o null. category è una di: ${CATEGORIES}.\nRispondi SOLO con JSON in questo formato:\n${GROQ_EXAMPLE}` },
      ] }], generationConfig: cfg() }),
    });
    if (res.status === 429) {
      const details = JSON.stringify(await res.json().catch(() => ({})));
      if (/PerDay|per day|limit: 0/i.test(details)) { model = nextGeminiModel(`quota giornaliera esaurita (${(details.match(/"quotaId":"([^"]+)/) || [])[1] || "?"})`); continue; }
      const delay = +(details.match(/"retryDelay":"(\d+)/)?.[1] || 20);
      await sleep(Math.min(delay, 90) * 1000); continue;
    }
    if (res.status === 503 || res.status === 500) {
      if (++busy >= 2) { busy = 0; model = nextGeminiModel(`sovraccarico (${res.status})`); continue; }
      await sleep(15000); continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 400 && geminiNoThinking && /thinking/i.test(txt)) { geminiNoThinking = false; attempt--; continue; }
      if ((res.status === 400 && /API key|API_KEY/i.test(txt)) || res.status === 403) { exhausted.add("gemini"); console.error(`[${chainId}] chiave Gemini non valida o senza permessi: ${txt.slice(0, 200)}`); return null; }
      if (res.status === 404) { model = nextGeminiModel("non disponibile (404)"); continue; }
      console.error(`[${chainId}] errore Gemini ${res.status}: ${txt.slice(0, 300)}`); return null;
    }
    busy = 0;
    const json = await res.json();
    if (json.usageMetadata) tokensUsed += json.usageMetadata.totalTokenCount || 0;
    const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    try {
      const offers = JSON.parse(text.replace(/^```(?:json)?|```$/g, "")).offers;
      if (!Array.isArray(offers)) throw new Error("campo offers mancante");
      await sleep(+(process.env.GEMINI_DELAY_MS || 6500)); // piano gratuito: ~10 richieste al minuto
      return offers.filter((o) => o && typeof o.name === "string" && typeof o.price === "number" && o.price > 0);
    } catch (e) { console.error(`[${chainId}] risposta Gemini non valida: ${e.message}`); return null; }
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
