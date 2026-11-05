# Spesa Smart (prototipo)

Cerchi un prodotto per nome ("chilli verde") e vedi in quali catene costa meno, al kg o al litro, con storico e alert.

## Cosa c'è

| Cartella | Cosa fa | Stato |
|---|---|---|
| `app/` | PWA mobile: ricerca, confronto prezzi, negozio più vicino, promo con scadenza, "non trovato da X", grafico storico 30/90 giorni, alert sotto soglia | ✅ funziona su **dati demo** |
| `scraper/` | Script giornaliero con un adapter per catena + catalogo prodotti con regole di abbinamento | ⚠️ struttura pronta, nessuna fonte attiva |
| `.github/workflows/scrape.yml` | Lancia lo scraper e salva i dati in `data/` | ⏸ solo manuale, schedule commentato |

**Provarla:** apri `app/index.html` nel browser. Per usarla dal telefono attiva GitHub Pages sul repo (Settings → Pages → branch `master`) e apri `…/app/`.

## Test sulle fonti dati (5 nov 2026)

| Catena | Esito |
|---|---|
| Lidl | API di ricerca con prezzo, €/kg e promo con date. **Dopo poche richieste risponde 401**: blocca l'accesso automatico |
| Coop (coopshop.it) | API aperta, ma **senza negozio selezionato non restituisce prezzi** |
| Conad, Carrefour | Bloccano le richieste automatiche (403) |
| Esselunga | Prezzi online solo dopo login/CAP |

Conclusione: lo scraping diretto dei siti delle catene non è una base solida. I siti si difendono, i termini d'uso lo vietano e in UE esiste un diritto specifico sui database. Aggirare i blocchi non è una strada da prendere.

## Strade realistiche per i dati

1. **Volantini (PDF/immagini) + AI.** Le promo sono pubbliche e pensate per essere diffuse. Un modello estrae prodotto, prezzo e scadenza. Copre le offerte, non tutto l'assortimento.
2. **Crowdsourcing.** Gli utenti fotografano lo scontrino o il cartellino e l'AI lo legge. È il modello di app come Open Food Facts / Open Prices (open data, si può riusare).
3. **Accordi.** Chiedere un feed alle catene più piccole o ai discount locali, che hanno interesse a farsi trovare.
4. **Fornitori di dati** già esistenti (a pagamento).

Le opzioni 1 e 2 sono fattibili da soli e senza rischi legali.

## Prossimo passo
Mostrare il prototipo a 5 persone e chiedere: *"Lo useresti prima di fare la spesa? Quanto spesso?"*. Se la risposta è sì, si investe sulla fonte dati 1 o 2.
