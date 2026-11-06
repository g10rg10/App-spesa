# Spesa Smart (prototipo)

Cerchi un prodotto per nome ("chilli verde") e vedi in quali catene costa meno, al kg o al litro, con storico e alert.

## Cosa c'è

| Cartella | Cosa fa | Stato |
|---|---|---|
| `app/` | PWA mobile: ricerca, confronto prezzi, promo con scadenza, "non trovato da X", grafico storico, alert sotto soglia, ricerca libera nei volantini | ✅ usa i **dati reali** di `data/` se ci sono, altrimenti la demo (`?demo` per forzarla) |
| `scraper/` | Un adapter per catena + catalogo prodotti con regole di abbinamento (`catalog.json`) | ✅ Eurospin e Penny attivi (volantino) |
| `.github/workflows/scrape.yml` | Ogni notte alle 04:17 UTC aggiorna `data/latest.json` e aggiunge una riga a `data/history.json` | ✅ attivo |

**Online:** https://app-spesa-nu.vercel.app (si aggiorna da solo a ogni push e a ogni aggiornamento notturno dei prezzi).

**In locale:** `python3 -m http.server` nella cartella del repo, poi apri `localhost:8000/app/`. Aprendo il file direttamente vedi solo la demo. Per usarla dal telefono attiva GitHub Pages sul repo (Settings → Pages → branch `master`) e apri `…/app/`.

## Catene coperte

Elenco completo delle insegne italiane (162, raggruppate in ~80 catene alimentari) in `scraper/insegne.json`
(fonte: QBerg, Grande Distribuzione Italia 2025). Nell'app: pagina **Catene** (link in fondo alla home).

| Fonte | Catene | Metodo |
|---|---|---|
| volantino digitale Eurospin | Eurospin | dati strutturati |
| penny.it | Penny | pagine HTML |
| Publitas | Aldi | immagini → AI |
| PDF per zona | MD (`MD_ZONA`) | PDF → immagini → AI |
| youroperator | Carrefour (`CARREFOUR_STORE_URL`) | immagini → AI |
| ebsn | Tigros, Basko | immagini → AI |
| **volantinoggi.it** | Conad, Coop, Despar/Eurospar/Interspar, Crai, Todis, Famila, Sisa, A&O, Bennet, Iperal, Alì, Galassia, Gulliver, Pewex, Pim, Coal, Emi, Prestofresco, Sidis, Piccolo | immagini → AI |
| bloccate | Lidl (401), Esselunga (login) | — |

Città di riferimento per i volantini regionali: Milano (`REF_LAT`, `REF_LON`).
La lettura AI segue la priorità per numero di punti vendita (`PRIORITY` in `scrape.mjs`): con il piano gratuito di Groq
(~200.000 token/giorno) le catene si completano in più giri grazie alla cache.

## Strade realistiche per i dati

1. **Volantini (PDF/immagini) + AI.** Le promo sono pubbliche e pensate per essere diffuse. Un modello estrae prodotto, prezzo e scadenza. Copre le offerte, non tutto l'assortimento.
2. **Crowdsourcing.** Gli utenti fotografano lo scontrino o il cartellino e l'AI lo legge. È il modello di app come Open Food Facts / Open Prices (open data, si può riusare).
3. **Accordi.** Chiedere un feed alle catene più piccole o ai discount locali, che hanno interesse a farsi trovare.
4. **Fornitori di dati** già esistenti (a pagamento).

Le opzioni 1 e 2 sono fattibili da soli. Eurospin è già l'opzione 1, senza nemmeno bisogno dell'AI.

## Aggiungere una catena
1. In `scraper/` scrivi un modulo che restituisce `[{ title, pack, price, ppu, unit, promo, url }]` (vedi `eurospin.mjs`).
2. Registralo in `ADAPTERS` dentro `scrape.mjs`.
3. Esegui `node scraper/scrape.mjs` e controlla gli abbinamenti in `data/latest.json`. Se un prodotto finisce nel posto sbagliato, correggi `must`/`exclude` in `catalog.json`.

## Limiti attuali
- Due discount: il confronto c'è solo per i prodotti in offerta in entrambi (es. olio EVO, spaghetti).
- Eurospin e Penny = solo prodotti **in volantino**. "Non trovato" significa "non in offerta questa settimana", non "non venduto".
- Lo storico parte dal 5/11/2026 e cresce di un punto al giorno.
- Alert: controllati quando apri l'app. Le notifiche push richiedono un piccolo backend.
- Negozio più vicino: in modalità reale apre Google Maps (manca l'elenco dei punti vendita).

## Prossimo passo
Mostrare il prototipo a 5 persone e chiedere: *"Lo useresti prima di fare la spesa? Quanto spesso?"*. Se la risposta è sì, si investe sulla fonte dati 1 o 2.

## Volantini a immagini (AI)
`scraper/flyer-ai.mjs` legge le pagine dei volantini pubblicati come immagini (es. Aldi) con un modello con visione.
- **Groq** (predefinito se c'è `GROQ_API_KEY`): piano gratuito, modello `meta-llama/llama-4-scout-17b-16e-instruct`.
- **Claude** (se c'è `ANTHROPIC_API_KEY`): più preciso, a pagamento.
- Ogni pagina viene letta una volta sola e salvata in `data/ai-cache.json`.
- Variabili opzionali (GitHub → Settings → Secrets and variables → Actions → Variables): `FLYER_MODEL`, `FLYER_PROVIDER`.
