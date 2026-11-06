// volantinoggi.it (PromoMedia): pubblica i volantini di decine di insegne italiane.
// L'API pubblica restituisce i volantini attivi vicino a una posizione; le pagine sono immagini
// numerate (0.webp, 1.webp, ...). Un solo adapter copre molte catene: per ognuna scegliamo il volantino
// della città di riferimento (default Milano; le altre città servono per le catene assenti lì).
import { extractFlyer } from "./flyer-ai.mjs";
const UA = { "User-Agent": "Mozilla/5.0" };
const API = "https://volantinoggi.promomediaeng.it/api";
const CITIES = [
  [+(process.env.REF_LAT || 45.4642), +(process.env.REF_LON || 9.19)], // città di riferimento (Milano)
  [45.07, 7.68], [44.49, 11.34], [44.41, 8.95], [45.44, 10.99], [41.9, 12.5], [40.85, 14.27], [41.12, 16.87], [38.12, 13.36], [39.22, 9.12],
];
const MAX_FLYERS = +(process.env.VO_MAX_FLYERS || 1); // volantini per catena: 1 = solo il principale (il budget AI gratuito è limitato)

// Catene lette da qui, in ordine di priorità (punti vendita in Italia). `match` si applica al nome del volantino.
export const VO_CHAINS = [
  { id: "conad", name: "Conad", match: /^(conad|conad city|conad superstore|spazio conad|margherita conad)\b/i, prefer: /^conad$/i },
  { id: "coop", name: "Coop", match: /^(coop|ipercoop|incoop)\b/i },
  { id: "despar", name: "Despar", match: /^(despar|eurospar|interspar)\b/i, prefer: /^despar$/i },
  { id: "crai", name: "Crai", match: /^(crai|cuor di crai|crai extra)\b/i, prefer: /^crai$/i },
  { id: "todis", name: "Todis", match: /^todis\b/i },
  { id: "famila", name: "Famila", match: /^(famila|iper famila)\b/i, prefer: /^famila$/i },
  { id: "sisa", name: "Sisa", match: /^(sisa|quick sisa)\b/i, prefer: /^sisa$/i },
  { id: "ao", name: "A&O", match: /^a&o\b/i },
  { id: "bennet", name: "Bennet", match: /^bennet\b/i },
  { id: "iperal", name: "Iperal", match: /^iperal\b/i },
  { id: "ali", name: "Alì", match: /^ali'?\b/i },
  { id: "galassia", name: "Galassia", match: /^galassia\b/i },
  { id: "gulliver", name: "Gulliver", match: /gulliver/i },
  { id: "pewex", name: "Pewex", match: /^pewex\b/i },
  { id: "pim", name: "Pim", match: /\bpim\b/i },
  { id: "coal", name: "Coal", match: /^coal\b/i },
  { id: "emi", name: "Emi", match: /^emi\b/i },
  { id: "prestofresco", name: "Prestofresco", match: /^prestofresco\b/i },
  { id: "sidis", name: "Sidis", match: /sidis/i },
  { id: "piccolo", name: "Piccolo", match: /piccolo/i },
];

let flyersCache = null;
async function allFlyers() {
  if (flyersCache) return flyersCache;
  const today = new Date().toISOString().slice(0, 10);
  flyersCache = [];
  for (const [i, [lat, lon]] of CITIES.entries()) {
    try {
      const r = await fetch(`${API}/flyers/${lat}/${lon}/50/0/0`, { headers: UA });
      if (!r.ok) continue;
      for (const f of await r.json()) {
        if (f.isAdv || !f.isPublished || f.startDate > today || f.dueDate < today) continue;
        flyersCache.push({ ...f, cityRank: i });
      }
    } catch {}
  }
  return flyersCache;
}

async function pages(id) {
  const out = [];
  for (let n = 0; n < 80; n++) {
    const url = `${API}/Resources/Flyers/${id}/${n}.webp`;
    const r = await fetch(url, { headers: UA });
    if (!r.ok) break;
    out.push({ url, data: Buffer.from(await r.arrayBuffer()), mediaType: "image/webp" });
  }
  return out;
}

export function voChain(chain) {
  return async function load() {
    const fl = (await allFlyers()).filter((f) => chain.match.test(f.name.trim()));
    if (!fl.length) return [];
    const bestCity = Math.min(...fl.map((f) => f.cityRank));
    const pick = fl.filter((f) => f.cityRank === bestCity)
      .sort((a, b) => (chain.prefer && chain.prefer.test(b.name.trim())) - (chain.prefer && chain.prefer.test(a.name.trim())) || b.startDate.localeCompare(a.startDate))
      .filter((f, i, arr) => arr.findIndex((g) => g.name.trim() === f.name.trim()) === i)
      .slice(0, MAX_FLYERS);
    const out = [];
    for (const f of pick) {
      const pg = await pages(f.id);
      if (!pg.length) continue;
      console.log(`[${chain.id}] "${f.name.trim()}" (${pg.length} pagine, fino al ${f.dueDate}${bestCity ? ", fuori dalla città di riferimento" : ""})`);
      out.push(...(await extractFlyer(chain.id, pg, { validUntil: f.dueDate, sourceUrl: `https://volantinoggi.it/fr/${f.id}` })));
    }
    return out;
  };
}
