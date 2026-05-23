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
    if (clockEvent === 'infinite')
        return null;
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
        /** @type {Set<string>} Keys "x,y" of spawn tiles (type '1') */
        this.spawnTiles = new Set();
        /** @type {Set<string>} Keys "x,y" of walkable tiles (type != '0') */
        this.walkableTiles = new Set();
        /** @type {Map<string, string>} Keys "x,y" -> tile type for arrow/directional checks */
        this.tileTypeMap = new Map();

        // --- Parcels ---
        /** @type {Map<string, Object>} id -> parcel data with lastSeen and originalReward */
        this.parcelsMap = new Map();
        /** @type {string[]} IDs of parcels currently carried by the agent */
        this.carriedParcels = [];

        // --- Agents ---
        /** @type {Map<string, IOAgent>} id -> agent data */
        this.agentsMap = new Map();

        // --- Configuration (default values, updated by updateConfig) ---
        /** @type {number|'infinite'} Observation distance (Manhattan) */
        this.observationDistance = 5;
        /** @type {number|null} Reward decay interval in ms, null = no decay */
        this.parcelDecayIntervalMs = 1000;

        // --- Target --
        this.currentTarget = null;
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
        this.spawnTiles.clear();
        this.walkableTiles.clear();
        this.tileTypeMap.clear();

        const nonWalkable = new Set(['0']); // 5 and 5! are walkable

        for (const tile of tiles) {
            const key = `${tile.x},${tile.y}`;
            this.tileTypeMap.set(key, String(tile.type));
            if (!nonWalkable.has(String(tile.type))) {
                this.walkableTiles.add(key);
            }
            if (String(tile.type) === '2') {
                this.deliveryTiles.add(key);
            }
            if (String(tile.type) === '1') {
                this.spawnTiles.add(key);
            }
        }

        console.log(`Map received: ${width}x${height}, ${tiles.length} tiles, ` +
            `${this.deliveryTiles.size} delivery, ${this.spawnTiles.size} spawn, ${this.walkableTiles.size} walkable`);
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
            // Skip parcels carried by other agents
            if (p.carriedBy && p.carriedBy !== this.me.id) continue;

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

    /**
     * Returns the number of parcels currently carried by the agent.
     * @returns {number}
     */
    get carriedCount() {
        return this.carriedParcels.length;
    }

    /**
     * Records parcels that were successfully picked up.
     * @param {Array} pickedUp - Array of parcel objects returned by emitPickup()
     */
    addCarriedParcels(pickedUp) {
        if (!Array.isArray(pickedUp)) return;
        for (const p of pickedUp) {
            if (p.id && !this.carriedParcels.includes(p.id)) {
                this.carriedParcels.push(p.id);
            }
            // Mark parcel as carried in belief map to prevent re-pickup attempts
            if (p.id && this.parcelsMap.has(p.id)) {
                const entry = this.parcelsMap.get(p.id);
                entry.carriedBy = this.me.id;
            }
        }
    }

    /**
     * Clears the carried parcels list after a successful putdown.
     */
    clearCarriedParcels() {
        this.carriedParcels = [];
    }

    /**
     * Returns the tile type at the given coordinates.
     * @param {number} x
     * @param {number} y
     * @returns {string|undefined} tile type string, or undefined if unknown
     */
    getTileType(x, y) {
        return this.tileTypeMap.get(`${x},${y}`);
    }

    /**
     * Returns uncarried parcels located at the given tile position.
     * Used for opportunistic pickup when passing over a tile.
     * @param {number} x
     * @param {number} y
     * @returns {Object[]}
     */
    getParcelsAt(x, y) {
        const results = [];
        for (const p of this.parcelsMap.values()) {
            if (p.carriedBy) continue; // skip carried parcels
            if (Math.round(p.x) === x && Math.round(p.y) === y) {
                results.push(p);
            }
        }
        return results;
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