export class Beliefs {
    constructor() {
        this.me = { 
            id: null,
            x: 0,
            y: 0,
            carrying: 0,
            score: 0
        };
        // Use a Map to store persistent parcels (id -> parcel data)
        this.parcelsMap = new Map();
        this.map = [];
        this.timeTickMs = 1000; // time it takes for 1 reward decay (approximated)
    }

    /**
     * Aggiorna lo stato dei beliefs con i nuovi dati visivi
     */
    updateParcels(visibleParcels) {
        const now = Date.now();
        // Assumiamo che la vista sia limitata a Manhattan distance <= 4 o 5 (es. x_offset + y_offset <= 4)
        const visibleTiles = new Set();
        if (this.me.x !== undefined && this.me.y !== undefined) {
            for (let dx = -4; dx <= 4; dx++) {
                for (let dy = -4; dy <= 4; dy++) {
                    if (Math.abs(dx) + Math.abs(dy) <= 4) {
                        visibleTiles.add(`${this.me.x + dx},${this.me.y + dy}`);
                    }
                }
            }
        }

        // Aggiungo O aggiorno i pacchi attualmente visibili
        for (const p of visibleParcels) {
            this.parcelsMap.set(p.id, {
                ...p,
                lastSeen: now,
                originalReward: p.reward
            });
        }

        // Eseguo la logica di Forgetting
        for (const [id, p] of this.parcelsMap.entries()) {
            const decay = Math.floor((now - p.lastSeen) / this.timeTickMs);
            const currentReward = p.originalReward - decay;

            // 1. Dimentico se il pacco è scaduto
            if (currentReward <= 0) {
                this.parcelsMap.delete(id);
                continue;
            }

            // 2. Dimentico se mi aspetto il pacco in (x,y) che è nel mio campo visivo ma non lo vedo
            const cellKey = `${p.x},${p.y}`;
            if (visibleTiles.has(cellKey)) {
                // Se non è nei pacchi che ho percepito
                const isVisibleNow = visibleParcels.some(vp => vp.id === id);
                if (!isVisibleNow) {
                    this.parcelsMap.delete(id);
                }
            }
        }
    }

    /**
     * Ritorna l'array valutato dinamicamente con il decay del tempo
     */
    get parcels() {
        const now = Date.now();
        const results = [];
        for (const p of this.parcelsMap.values()) {
            const decay = Math.floor((now - p.lastSeen) / this.timeTickMs);
            const currentReward = p.originalReward - decay;
            if (currentReward > 0) {
                results.push({
                    ...p,
                    reward: currentReward
                });
            }
        }
        return results;
    }
}