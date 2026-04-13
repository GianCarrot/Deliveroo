/**
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOAgent.js').IOAgent} IOAgent
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOParcel.js').IOParcel} IOParcel
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOTile.js').IOTile} IOTile
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOConfig.js').IOConfig} IOConfig
 */

/**
 * Converte un IOClockEvent ('1s', '2s', '5s', '10s', 'infinite') in millisecondi.
 * @param {string} clockEvent
 * @returns {number|null} millisecondi, oppure null se 'infinite' (nessun decay)
 */
function clockEventToMs(clockEvent) {
    const mapping = {
        '1s': 1000,
        '2s': 2000,
        '5s': 5000,
        '10s': 10000,
    };
    if (clockEvent === 'infinite') return null;
    return mapping[clockEvent] ?? 1000; // default 1s
}

export class Beliefs {
    constructor() {
        // --- Agente ---
        this.me = {
            id: null,
            name: null,
            x: 0,
            y: 0,
            carrying: 0,
            score: 0
        };

        // --- Mappa ---
        this.mapWidth = 0;
        this.mapHeight = 0;
        this.tiles = [];
        /** @type {Set<string>} Chiavi "x,y" delle tile di consegna (tipo '2') */
        this.deliveryTiles = new Set();
        /** @type {Set<string>} Chiavi "x,y" delle tile navigabili (tipo != '0' e != '5!') */
        this.walkableTiles = new Set();

        // --- Pacchi ---
        /** @type {Map<string, Object>} id -> parcel data con lastSeen e originalReward */
        this.parcelsMap = new Map();

        // --- Agenti ---
        /** @type {Map<string, IOAgent>} id -> dati agente */
        this.agentsMap = new Map();

        // --- Configurazione (valori di default, aggiornati da updateConfig) ---
        /** @type {number|'infinite'} Distanza di osservazione (Manhattan) */
        this.observationDistance = 5;
        /** @type {number|null} Intervallo di decay del reward in ms, null = nessun decay */
        this.parcelDecayIntervalMs = 1000;
    }

    // ─────────────────────────────────────────────
    //  CONFIG
    // ─────────────────────────────────────────────

    /**
     * Aggiorna i parametri di gioco dalla configurazione del server.
     * @param {IOConfig} config
     */
    updateConfig(config) {
        if (config?.GAME?.player?.observation_distance !== undefined) {
            const dist = config.GAME.player.observation_distance;
            this.observationDistance = (dist === 'infinite') ? Infinity : Number(dist);
        }

        if (config?.GAME?.parcels?.decaying_event !== undefined) {
            this.parcelDecayIntervalMs = clockEventToMs(config.GAME.parcels.decaying_event);
        }

        console.log("Config received:",
            "observationDistance =", this.observationDistance,
            "| parcelDecayIntervalMs =", this.parcelDecayIntervalMs
        );
    }

    // ─────────────────────────────────────────────
    //  MAP
    // ─────────────────────────────────────────────

    /**
     * Inizializza la struttura mappa con le tile navigabili e di consegna.
     * @param {number} width
     * @param {number} height
     * @param {IOTile[]} tiles
     */
    updateMap(width, height, tiles) {
        this.mapWidth = width;
        this.mapHeight = height;
        this.tiles = tiles;
        this.deliveryTiles.clear();
        this.walkableTiles.clear();

        const nonWalkable = new Set(['0', '5!']);

        for (const tile of tiles) {
            const key = `${tile.x},${tile.y}`;
            if (!nonWalkable.has(tile.type)) {
                this.walkableTiles.add(key);
            }
            if (tile.type === '2') {
                this.deliveryTiles.add(key);
            }
        }

        console.log(`Map received: ${width}x${height}, ${tiles.length} tiles, ` +
            `${this.deliveryTiles.size} delivery, ${this.walkableTiles.size} walkable`);
    }

    // ─────────────────────────────────────────────
    //  PARCELS
    // ─────────────────────────────────────────────

    /**
     * Aggiorna lo stato dei beliefs con i nuovi dati visivi sui pacchi.
     * Implementa belief revision con forgetting come da requisiti sezione 2.
     * @param {IOParcel[]} visibleParcels
     */
    updateParcels(visibleParcels) {
        const now = Date.now();

        // Calcola le tile visibili in base alla observation distance
        const visibleCells = this._getVisibleCells();

        // Aggiungo o aggiorno i pacchi attualmente visibili
        for (const p of visibleParcels) {
            // Ignora pacchi portati da altri agenti
            if (p.carriedBy && p.carriedBy !== this.me.id) continue;

            this.parcelsMap.set(p.id, {
                ...p,
                lastSeen: now,
                originalReward: p.reward
            });
        }

        // Logica di Forgetting
        const visibleParcelIds = new Set(visibleParcels.map(p => p.id));

        for (const [id, p] of this.parcelsMap.entries()) {
            // 1. Dimentico se il pacco è scaduto (solo se c'è decay)
            if (this.parcelDecayIntervalMs !== null) {
                const decayTicks = Math.floor((now - p.lastSeen) / this.parcelDecayIntervalMs);
                const currentReward = p.originalReward - decayTicks;
                if (currentReward <= 0) {
                    this.parcelsMap.delete(id);
                    continue;
                }
            }

            // 2. Dimentico se mi aspetto il pacco in (x,y) che è nel mio campo visivo ma non lo vedo
            const cellKey = `${p.x},${p.y}`;
            if (visibleCells === null || visibleCells.has(cellKey)) {
                if (!visibleParcelIds.has(id)) {
                    this.parcelsMap.delete(id);
                }
            }
        }
    }

    /**
     * Ritorna l'array valutato dinamicamente con il decay del tempo.
     * @returns {Object[]}
     */
    get parcels() {
        const now = Date.now();
        const results = [];
        for (const p of this.parcelsMap.values()) {
            let currentReward = p.originalReward;

            if (this.parcelDecayIntervalMs !== null) {
                const decayTicks = Math.floor((now - p.lastSeen) / this.parcelDecayIntervalMs);
                currentReward = p.originalReward - decayTicks;
                if (currentReward <= 0) continue;
            }

            results.push({
                ...p,
                reward: currentReward
            });
        }
        return results;
    }

    // ─────────────────────────────────────────────
    //  AGENTS
    // ─────────────────────────────────────────────

    /**
     * Aggiorna le posizioni degli altri agenti.
     * Rimuove agenti che erano nel campo visivo ma non appaiono più.
     * @param {IOAgent[]} visibleAgents
     */
    updateAgents(visibleAgents) {
        const visibleCells = this._getVisibleCells();
        const visibleAgentIds = new Set();

        // Aggiorna o aggiungi agenti visibili (escluso se stesso)
        for (const agent of visibleAgents) {
            if (agent.id === this.me.id) continue;
            visibleAgentIds.add(agent.id);
            this.agentsMap.set(agent.id, { ...agent, lastSeen: Date.now() });
        }

        // Forgetting: rimuovi agenti che dovrebbero essere visibili ma non lo sono
        for (const [id, agent] of this.agentsMap.entries()) {
            if (visibleAgentIds.has(id)) continue;
            const cellKey = `${Math.round(agent.x)},${Math.round(agent.y)}`;
            if (visibleCells === null || visibleCells.has(cellKey)) {
                this.agentsMap.delete(id);
            }
        }
    }

    /**
     * Getter per l'array degli agenti tracciati.
     * @returns {Object[]}
     */
    get agents() {
        return Array.from(this.agentsMap.values());
    }

    // ─────────────────────────────────────────────
    //  UTILITY INTERNE
    // ─────────────────────────────────────────────

    /**
     * Calcola le celle visibili dall'agente in base all'observation distance.
     * @returns {Set<string>|null} Set di chiavi "x,y", oppure null se tutto è visibile
     */
    _getVisibleCells() {
        if (this.observationDistance === Infinity) return null; // tutto visibile

        const myX = Math.round(this.me.x);
        const myY = Math.round(this.me.y);
        const dist = this.observationDistance;
        const cells = new Set();

        for (let dx = -dist; dx <= dist; dx++) {
            for (let dy = -dist; dy <= dist; dy++) {
                if (Math.abs(dx) + Math.abs(dy) < dist) {
                    cells.add(`${myX + dx},${myY + dy}`);
                }
            }
        }
        return cells;
    }
}