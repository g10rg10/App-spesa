// Classificatore AI: assegna ogni offerta di volantino a un prodotto del catalogo (o a nessuno).
// Usato insieme alle regole del catalogo (vedi pickBest in scrape.mjs). Più affidabile delle sole regole a parole chiave ("Stollen con burro" non è burro, "Negroamaro del Salento" non è sale).
// Risultati in cache in data/match-cache.json: ogni offerta si classifica una volta sola.
import { readFile, writeFile } from "node:fs/promises";

const CACHE = new URL("../data/match-cache.json", import.meta.url);
const MODEL = process.env.MATCH_MODEL || "openai/gpt-oss-120b";
const BATCH = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || "").replace(/\s+/g, " ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
export const offerKey = (o) => norm(`${o.title} | ${o.pack}`);

let cache = null;
async function load() { if (!cache) { try { cache = JSON.parse(await readFile(CACHE)); } catch { cache = {}; } } return cache; }

/** Ritorna Map(offerKey -> productId | null). Le offerte non classificabili (senza chiave e non in cache) non compaiono. */
export async function classify(offers, catalog) {
  const c = await load();
  const ids = catalog.products.map((p) => p.id);
  const todo = [...new Map(offers.map((o) => [offerKey(o), o])).entries()].filter(([k]) => !(k in c));
  if (todo.length && process.env.GROQ_API_KEY) {
    const list = catalog.products.map((p) => `${p.id}: ${p.name} (${p.aliases.join(", ")})`).join("\n");
    let done = 0;
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const res = await ask(list, ids, chunk.map(([, o], j) => `${j}. ${o.title} — ${o.pack}${o.category ? ` [${o.category}]` : ""}`).join("\n"));
      if (!res) continue; // blocco fallito: riprova al prossimo giro, intanto valgono le regole
      for (const r of res) if (chunk[r.i]) c[chunk[r.i][0]] = ids.includes(r.product) ? r.product : null;
      done += chunk.length;
      await writeFile(CACHE, JSON.stringify(c));
    }
    console.log(`[classifica] ${done} offerte nuove classificate con ${MODEL}`);
  }
  return new Map(offers.map((o) => [offerKey(o), c[offerKey(o)]]).filter(([, v]) => v !== undefined));
}

async function ask(list, ids, items) {
  const schema = {
    type: "object", additionalProperties: false, required: ["items"],
    properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "product"],
      properties: { i: { type: "integer" }, product: { type: "string", enum: [...ids, "nessuno"] } } } } },
  };
  const prompt = `Hai un catalogo di prodotti base della spesa:
${list}

Per ogni offerta di volantino qui sotto, indica a quale prodotto del catalogo corrisponde, oppure "nessuno".
Regole:
- L'offerta deve ESSERE quel prodotto, non contenerlo come ingrediente o gusto ("Stollen con burro" non è burro, "Chips al gusto pomodoro" non è pomodori, "Torrone" non è tè).
- Prodotti per animali solo in cibo-cani / cibo-gatti; oggetti, decorazioni ed elettrodomestici sono "nessuno".
- Varianti dello stesso prodotto vanno bene (latte UHT intero = latte-intero, penne/fusilli = penne, fusi di pollo = pollo).
- Nel dubbio rispondi "nessuno".

Offerte:
${items}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_schema", json_schema: { name: "abbinamenti", strict: true, schema } } }),
    });
    if (res.status === 429) {
      const wait = (+res.headers.get("retry-after") || 20) * 1000;
      if (wait > 120000 || /per day/i.test(await res.clone().text())) { console.error("[classifica] limite giornaliero Groq raggiunto"); return null; }
      await sleep(wait); continue;
    }
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 400 && body.includes("json_validate_failed") && attempt < 4) { await sleep(2000); continue; } // capita: si riprova
      console.error(`[classifica] errore Groq ${res.status}: ${body.slice(0, 200)}`); return null;
    }
    try { return JSON.parse((await res.json()).choices[0].message.content).items; }
    catch (e) { console.error(`[classifica] risposta non valida: ${e.message}`); return null; }
  }
  return null;
}
