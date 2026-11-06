// Tigros (Lombardia): volantini dalla piattaforma ebsn. L'API elenca i volantini attivi e la cartella
// delle pagine (0.png, 1.png, ...); le pagine vengono lette dall'estrattore AI.
import { extractFlyer } from "./flyer-ai.mjs";
const UA = { "User-Agent": "Mozilla/5.0" };

export async function loadTigros() {
  const res = await fetch("https://www.tigros.it/ebsn/api/leaflet/search?parent_leaflet_type_id=1", { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const today = new Date().toISOString().slice(0, 10);
  const leaflets = (await res.json()).data.leaflets.filter((l) => l.baseLocation && l.fromDate.slice(0, 10) <= today && l.toDate.slice(0, 10) >= today);
  const out = [];
  for (const l of leaflets) {
    const pages = [];
    for (let n = 0; n < 80; n++) {
      const url = `${l.baseLocation}${n}.png`;
      const r = await fetch(url, { headers: UA });
      if (!r.ok) break;
      pages.push({ url, data: Buffer.from(await r.arrayBuffer()), mediaType: "image/png" });
    }
    console.log(`[tigros] "${l.title}": ${pages.length} pagine`);
    // l'ultimo giorno di validità è toDate - 1 (toDate è la mezzanotte di fine)
    const until = new Date(new Date(l.toDate.slice(0, 10) + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    out.push(...(await extractFlyer("tigros", pages, { validUntil: until, sourceUrl: `https://www.tigros.it/volantini/${l.leafletId}` })));
  }
  return out;
}
