# Spesa Smart: brief di design

App mobile (PWA) per confrontare i prezzi dei supermercati italiani. Cerchi un prodotto per nome e vedi in quale catena costa meno, al kg o al litro, con offerte, storico e avvisi di prezzo.

- **App online:** https://app-spesa-nu.vercel.app
- **Codice:** `app/` (HTML + CSS + JS senza framework). Dati in `data/latest.json`, aggiornati due volte al giorno da uno scraper.
- **Stato:** prototipo funzionante con dati reali. L'interfaccia è stata rifatta una volta (6 nov 2026), ma serve un vero lavoro di design.

---

## 1. Il problema e chi lo ha

**Utente tipo:** chi fa la spesa ogni settimana e vuole spendere meno senza girare 5 volantini. Usa il telefono, spesso in fretta, a volte nel corridoio del supermercato.

**Domanda a cui l'app deve rispondere in 3 secondi:**
> "Dove costa meno [prodotto] questa settimana, e quanto risparmio?"

**Domande secondarie:**
- Quali sono le offerte più convenienti di oggi?
- Il prezzo è basso adesso o di solito costa meno? (storico)
- Avvisami quando scende sotto X.
- Dov'è il negozio più vicino di quella catena?

---

## 2. Principi (da rispettare)

1. **Una risposta chiara in cima a ogni pagina.** Prima il verdetto, poi i dettagli.
2. **Il prezzo al kg/litro è il numero principale.** Le confezioni hanno formati diversi (160 g, 3×60 g, 0,96 kg): si confronta solo il prezzo per unità. Il prezzo della confezione è secondario.
3. **Onestà sui dati.** I prezzi vengono dai volantini, quindi:
   - "Non trovato" significa "non in offerta questa settimana", **non** "non venduto".
   - Ogni prezzo ha la data di validità.
   - Le catene non coperte vanno dichiarate, non nascoste.
4. **Mobile first, una mano.** Target 390×844. Azioni principali nella metà bassa dello schermo.
5. **Leggibile in modalità chiara e scura.** Contrasto WCAG AA, anche per gli elementi selezionati.

---

## 3. Navigazione attuale

Barra in basso con 3 schede:

| Scheda | Scopo |
|---|---|
| **Cerca** (home) | Ricerca + "Dove risparmi di più" + "Sconti più forti di oggi" |
| **Catalogo** | 70 prodotti base divisi per categoria, ciascuno col prezzo migliore |
| **Offerte** | Tutte le offerte dei volantini (~700), filtrabili |

Pagina di dettaglio: **Scheda prodotto** (si apre da Cerca e da Catalogo).

---

## 4. Schermate e contenuti

### 4.1 Home / Cerca
- Barra di ricerca ("Cerca un prodotto: latte, tonno, caffè…")
- Scorciatoie orizzontali ai prodotti più comuni
- **Dove risparmi di più**: prodotti con la differenza di prezzo maggiore tra catene ("3 catene · risparmi fino al 38%", "da 6,91 €/kg")
- **Sconti più forti di oggi**: offerte con lo sconto più alto (badge "−50%")
- Avvisi scattati (banner: "🔔 Tonno è sceso a 6,91 €/kg da Aldi")
- Piè di pagina con le catene coperte (loghi)

**Risultati di ricerca:** due gruppi distinti
- **Confronta i prezzi**: prodotti del catalogo, con confronto tra catene → aprono la scheda prodotto
- **Nei volantini**: singole offerte che contengono la parola cercata

### 4.2 Scheda prodotto
- **Riquadro in alto:** "Più conveniente" → logo + catena, **6,91 €/kg** (grande), "Tonno in olio di oliva · Almare · 160 g → 1,49 €", "Risparmi il 38% rispetto a Eurospin", negozio più vicino
- **Tutti i prezzi al kg:** una riga per catena, ordinate dal più conveniente. Per ciascuna: €/kg, differenza ("+36%"), prezzo della confezione, sconto, prezzo con carta fedeltà, negozio vicino
- Catene senza offerta questa settimana (riga di testo)
- **Andamento del prezzo:** grafico a linee per catena, 30/90 giorni
- **Avvisami quando scende:** soglia in €/kg + pulsante

### 4.3 Catalogo
- Filtri (menu a tendina): Catena · Categoria · Ordinamento (per categoria / prezzo più basso / €/kg più basso) · Disponibilità (tutti / solo con prezzo)
- Contatore: "70 prodotti · 47 con un prezzo questa settimana"
- Lista raggruppata per categoria, una riga per prodotto: nome, "3 catene · risparmi fino al 38%" oppure "Nessuna offerta questa settimana", "da X €/kg"

### 4.4 Offerte
- Ricerca libera dentro le offerte
- Filtri: Catena · Categoria · Ordinamento (sconto più alto / prezzo più basso / €/kg più basso)
- Riga offerta: logo, badge sconto, nome, catena · formato · "fino al 15 nov", prezzo, prezzo barrato, €/kg, eventuale prezzo con carta fedeltà

---

## 5. Dati reali (esempio: 6 nov 2026)

**Catene con dati:** Eurospin (253 offerte), Aldi (390), Penny (54). Totale ~700 offerte.
**In arrivo:** Tigros, Basko, MD, Carrefour (codice pronto, lettura AI in corso).
**Non coperte (bloccano l'accesso):** Lidl, Coop, Conad, Esselunga, Bennet.

**Esempio di confronto, "Tonno in scatola":**

| Catena | Prodotto | Formato | Prezzo | €/kg | Promo |
|---|---|---|---|---|---|
| Aldi | Tonno in olio di oliva · Almare Seafood | 160 g | 1,49 € | **6,91** | — |
| Penny | Tonno all'olio d'oliva · Gran Mare | 0,96 kg | 8,99 € | 9,37 | — |
| Eurospin | Tonno pinna gialla all'olio di oliva · Ondina | 3 × 60 g | 1,99 € | 11,06 | −33% (era 2,99 €) fino al 15 nov |

**Struttura di un'offerta:**
```
catena, nome, marca, formato ("500 g", "6 × 1 l", "al kg"),
prezzo, prezzo barrato (opz.), sconto % (opz.), prezzo al kg/l/pz (opz.),
prezzo con carta fedeltà (opz.), categoria, valido fino al
```

**Struttura di un prodotto del catalogo:** nome, unità (kg / l / pz), categoria, sinonimi per la ricerca, migliore offerta per ogni catena, storico prezzi giornaliero.

**Categorie del catalogo (70 prodotti):** Latticini e uova · Salumi e formaggi · Pane e colazione · Pasta, riso e dispensa · Bevande · Carne e pesce · Frutta e verdura · Surgelati · Casa e igiene · Animali.

---

## 6. Stile attuale (da migliorare liberamente)

- Font: font di sistema (system-ui)
- Colore principale: verde acqua `#0f766e` (scuro: `#2dd4bf` con testo scuro sopra)
- Risparmio / migliore: verde `#15803d` su fondo verde chiaro
- Sconti: badge rosso pieno `#c8251a` con testo bianco
- Superfici: card bianche con bordo sottile, angoli 16 px, sfondo `#f4f6f5`
- Loghi catene: icona del sito ufficiale (favicon) in un quadrato arrotondato
- Icone barra in basso: SVG a tratto (lente, elenco, cartellino)

---

## 7. Problemi aperti (su cui serve il design)

1. **Gerarchia della scheda prodotto:** il riquadro "più conveniente" funziona, ma la lista sotto è ancora fitta di testo grigio.
2. **"Dove risparmi di più" può ingannare:** confronta prodotti diversi (vino da tavola contro DOC → "risparmi 65%"). Serve un modo per comunicare quanto è affidabile un confronto, oppure filtrare.
3. **Nomi e categorie dei volantini non sono omogenei:** ogni catena scrive a modo suo (MAIUSCOLO, "GASTRONOMIA, SALUMI E FORMAGGI" contro "Salumi e formaggi").
4. **Stati vuoti:** prodotto senza offerte questa settimana, catena non coperta, storico non ancora disponibile (i dati partono dal 5 nov 2026).
5. **Negozio più vicino:** richiede il permesso di posizione. Va pensato quando e come chiederlo.
6. **Avvisi di prezzo:** oggi si vedono solo aprendo l'app (niente notifiche push). Va progettato un flusso semplice.
7. **Offerte:** ~700 righe. Servono un raggruppamento o uno scorrimento più leggibili.
8. **Fiducia:** l'utente deve capire da dove vengono i prezzi (volantini) e quanto sono aggiornati, senza leggere un muro di testo.

---

## 8. Vincoli tecnici

- PWA statica (HTML/CSS/JS senza framework), pubblicata su Vercel. Nessun backend.
- Dati in un unico JSON (~1 MB) caricato all'avvio.
- Avvisi salvati nel browser (localStorage).
- Loghi caricati dal servizio icone di Google: non vanno incorporate immagini di marchi nel repo.
- Deve funzionare bene su iPhone e Android, anche aggiunta alla schermata Home.

---

## 9. Cosa chiedo al design

1. Una direzione visiva chiara e riconoscibile (non un'app bancaria grigia).
2. Le 4 schermate principali (Home/Cerca, Scheda prodotto, Catalogo, Offerte) in modalità chiara e scura.
3. Gli stati vuoti e di errore elencati sopra.
4. Un piccolo sistema di componenti: riga prodotto, riga offerta, riquadro "più conveniente", badge sconto, filtri, barra di navigazione.
