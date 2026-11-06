# Spesa Smart · handoff di design per Claude Code

Questo pacchetto contiene il nuovo design di Spesa Smart (PWA statica in `app/`, HTML + CSS + JS senza framework, dati in `data/latest.json`). Va implementato nell'app esistente senza cambiare stack.

## Prompt da incollare in Claude Code

> Leggi `design-handoff/HANDOFF.md` per intero, poi apri `design-handoff/reference/index.html` (è il markup di riferimento) e `design-handoff/js/format.js`. Studia il codice esistente in `app/` e la struttura reale di `data/latest.json` prima di scrivere codice. Implementa il redesign seguendo l'ordine di lavoro della sezione 9, un passo alla volta, con un commit per passo. Non introdurre framework né dipendenze. Alla fine di ogni passo verifica a 390×844 in chiaro e in scuro e riporta cosa hai cambiato e cosa resta aperto.

## 1. Contenuto del pacchetto

| Percorso | Cosa contiene |
|---|---|
| `HANDOFF.md` | Queste istruzioni: struttura, regole, logica, criteri di accettazione |
| `css/tokens.css` | Colori, font, raggi, spazi. Chiaro di default, scuro da sistema, forzabile con `data-theme` |
| `css/components.css` | Tutti i componenti come classi CSS, mobile first |
| `reference/index.html` | Markup di riferimento di ogni schermata e stato, aprirlo nel browser (usa i due CSS sopra) |
| `js/format.js` | Formati (prezzi, unità, date), sconto, risparmio in % e in euro, affidabilità dei confronti, normalizzazione dei volantini, verdetto della lista |
| `js/format.test.mjs` | 28 test, `node js/format.test.mjs` |
| `mockups/*.dc.html` | Sorgenti delle tavole di design (solo consultazione, non vanno nell'app) |

Copiare `tokens.css` e `components.css` in `app/` e caricarli prima di ogni altro CSS. Il vecchio CSS va rimosso man mano che le schermate migrano, senza lasciare regole morte.

## 2. Architettura dell'informazione

Barra in basso con tre schede, in quest'ordine:

1. **Cerca** (home). Campo di ricerca in cima, ricerche recenti, banner se qualcosa nella lista è sceso, «Sfoglia per categoria», riga di copertura.
2. **Offerte**. Tutte le offerte dei volantini, raggruppate per fascia di sconto.
3. **La mia lista**. Solo i prodotti scelti dall'utente con la stella. In cima il verdetto «Dove costa meno questa settimana» calcolato solo su quei prodotti, poi i prodotti raggruppati per catena più conveniente.

Pagina di dettaglio: **Scheda prodotto** (da Cerca, categoria, lista).

Rimossi rispetto alla versione precedente: la scheda Catalogo (diventa «Sfoglia per categoria» dentro Cerca), il blocco «Dove risparmi di più» e «Sconti più forti» in home, l'interruttore «solo confronti affidabili». Niente liste di prodotti decise dall'app: decide l'utente.

## 3. Regole non negoziabili

1. **Prima il verdetto.** Ogni pagina apre con la risposta: prezzo migliore, catena migliore, cosa è cambiato.
2. **Il numero grande è sempre il prezzo per unità** (€/kg, €/l, €/pz). Il prezzo della confezione è secondario.
3. **Un'informazione compare una volta sola.** Niente nome catena accanto al logo nelle righe offerta (il logo ha `aria-label`), niente pillola «il più conveniente» nella lista prezzi (lo dice il riquadro sopra), niente validità ripetuta in frase.
4. **Confronti non affidabili non si mostrano.** Si scartano nei dati con `isReliableComparison`. Nessun filtro per l'utente.
5. **Onestà sui dati, in breve.** Orario di aggiornamento con icona orologio («oggi 07:30»). «Non in offerta questa settimana», mai «non disponibile». Catene non coperte dichiarate in una riga, non nascoste.
6. **Pollice.** Le azioni principali stanno nel dock fisso in basso (sopra la barra). Bersagli di almeno 44×44 px.
7. **Abbreviazioni e icone al posto delle frasi:** `€/kg`, `€/l`, `€/pz`, `3×60 g`, `960 g`, `al 15/11` con icona calendario, carta fedeltà con icona carta, risparmio con freccia giù verde.
8. **Niente etichette di servizio dentro l'interfaccia** (per esempio «chiaro», «scuro», nomi interni).

## 4. Colore

Quattro ruoli, ciascuno con un solo significato. Non introdurre altri colori.

| Ruolo | Token | Uso ammesso |
|---|---|---|
| Neutri | `--bg --surface --sunk --line --ink --muted` | Tutta la struttura |
| Verde | `--brand --onbrand --soft --hero` | Azioni primarie, risparmio, scheda attiva, fondo del verdetto |
| Giallo cartellino | `--tag --ontag` | Logo, etichetta del verdetto, avviso scattato, riga di un prodotto sceso |
| Rosso | `--sale --onsale` | Solo il badge sconto del volantino (`−50%`) |

La selezione di filtri e chip è in nero (`--ink`), non in verde. Tutte le coppie passano WCAG AA in entrambi i temi; i rapporti sono nei commenti di `tokens.css`.

Font: Bricolage Grotesque (titoli e prezzi, 800) e Figtree (testo). Cifre tabellari sui prezzi (`.num` o `font-variant-numeric: tabular-nums`). Testo mai sotto 12 px; campi di input a 16 px o più per evitare lo zoom su iOS.

## 5. Schermate

Il markup esatto è in `reference/index.html`. Qui l'ordine dei contenuti e le regole di comportamento.

### 5.1 Cerca (home)
1. Topbar: logo giallo + «spesa smart», a destra orario aggiornamento (apre il foglio «Da dove vengono i prezzi»).
2. Titolo «Cosa ti serve?» e campo di ricerca grande (`.search-hero`), `type="search"`, `enterkeyhint="search"`.
3. Ricerche recenti: ultime 3 a 5, salvate in localStorage, con icona cronologia.
4. Banner giallo (`.alert`) solo se almeno un prodotto della lista è sceso dall'ultima visita o ha raggiunto la soglia. Porta a La mia lista.
5. «Sfoglia per categoria»: griglia 2 colonne delle 10 categorie con il numero di prodotti in offerta.
6. Riga copertura: loghi delle catene coperte + «Copertura» (foglio con catene in arrivo e non coperte).

Risultati di ricerca, due gruppi:
1. **Confronta i prezzi**: prodotti del catalogo con confronto affidabile. Card verde con nome, catena migliore, €/unità su etichetta gialla e stella per aggiungerlo alla lista.
2. **Nei volantini**: singole offerte che contengono la parola (riga `.offer`).
Nessun risultato: titolo «Niente per «parola»», «Non è in offerta questa settimana», 3 suggerimenti.

### 5.2 Scheda prodotto
1. Barra indietro + condividi. Titolo, sotto «categoria · N catene».
2. **Verdetto** (`.verdict`): etichetta gialla PIÙ CONVENIENTE, catena, prezzo per unità grande, nastro giallo «38% in meno di [catena più cara]», riga «2,66 € risparmiati su 4 scatolette» (`savingEuro`), prova (marca · formato · prezzo confezione) con validità, pulsante «Negozio più vicino».
3. **Prezzi al kg**: una riga per catena (`.chainprice`) ordinata dal più conveniente. Barra proporzionale al prezzo (`width = prezzo / prezzo massimo`), verde per il migliore, grigia per gli altri. `+36%` sotto il prezzo per gli altri. Badge sconto e carta fedeltà solo se presenti.
4. Una riga con icona info sulle catene non coperte.
5. **Andamento**: grafico a linee 30/90 giorni. Finché lo storico ha meno di 7 giorni mostrare lo stato «Storico in costruzione» (vedi 7).
6. Dock: «Aggiungi alla mia lista» con stella. Se il prodotto è già in lista: «Nella tua lista» con stella piena e pulsante secondario per la soglia.

### 5.3 La mia lista
1. Titolo + numero di prodotti.
2. **Verdetto** «Dove costa meno questa settimana»: catena vincente grande, frase «Il più conveniente per X dei tuoi Y prodotti in offerta», barra di ripartizione per catena (`.split`, vincente in giallo), legenda con i conteggi. Dati da `listVerdict`.
3. Gruppi per catena (`Da Aldi · 3 prodotti`), ordinati come `listVerdict.byChain`. Ogni riga: nome, formato e prezzo confezione, €/unità, badge sconto se c'è, stella piena per togliere. Riga gialla (`.row--hot`) se il prezzo è sceso dall'aggiunta o sotto la soglia, con riga «sceso da 7,43» o «sotto la tua soglia di 9,00».
4. «Non in offerta questa settimana»: righe tratteggiate (`.missing`), «Ti avvisiamo quando torna».
5. Dock: «Aggiungi un prodotto» (porta a Cerca con il campo a fuoco).

### 5.4 Offerte
1. Titolo + orario aggiornamento.
2. Chip catena con conteggi (Tutte, Aldi, Eurospin, Penny), selezione in nero.
3. Gruppi per fascia di sconto quando l'ordinamento è «sconto più alto»: «Oltre il 40%», «Dal 25% al 40%», «Fino al 25%», poi «Senza sconto» chiuso. Ogni gruppo mostra 3 righe e «Altre N»; caricare a blocchi per non rendere 700 righe insieme.
4. Riga offerta: logo, nome normalizzato, `formato · prezzo` + barrato, validità con icona, carta fedeltà con icona; a destra badge sconto e €/unità.
5. Dock: campo «Cerca nelle offerte» + pulsante filtri (foglio con catena, categoria, ordinamento: sconto più alto, €/unità più basso, prezzo più basso).

## 6. Logica dati (`js/format.js`)

Adattare i nomi dei campi a `data/latest.json`; la logica resta questa.

| Funzione | Regola |
|---|---|
| `unitPrice`, `euro`, `pack`, `validUntil`, `updatedAt` | Formati brevi in italiano, vedi test |
| `discountLabel(price, was)` | `−33%` con segno meno tipografico |
| `savingPct(best, worst)` | Risparmio della migliore sulla più cara |
| `diffLabel(price, best)` | `+36%`, vuoto per la migliore |
| `savingEuro(...)` | Confezioni della migliore fino ad almeno 500 g o 500 ml, risparmio rispetto alla più cara su quella quantità. Null per i prodotti a pezzi |
| `isReliableComparison(offers)` | Stessa unità, stessa classe di qualità (DOC, bio, light, integrale, extravergine), formati entro 8×, risparmio non oltre 60%. Se falso il prodotto non entra in «Confronta i prezzi» né nel verdetto della lista |
| `sentenceCase`, `normalizeCategory` | Nomi da MAIUSCOLO a frase (sigle come DOP e UHT restano), categorie delle catene mappate alle 10 del catalogo. Categoria sconosciuta: loggare e aggiungere alla mappa |
| `listVerdict(items)` | Per ogni prodotto in lista prende la catena con il €/unità più basso; vince la catena con più prodotti, a parità quella con la somma €/unità più bassa |

Le soglie di `isReliableComparison` sono un punto di partenza: verificarle sui dati reali e regolarle.

## 7. Stati vuoti ed errori

| Stato | Dove | Contenuto |
|---|---|---|
| Nessun risultato | Cerca | «Niente per «parola»» + «Non è in offerta questa settimana» + 3 suggerimenti |
| Prodotto senza offerte | Scheda, lista | «Non in offerta questa settimana» + prossimo controllo + stella o avviso |
| Catena non coperta | Copertura, filtri | «Lidl non è disponibile: il sito non permette di leggere il volantino» + catene disponibili |
| Storico corto | Scheda | «Storico in costruzione», 7 segmenti, «Dall'11/11 vedrai se il prezzo di oggi è davvero basso» |
| Lista vuota | La mia lista | Stella gialla, «La tua lista è vuota», spiegazione in una frase, «Cerca un prodotto» |
| Dati vecchi o offline | Tutte | Riga con orologio «Prezzi di ieri 13:30 · offline» + Riprova |
| Errore di caricamento | Tutte | «Prezzi non disponibili», «I tuoi avvisi restano salvati», Riprova |

## 8. Flussi

**Aggiungi alla lista.** Stella (risultati, scheda). Al tocco: stella piena, poi foglio «[Prodotto] è nella tua lista. Vuoi un avviso quando scende sotto un prezzo?» con stepper (valore iniziale: prezzo migliore attuale arrotondato in basso di circa il 5%), «Avvisami», «Non serve». Togliere dalla lista: stella piena, con annullamento per 5 secondi.

**Avvisi.** Salvati in localStorage: `{ productId, addedAt, priceAtAdd, threshold | null }`. Ad ogni caricamento dei dati confrontare con i prezzi attuali: se `prezzo < priceAtAdd` o `prezzo <= threshold` la riga diventa gialla e compare il banner in home. Notifiche push facoltative con interruttore nel foglio; su iPhone funzionano solo con l'app aggiunta alla schermata Home (iOS 16.4+), dirlo in una riga. Senza notifiche il banner in home basta.

**Posizione.** Mai all'avvio. Solo al tocco su «Negozio più vicino»: foglio con «Usa la posizione» (poi il prompt di sistema) e «Scrivi il CAP». Se il permesso è negato, campo CAP. Non salvare la posizione.

**Tema.** Segue il sistema. Se si aggiunge un'impostazione manuale, salvarla in localStorage con try/catch e applicarla con `data-theme` su `<html>` prima del primo paint.

## 9. Ordine di lavoro

1. Inserire `tokens.css` e `components.css`, font, `format.js` con i test. Nessun cambiamento visibile oltre a colori e font.
2. Nuova barra di navigazione (Cerca, Offerte, La mia lista) e dock fisso. Rimuovere la scheda Catalogo.
3. Home Cerca e risultati di ricerca, con `isReliableComparison` applicato.
4. Scheda prodotto con verdetto, lista prezzi a barre, stato storico.
5. Stella, archiviazione della lista, La mia lista con `listVerdict`, stato lista vuota.
6. Avvisi: soglia, riga gialla, banner in home, notifiche facoltative.
7. Offerte con gruppi per sconto, caricamento a blocchi, foglio filtri.
8. Posizione e negozio più vicino.
9. Stati vuoti ed errori rimanenti, pulizia del CSS vecchio.

## 10. Criteri di accettazione

- A 390×844 ogni schermata mostra il verdetto senza scorrere.
- Nessun testo sotto 12 px; nessun bersaglio sotto 44 px; input a 16 px o più.
- Contrasto AA in chiaro e in scuro, anche per chip selezionati, badge e riga gialla.
- Rosso usato solo nei badge sconto; giallo solo per logo, verdetto e avvisi.
- Nessun confronto non affidabile visibile in Cerca o nella lista.
- La lista funziona offline con i dati in cache e sopravvive al ricaricamento.
- Navigazione completa da tastiera, focus visibile, icone con `aria-label`, `aria-pressed` sulle stelle e sui chip, `aria-current="page"` sulla scheda attiva.
- Loghi dal servizio icone di Google come oggi, con `alt` o `aria-label` col nome della catena; nessuna immagine di marchio nel repo.
- `node js/format.test.mjs` passa.
- Funziona aggiunta alla schermata Home su iPhone e Android (safe area rispettata dal dock).

## 11. Fuori da questo pacchetto

- Prezzi e conteggi nelle tavole sono esempi, tranne il confronto del tonno del 6/11. Usare sempre i dati reali.
- Il grafico dell'andamento non è disegnato in dettaglio: linee per catena (la migliore in verde spesso, le altre neutre tratteggiate), legenda sotto, nessun colore nuovo.
- Il testo del foglio «Da dove vengono i prezzi» va scritto: 3 righe al massimo (volantini, aggiornamento due volte al giorno, catene coperte).
