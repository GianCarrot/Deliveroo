/**
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOAgent.js').IOAgent} IOAgent
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOParcel.js').IOParcel} IOParcel
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOTile.js').IOTile} IOTile
 * @typedef {import('@unitn-asa/deliveroo-js-sdk/types/IOConfig.js').IOConfig} IOConfig
 */

/**
 * Converts an IOClockEvent ('1s', '2s', '5s', '10s', 'infinite') to milliseconds.
 * @param {string} clockEvent
 * @returns {number|null} milliseconds, or null if 'infinite' (no decay)
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
        // --- Agent ---
        this.me = {
            id: null,
            name: null,
            x: 0,
            y: 0,
            carrying: 0,
            score: 0
        };

        // --- Map ---
        this.mapWidth = 0;
        this.mapHeight = 0;
        this.tiles = [];
        /** @type {Set<string>} Keys "x,y" of delivery tiles (type '2') */
        this.deliveryTiles = new Set();
        /** @type {Set<string>} Keys "x,y" of walkable tiles (type != '0' and != '5!') */
        this.walkableTiles = new Set();

        // --- Parcels ---
        /** @type {Map<string, Object>} id -> parcel data with lastSeen and originalReward */
        this.parcelsMap = new Map();

        // --- Agents ---
        /** @type {Map<string, IOAgent>} id -> agent data */
        this.agentsMap = new Map();

        // --- Configuration (default values, updated by updateConfig) ---
        /** @type {number|'infinite'} Observation distance (Manhattan) */
        this.observationDistance = 5;
        /** @type {number|null} Reward decay interval in ms, null = no decay */
        this.parcelDecayIntervalMs = 1000;
    }

    // ─────────────────────────────────────────────
    //  CONFIG
    // ─────────────────────────────────────────────

    /**
     * Updates game parameters from the server configuration.
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
     * Initializes the map structure with walkable and delivery tiles.
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
     * Updates the belief state with new visual data about parcels.
     * Implements belief revision with forgetting as per section 2 requirements.
     * @param {IOParcel[]} visibleParcels
     */
    updateParcels(visibleParcels) {
        const now = Date.now();

        // Calculate visible tiles based on observation distance
        const visibleCells = this._getVisibleCells();

        // Add or update currently visible parcels
        for (const p of visibleParcels) {
            // Ignore parcels carried by other agents
            if (p.carriedBy && p.carriedBy !== this.me.id) continue;

            this.parcelsMap.set(p.id, {
                ...p,
                lastSeen: now,
                originalReward: p.reward
            });
        }

        // Forgetting Logic
        const visibleParcelIds = new Set(visibleParcels.map(p => p.id));

        for (const [id, p] of this.parcelsMap.entries()) {
            // Forget if the parcel has expired (only if decay is active)
            if (this.parcelDecayIntervalMs !== null) {
                const decayTicks = Math.floor((now - p.lastSeen) / this.parcelDecayIntervalMs);
                const currentReward = p.originalReward - decayTicks;
                if (currentReward <= 0) {
                    this.parcelsMap.delete(id);
                    continue;
                }
            }

            // Forget if the parcel is expected at (x,y) which is in my field of view but I don't see it
            const cellKey = `${p.x},${p.y}`;
            if (visibleCells === null || visibleCells.has(cellKey)) {
                if (!visibleParcelIds.has(id)) {
                    this.parcelsMap.delete(id);
                }
            }
        }
    }

    /**
     * Returns the dynamically evaluated array with time decay applied.
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
     * Updates the positions of other agents.
     * Removes agents that were in the field of view but no longer appear.
     * @param {IOAgent[]} visibleAgents
     */
    updateAgents(visibleAgents) {
        const visibleCells = this._getVisibleCells();
        const visibleAgentIds = new Set();

        // Update or add visible agents (excluding self)
        for (const agent of visibleAgents) {
            if (agent.id === this.me.id) continue;
            visibleAgentIds.add(agent.id);
            this.agentsMap.set(agent.id, { ...agent, lastSeen: Date.now() });
        }

        // Forgetting: remove agents that should be visible but are not
        for (const [id, agent] of this.agentsMap.entries()) {
            if (visibleAgentIds.has(id)) continue;
            const cellKey = `${Math.round(agent.x)},${Math.round(agent.y)}`;
            if (visibleCells === null || visibleCells.has(cellKey)) {
                this.agentsMap.delete(id);
            }
        }
    }

    /**
     * Getter for the array of tracked agents.
     * @returns {Object[]}
     */
    get agents() {
        return Array.from(this.agentsMap.values());
    }

    // ─────────────────────────────────────────────
    //  INTERNAL UTILITIES
    // ─────────────────────────────────────────────

    /**
     * Calculates the cells visible by the agent based on observation distance.
     * @returns {Set<string>|null} Set of "x,y" keys, or null if everything is visible
     */
    _getVisibleCells() {
        if (this.observationDistance === Infinity) return null; // everything visible

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