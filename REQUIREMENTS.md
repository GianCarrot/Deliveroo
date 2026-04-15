# Specifica dei Requisiti: Agente BDI per Deliveroo.js (Fase 1)

## 1. Architettura di Sistema e API

- **Ambiente:** Node.js.
- **Libreria SDK:** `@unitn-asa/deliveroo-js-sdk`.
- **Connessione:** WebSocket tramite `DjsConnect` e `DjsClientSocket`.

**Gestione Eventi (Input):**
- `map`: Ricezione topologia iniziale (`width`, `height`, `tiles`).
- `you`: Dati dell'agente corrente (`id`, `name`, `x`, `y`, `score`, `penalty`).
- `parcelsSensing`: Array dei pacchi nel raggio visivo.
- `agentsSensing`: Array degli agenti nel raggio visivo.

**Azioni (Output — Asincrone):**
- `await socket.emitMove(direction)`: Ritorna `{x, y}` in caso di successo o `false` in caso di fallimento. Direzioni valide: `up`, `down`, `left`, `right`.
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
| `5`  | Piastrella di scorrimento cassa (crate sliding tile) — *da chiarire* |
| `5!` | Generatore casse (crate spawner) — *da chiarire* |
| `↑ → ↓ ←` | Frecce direzionali: obbligano a muoversi nella direzione indicata |

**Osservabilità Parziale:** acquisizione dati limitata all'area definita da:

```
x_offset + y_offset < 5
```

**Belief Revision e Persistenza:**
- Registrazione in una struttura dati locale dei pacchi acquisiti tramite `parcelsSensing`.
- Simulazione locale del decadimento temporale del reward: il punteggio viene aggiornato deduttivamente sottraendo il tempo di sistema trascorso dall'ultima osservazione.
- Eliminazione logica (*forgetting*) dei pacchi quando il reward calcolato scende a `<= 0`, oppure quando un'osservazione diretta della cella non rileva la presenza del pacco atteso (prelevato da altri agenti).

---

## 3. Deliberazione e Funzione di Utilità (Desire → Intention)

**Obiettivo:** ottimizzazione del rateo di acquisizione punti rispetto al tempo impiegato.

**Equazione dell'Utilità Target:**

```
U = R_current - (Cost_travel + Cost_delivery)
```

- `R_current`: valore corrente stimato del pacco target.
- `Cost_travel`: stima del tempo/tick necessari per raggiungere le coordinate del pacco. Si calcola moltiplicando la lunghezza del percorso generato dal Planner per il costo unitario del movimento.
- `Cost_delivery`: stima del tempo/tick necessari per trasportare il pacco dalla sua posizione alla zona di tipo `2` più accessibile.

**Vincoli:**
- La generazione dell'Intention per un pacco è condizionata a `U > 0`.
- Pacchi con `U <= 0` vengono scartati dalla matrice decisionale.

**Logica Multi-Pickup:** valutare il prelievo di pacchi secondari lungo il percorso di trasporto primario, a condizione che l'aumento marginale di `Cost_delivery` non riduca a `<= 0` il reward totale atteso.

---

## 4. Implementazione del Planner Esterno

- **Algoritmo richiesto:** A* (A-Star) Pathfinding.

**Mappatura del Grafo:**
- Nodi navigabili: celle di tipo `1`, `2`, `3`, `4`, `5`, `↑`, `→`, `↓`, `←`. Il modello di costo dovrà eventualmente pesare in modo diverso le celle `5` e le frecce direzionali se impongono movimenti forzati o alterano i tempi di percorrenza.
- Nodi non navigabili (ostacoli statici): celle di tipo `0` e `5!`.
- Ostacoli dinamici: posizioni attuali di altri agenti dedotte da `agentsSensing`.

**Funzione Euristica:** distanza di Manhattan:

```
h(n) = |x1 - x2| + |y1 - y2|
```

**Struttura Output:** array sequenziale di vettori di movimento, ad esempio:

```js
['up', 'up', 'right', 'down']
```

---

## 5. Esecuzione del Piano e Trigger di Replanning

- **Motore di Esecuzione:** loop asincrono che processa in serie gli step dell'array fornito dal Planner.
- **Gestione Collisioni e Lock:** le azioni di movimento occupano la cella di destinazione bloccandola. Se `emitMove` restituisce `false`, viene applicata una penalità logica.

**Trigger per il Replanning:**

1. **Impedimento fisico:** fallimento di `emitMove` per occupazione dinamica della tile. Implementare un delay di retry prima della ripianificazione totale.
2. **Sottrazione dell'obiettivo:** rilevazione dell'assenza del pacco target (raccolto da un altro agente).
3. **Decadimento dell'utilità:** il ricalcolo periodico rileva `U <= 0` per il target corrente.
4. **Opportunità superiore:** rilevazione sensoriale di un nuovo pacco con `U_new > U_current + soglia_tolleranza`, per evitare oscillazioni decisionali continue.

---

## 6. Piano Strutturale di Sviluppo

1. **Inizializzazione (Bootstrap):** configurazione ambiente, connessione WebSocket, listener su `map`, inizializzazione mapping delle tile navigabili e non navigabili.
2. **Modulo di Memoria (Beliefs):** creazione delle classi di gestione dello stato per calcolare asincronamente i tick del mondo non osservato.
3. **Algoritmo di Navigazione (Planner):** implementazione di A* con euristica Manhattan, adattato per gestire i nuovi tipi di tile (frecce direzionali, ecc.).
4. **Motore di Deliberazione:** scrittura dell'algoritmo di scoring per l'applicazione della funzione di utilità sull'array globale dei Beliefs.
5. **Loop Operativo:** integrazione di esecuzione asincrona, controllo fallimenti e innesco eventi di Replanning.
6. **Fase di test e revisione:** test dell'agente in Deliveroo.js e revisione del codice affinché rispetti i principi di Ingegneria del Software.