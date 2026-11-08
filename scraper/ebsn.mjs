// Catene sulla piattaforma ebsn (Digitelematica): Tigros, Basko, ...
// L'API pubblica elenca i volantini attivi; le pagine sono immagini numerate (0, 1, 2, ...)
// o direttamente sul sito (baseLocation) o sul visualizzatore esterno volantinoggi.it.
// Le pagine vengono lette dall'estrattore AI.
import { extractFlyer } from "./flyer-ai.mjs";
const UA = { "User-Agent": "Mozilla/5.0" };

async function pagesFrom(prefix, ext) {
  const pages = [];
  for (let n = 0; n < 80; n++) {
    const url = `${prefix}${n}.${ext}`;
    const r = await fetch(url, { headers: UA });
    if (!r.ok) break;
    pages.push({ url, data: Buffer.from(await r.arrayBuffer()), mediaType: ext === "webp" ? "image/webp" : "image/png" });
  }
  return pages;
}

export function ebsnChain(chainId, host, { types = [1, 2], skip = /enoteca|vini|genova|spezia|piacentino|pavese|liguria/i } = {}) {
  return async function load() {
    const today = new Date().toISOString().slice(0, 10);
    const leaflets = [];
    for (const t of types) {
      const res = await fetch(`https://${host}/ebsn/api/leaflet/search?parent_leaflet_type_id=${t}`, { headers: UA });
      if (res.ok) leaflets.push(...((await res.json()).data?.leaflets || []));
    }
    const active = leaflets.filter((l) => l.fromDate.slice(0, 10) <= today && l.toDate.slice(0, 10) >= today && !skip.test(l.title || ""));
    const out = [];
    for (const l of active) {
      let pages = [];
      const vo = (l.externalLink || "").match(/volantinoggi\.it\/fr\/(\d+)/);
      if (l.baseLocation) pages = await pagesFrom(l.baseLocation, "png");
      else if (vo) pages = await pagesFrom(`https://volantinoggi.promomediaeng.it/api/Resources/Flyers/${vo[1]}/`, "webp");
      if (!pages.length) continue;
      console.log(`[${chainId}] "${l.title}": ${pages.length} pagine`);
      // toDate di Tigros è la mezzanotte di fine (ultimo giorno = toDate - 1); per Basko è già l'ultimo giorno
      const until = l.toDate.length > 10 ? new Date(new Date(l.toDate.slice(0, 10) + "T00:00:00Z") - 86400000).toISOString().slice(0, 10) : l.toDate;
      out.push(...(await extractFlyer(chainId, pages, { validUntil: until, sourceUrl: `https://${host}/` })));
    }
    return out;
  };
}
