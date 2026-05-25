export class LLMMemory {
    constructor(beliefs) {
        this.beliefs = beliefs;
        this.objective = null;
        this.worldSnapshot = null;
        this.history = [];
        this.partnerIntentions = new Set();
    }

    updateWorld() {
        // Snapshot meaningful state (beliefs contains Sets/Maps that don't serialize)
        this.worldSnapshot = {
            parcels: [...this.beliefs.parcels],   // calls the getter with decay
            me: { ...this.beliefs.me },
            agentCount: this.beliefs.agentsMap.size,
        };
    }

    hasWorldChanged() {
        if (!this.worldSnapshot) return false;

        const prev = this.worldSnapshot.parcels;
        const now = this.beliefs.parcels;

        if (prev.length !== now.length) return true;

        // Check if any parcel IDs changed
        const prevIds = new Set(prev.map(p => p.id));
        for (const p of now) {
            if (!prevIds.has(p.id)) return true;
        }

        return false;
    }
}
