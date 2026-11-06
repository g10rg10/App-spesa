// Unisce i dati del giro con quelli già sul repo, invece di sovrascriverli.
// Serve quando due giri si sono sovrapposti o il ramo è cambiato durante un giro lungo:
// la cache AI e quella delle classificazioni sono "solo aggiunte", lo storico prezzi si unisce per data.
// Uso: node scraper/merge-data.mjs <cartella-con-le-versioni-remote> [altre cartelle...]
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const DATA = new URL("../data/", import.meta.url);
const read = async (p) => { try { return JSON.parse(await readFile(p)); } catch { return null; } };

const dirs = process.argv.slice(2);
for (const name of ["ai-cache.json", "match-cache.json"]) {
  const local = (await read(new URL(name, DATA))) || {};
  let added = 0;
  for (const d of dirs) {
    const remote = existsSync(`${d}/${name}`) ? await read(`${d}/${name}`) : null;
    for (const [k, v] of Object.entries(remote || {})) if (!(k in local)) { local[k] = v; added++; }
  }
  await writeFile(new URL(name, DATA), JSON.stringify(local));
  console.log(`${name}: +${added} voci recuperate, totale ${Object.keys(local).length}`);
}
// history.json: { prodotto: { catena: [[data, prezzo, ppu, promo], ...] } } — unione per data
const hist = (await read(new URL("history.json", DATA))) || {};
for (const d of dirs) {
  const remote = existsSync(`${d}/history.json`) ? await read(`${d}/history.json`) : null;
  for (const [p, chains] of Object.entries(remote || {})) for (const [c, rows] of Object.entries(chains)) {
    const mine = ((hist[p] ||= {})[c] ||= []);
    for (const r of rows) if (!mine.some((m) => m[0] === r[0])) mine.push(r);
    mine.sort((a, b) => a[0].localeCompare(b[0]));
  }
}
await writeFile(new URL("history.json", DATA), JSON.stringify(hist));
