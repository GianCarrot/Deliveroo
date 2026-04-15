# Specifica dei Requisiti: Agente BDI per Deliveroo.js (Fase 1 + Integrazioni Lab 1-5)

## 1. Architettura di Sistema e API

- **Ambiente:** Node.js.
- **Libreria SDK:** `@unitn-asa/deliveroo-js-sdk`.
- **Connessione:** WebSocket tramite `DjsConnect` e `DjsClientSocket`.

**Gestione Eventi (Input via EventEmitter):**
- `map`: Ricezione topologia iniziale (`width`, `height`, `tiles`).
- `you`: Dati dell'agente corrente (`id`, `name`, `x`, `y`, `score`, `penalty`).
- `sensing`: Array dei sensing (`positions`, `agents`, `parcels`, `crates`) nel raggio visivo.
- `config`: (Nuovo da lab) Permette l'acquisizione di parametri di gioco dal server (es. `GAME.player.observation_distance`).
- `tile`: (Nuovo da lab) Aggiornamenti mirati per singola cella.

**Azioni (Output — Asincrone via Promise):**
- `await socket.emitMove(direction)`: Ritorna `{x, y}` in caso di successo o `false` in caso di fallimento. Direzioni valide: `up`, `down`, `left`, `right`. In caso di fail può richiedere logiche di retry.
- `await socket.emitPickup()`: Ritorna array di pacchi raccolti.
- `await socket.emitPutdown(selected_ids)`: Ritorna array dei pacchi depositati. Se nessun ID viene specificato, rilascia tutti i pacchi trasportati.

---

## 2. Gestione Beliefs (Sensing e Memoria)

**Struttura della Mappa Statica (`IOTileType`):**

| Tipo | Descrizione |
|------|-------------|
| `0`  | Muro / Non calpestabile (wall) |
| `1`  | Generatore pacchi (parcel spawner) |
| `2`  | Zona di consegna (delivery) |
| `3`  | Area calpestabile standard (walkable) |
| `4`  | Base |
| `5`  | Piastrella di scorrimento crate (crate sliding tile) — *da chiarire* |
| `5!` | Generatore crate (crate spawner) — *da chiarire* |
| `↑ → ↓ ←` | Frecce direzionali: obbligano a muoversi nella direzione indicata |

**Osservabilità Parziale:** acquisizione dati limitata all'area definita da:

```
x_offset + y_offset < 5
```
*(corrispondente al config parametro Agent Observation Distance)*

**Belief Revision e Persistenza:**
- **Incertezza e Tracker Dinamico (Dai Lab):** I Belief degli agenti e dei pacchi rilevati vanno memorizzati storicizzati in una `Map` con i rispettivi Timestamp (`last_observed`). Confrontando l'ultimo e penultimo rilevamento, il sistema deduce la direzione (es. `x` maggiore indica spostamento a `right`) o ne rileva l'inattività in un tile.
- **Registrazione Pacchi:** Registrazione in una struttura dati locale dei pacchi acquisiti tramite `sensing`.
- **Decadimento:** Simulazione locale del decadimento temporale del reward: il punteggio viene aggiornato deduttivamente sottraendo il tempo di sistema trascorso dall'ultima osservazione.
- **Forgetting (Eliminazione logica):** Eliminazione dei pacchi (o agenti 'lost') quando il reward scende a `<= 0`, oppure quando l'agente ispeziona direttamente la cella in un raggio atteso (es $\leq 3$ tiles) e non rileva la presenza del pacco atteso (presumibilmente prelevato da altri agenti).

---

## 3. Deliberazione e Funzione di Utilità (Desire → Intention)

**Obiettivo:** ottimizzazione del rateo di acquisizione punti rispetto al tempo impiegato.

**Equazione dell'Utilità Target:**

```
U = R_current - (Cost_travel + Cost_delivery)
```

- `R_current`: valore corrente stimato del pacco target.
- `Cost_travel`: stima del tempo/tick necessari per raggiungere le coordinate del pacco. 
- `Cost_delivery`: stima del tempo/tick necessari per trasportare il pacco dalla sua posizione alla zona di tipo `2` più accessibile.

**Vincoli:**
- La generazione dell'Intention per un pacco è condizionata a `U > 0`.
- Pacchi con `U <= 0` vengono scartati dalla matrice decisionale.

**Ciclo BDI Integrato (Dai Lab 3 e 4):**
- **Options Generation (Desires):** Trasforma l'`onSensing` in eventi potenziali e filtra i target scartando i sottomultipli via scoring euristico `U`.
- **Intention Revision:** Selezione dell'intenzione tra le tipologie architetturali implementate:
  - *Replace*: ferma l'obiettivo attuale fisicamente scartandolo a favore di quello emergente più redditizio.
  - *Revise / Queue*: sistema di coda prioritaria preordinata.

**Logica Multi-Pickup:** valutare il prelievo di pacchi secondari lungo il percorso di trasporto primario, a condizione che l'aumento marginale di `Cost_delivery` non riduca a `<= 0` il reward totale atteso.

---

## 4. Implementazione del Planner Esterno

Nell'agente le elaborazioni sui percorsi possono essere strutturate sfruttando le seguenti metodologie:

**Modalità A: A* Pathfinding Algoritmico**
- **Mappatura del Grafo:**
  - Nodi navigabili: celle di tipo `1`, `2`, `3`, `4`, `5`, `↑`, `→`, `↓`, `←`. Il modello di costo dovrà eventualmente pesare in modo diverso le celle `5` e le frecce direzionali.
  - Nodi non navigabili (ostacoli statici): celle di tipo `0` e `5!`.
  - Ostacoli dinamici: posizioni attuali di altri agenti dedotte da `agentsSensing`.
- **Funzione Euristica:** distanza di Manhattan: `h(n) = |x1 - x2| + |y1 - y2|`
- **Struttura Output:** array sequenziale di vettori di movimento: `['up', 'up', 'right', 'down']`

**Modalità B: API per Planning PDDL (Dal Lab 5)**
- Tramite libreria `@unitn-asa/pddl-client` su `solver.planning.domains`.
- Si dichiarano i `Beliefset` esplicitamente.
- Si crea il `PddlDomain` per l'agente (predicati es: `(at ?me ?from)`), producendo action plan remotamente per navigare celle complesse gestendo logicamente i constraints.

---

## 5. Esecuzione del Piano e Trigger di Replanning

**Architettura della Libreria Piani (`PlanLibrary` - dal Lab 4):**
- **Intention Framework:** L'intenzione istanziata chiama uno o più Piani applicabili (es. `GoPickUp`, `BlindMove`, `PddlMove`). I Piani eseguono *sub-intentions* annidate e restituiscono o successo o throw.
- Tutte le Intenzioni ed i Piani possono essere forzatamente interrotte via `.stop()` invocato dal sistema centrale qualora scattino i trigger.

**Trigger per il Replanning (Interruzione / Nuova Rotta):**
1. **Impedimento fisico:** fallimento di `emitMove` per occupazione dinamica della tile. Implementare delay di retry asincrono prima della ripianificazione totale per evitare loop computazionali.
2. **Sottrazione dell'obiettivo:** rilevazione dell'assenza del pacco target (raccolto da un altro agente).
3. **Decadimento dell'utilità:** il ricalcolo periodico rileva `U <= 0` per il target corrente.
4. **Opportunità superiore:** rilevazione sensoriale di un nuovo pacco con `U_new > U_current + soglia_tolleranza`, innescando un `Replace` o un injection della coda per evitare oscillazioni decisionali.

---

## 6. Piano Strutturale di Sviluppo

1. **Inizializzazione (Bootstrap):** configurazione ambiente, connessione WebSocket, listener su `map`, inizializzazione mapping delle tile navigabili e non navigabili.
2. **Modulo di Memoria (Beliefs):** creazione delle classi di gestione dello stato per calcolare asincronamente i tick del mondo non osservato, con tracciamento temporale e previsione mobile.
3. **Algoritmo di Navigazione (Planner):** implementazione sia procedimentale su A* con euristica Manhattan, sia predisposizione all'aggancio PDDL remoto per i goal compositi complessi.
4. **Motore di Deliberazione:** scrittura dell'algoritmo di scoring per l'applicazione della funzione di utilità sull'array globale dei Beliefs e generazione code Intents (Queue/Replace/Revise).
5. **Loop Operativo:** integrazione dell'esecuzione asincrona tramite `PlanLibrary`, controllo fallimenti asincroni, attese procedurali e innesco degli step di Replanning.
6. **Fase di test e revisione:** test dell'agente nel loop di gioco `Deliveroo.js` su cloud o localhost; revisione e pulizia del codice.