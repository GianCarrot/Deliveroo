/**
 * LLM Memory
 *
 * Holds the LLM context window: current objective, environment observations,
 * shared beliefs from Agent A, and action history.
 */
export class LLMMemory {
    constructor(beliefs) {
        this.beliefs = beliefs;
        this.objective = null;
        this.worldSnapshot = null;
        this.history = [];
        this.partnerBeliefs = [];          // beliefs received from the BDI Agent
    }

    /**
     * Takes a snapshot of the current world state for change detection.
     */
    updateWorld() {
        // Cap history to prevent unbounded memory growth in long games
        if (this.history.length > 100) {
            this.history = this.history.slice(-50);
        }
        this.worldSnapshot = {
            parcels: [...this.beliefs.parcels],
            me: { ...this.beliefs.me },
            agentCount: this.beliefs.agentsMap.size,
            carriedCount: this.beliefs.carriedParcels.length,
        };
    }

    /**
     * Detects meaningful world changes since the last snapshot.
     * Used by the Replanner to decide whether to replan.
     * @returns {boolean}
     */
    hasWorldChanged() {
        if (!this.worldSnapshot) return false;

        // Replan only if the number of carried parcels has changed
        if (this.worldSnapshot.carriedCount !== this.beliefs.carriedParcels.length) return true;

        return false;
    }

    /**
     * Incorporates a belief shared by the BDI Agent
     * Called from socket.onSay handler.
     * @param {string} entity  — e.g. 'parcel'
     * @param {object} payload — the entity data
     */
    updateLLMMemory(entity, payload) {
        if (entity === "parcel") {
            // Merge into partner beliefs for LLM context injection
            this.partnerBeliefs = this.partnerBeliefs.filter(
                (b) => b.id !== payload.id
            );
            this.partnerBeliefs.push(payload);
        }
    }

    /**
     * Builds a compact world-state summary for the LLM context.
     * @returns {string}
     */
    buildContext() {
        const me = this.beliefs.me;
        const parcels = this.beliefs.parcels.filter((p) => !p.carriedBy);
        const deliveryTiles = [...this.beliefs.deliveryTiles].map((k) => {
            const [x, y] = k.split(",").map(Number);
            return { x, y };
        });
        const spawnTiles = [...this.beliefs.spawnTiles].map((k) => {
            const [x, y] = k.split(",").map(Number);
            return { x, y };
        });

        const ctx = {
            gameConfig: {
                mapSize: `${this.beliefs.mapWidth}x${this.beliefs.mapHeight}`,
                observationDistance: this.beliefs.observationDistance,
                parcelDecayMs: this.beliefs.parcelDecayIntervalMs ?? "none (no decay)",
            },
            agent: {
                x: me.x,
                y: me.y,
                score: me.score,
                carrying: this.beliefs.carriedParcels.length,
            },
            uncollectedParcels: parcels.slice(0, 10).map((p) => ({
                id: p.id,
                x: p.x,
                y: p.y,
                reward: p.reward,
            })),
            deliveryTiles: deliveryTiles.slice(0, 10),
            spawnTiles: spawnTiles.slice(0, 10),
            partnerReportedParcels: this.partnerBeliefs
                .filter(p => !p.carriedBy)
                .slice(0, 5)
                .map(p => ({ id: p.id, x: p.x, y: p.y, reward: p.reward })),
            recentHistory: this.history.slice(-5).map((h) => {
                if (h.type === "action") return `${h.tool}(${h.args ?? ""}) → ${h.result}`;
                if (h.type === "replan") return `[REPLAN: ${h.reason}]`;
                if (h.type === "new_objective") return `[NEW OBJECTIVE: ${h.objective}]`;
                return `[${h.type}]`;
            }),
        };

        return JSON.stringify(ctx, null, 2);
    }

}
