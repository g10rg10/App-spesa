// MD: il volantino è un PDF per zona (nord, sud, sardegna, con varianti per reparto).
// Lo scarichiamo, lo convertiamo in immagini (pdftoppm, pacchetto poppler-utils) e lo passiamo all'estrattore AI.
// Zona predefinita: Nord con macelleria e gastronomia; si cambia con MD_ZONA.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { extractFlyer } from "./flyer-ai.mjs";
const run = promisify(execFile);
const UA = { "User-Agent": "Mozilla/5.0" };
const ZONA = process.env.MD_ZONA || "nord-macel-gastro";
const STORE_FOR_DATES = 50; // un negozio della zona, solo per leggere le date di validità
const MONTHS = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

export async function loadMd() {
  // Date di validità, es. "Dal 3 al 15 Novembre 2026"
  let validUntil = null;
  try {
    const r = await fetch("https://www.mdspa.it/punti_vendita_admin/get_pv.php", { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: `pv=${STORE_FOR_DATES}` });
    const m = (await r.json()).pv?.breve_zona?.toLowerCase().match(/al (\d{1,2}) ([a-z]+) (\d{4})/);
    if (m && MONTHS[m[2]]) validUntil = `${m[3]}-${String(MONTHS[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  } catch {}
  const pdfUrl = `https://www.mdspa.it/cdn/upload/presente/volantini/${ZONA}/volantino.pdf`;
  const res = await fetch(pdfUrl, { headers: UA });
  if (!res.ok) throw new Error(`PDF non disponibile (${res.status})`);
  const dir = await mkdtemp(join(tmpdir(), "md-"));
  try {
    await writeFile(join(dir, "v.pdf"), Buffer.from(await res.arrayBuffer()));
    await run("pdftoppm", ["-jpeg", "-jpegopt", "quality=85", "-r", "130", join(dir, "v.pdf"), join(dir, "p")]);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    const pages = await Promise.all(files.map(async (f) => ({ url: `${pdfUrl}#${f}`, data: await readFile(join(dir, f)), mediaType: "image/jpeg" })));
    console.log(`[md] volantino ${ZONA}: ${pages.length} pagine`);
    return await extractFlyer("md", pages, { validUntil, sourceUrl: "https://www.mdspa.it/volantino/" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
